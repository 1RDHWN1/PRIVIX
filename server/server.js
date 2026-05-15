const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const path = require("path")
const fs = require("fs")
const {
  MAX_USERNAME_LENGTH,
  MAX_CHANNEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SERVER_NAME_LENGTH,
  CHANNEL_NAME_PATTERN
} = require("./lib/constants")
const { normalizeText, isValidLength } = require("./lib/validation")
const { dbRun, dbGet, dbAll, initDatabase, isPostgres } = require("./lib/db")
const { requireServerPermission, requireServerOwner } = require("./lib/permissions")
const { writeAuditLog } = require("./services/audit")
const { ensureInviteForServer } = require("./services/invites")
const { ensureUser } = require("./services/users")
const { getMemberServers, getServerChannels } = require("./services/servers")
const {
  getServerMembers,
  getMemberMuteState,
  getRoleIdByName,
  isServerMember,
  getMemberRoleInfo,
  ensureMemberRoleId
} = require("./services/members")
const { buildRoomKey, buildVoiceRoomKey, getChannelPermission } = require("./services/channels")
const { resolveSfuConfig, buildSfuRoomName, issueLivekitToken } = require("./services/sfu")

const app = express()
app.use(cors())

function parseEnvList(value) {
  if (!value) return []
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildIceConfig() {
  const rawJson = process.env.PRIVIX_ICE_JSON || process.env.ICE_SERVERS_JSON
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson)
      if (Array.isArray(parsed)) {
        return { iceServers: parsed }
      }
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.iceServers)) {
          return parsed
        }
        if (parsed.urls) {
          return { iceServers: [parsed] }
        }
      }
    } catch (error) {
      console.error("Invalid ICE_SERVERS_JSON:", error.message || error)
    }
  }

  const turnUrls = parseEnvList(process.env.PRIVIX_TURN_URLS || process.env.TURN_URLS)
  const turnUsername = process.env.PRIVIX_TURN_USERNAME || process.env.TURN_USERNAME
  const turnCredential = process.env.PRIVIX_TURN_CREDENTIAL || process.env.TURN_CREDENTIAL
  const iceTransportPolicy = process.env.PRIVIX_ICE_POLICY || process.env.ICE_POLICY

  if (turnUrls.length === 0) {
    return null
  }

  const server = { urls: turnUrls }
  if (turnUsername) {
    server.username = turnUsername
  }
  if (turnCredential) {
    server.credential = turnCredential
  }

  const config = { iceServers: [server] }
  if (iceTransportPolicy) {
    config.iceTransportPolicy = iceTransportPolicy
  }
  return config
}

const SFU_CONFIG = resolveSfuConfig()
const MESH_PEER_SOFT_LIMIT = Math.max(2, Number(process.env.PRIVIX_VOICE_MESH_PEER_LIMIT || 4) || 4)
const DEFAULT_LIVEKIT_CLIENT_SDK_URL =
  "https://cdn.jsdelivr.net/npm/livekit-client@2.15.5/dist/livekit-client.esm.mjs"
const SERVER_DEBUG =
  String(process.env.PRIVIX_DEBUG || "").trim() === "1" ||
  String(process.env.DEBUG_PRIVIX || "").trim() === "1"
const LEGACY_CHANNELS_ENABLED =
  String(process.env.PRIVIX_ENABLE_LEGACY_CHANNELS || "").trim() === "1"

function hasTurnServer(config) {
  if (!config || !Array.isArray(config.iceServers)) return false
  return config.iceServers.some((server) => {
    const urls = Array.isArray(server && server.urls) ? server.urls : [server && server.urls]
    return urls.some((url) => /^turns?:/i.test(String(url || "")))
  })
}

function getClientSfuSdkUrl() {
  if (SFU_CONFIG.clientSdkPath) {
    return "/vendor/livekit-client.esm.mjs"
  }
  return SFU_CONFIG.clientSdkUrl || (SFU_CONFIG.enabled ? DEFAULT_LIVEKIT_CLIENT_SDK_URL : "")
}

function buildClientVoiceConfig(iceConfig = null) {
  return {
    use_sfu: Boolean(SFU_CONFIG.enabled),
    sfu_provider: SFU_CONFIG.provider || "livekit",
    sfu_ws_url: SFU_CONFIG.wsUrl || "",
    sfu_client_sdk_url: getClientSfuSdkUrl(),
    has_turn: hasTurnServer(iceConfig),
    mesh_peer_soft_limit: MESH_PEER_SOFT_LIMIT
  }
}

function logVoiceRuntimeReadiness() {
  const iceConfig = buildIceConfig()
  if (!SFU_CONFIG.enabled && !hasTurnServer(iceConfig)) {
    console.warn("Voice mesh is running without TURN. Set PRIVIX_TURN_URLS for reliable NAT traversal.")
  }
  if (SFU_CONFIG.useSfu && !SFU_CONFIG.enabled) {
    console.warn("VOICE_USE_SFU is enabled, but LiveKit config is incomplete. Falling back to mesh voice.")
  }
  if (SFU_CONFIG.enabled && !SFU_CONFIG.clientSdkPath && !SFU_CONFIG.clientSdkUrl) {
    console.warn("LiveKit client SDK is using the browser CDN fallback. Set PRIVIX_LIVEKIT_CLIENT_SDK_PATH to self-host it.")
  }
}

app.get("/config.js", (req, res) => {
  const config = buildIceConfig()
  const voiceConfig = buildClientVoiceConfig(config)
  res.set("Content-Type", "application/javascript; charset=utf-8")
  const configScript = config ? JSON.stringify(config) : "null"
  res.end(
    `window.PRIVIX_ICE = ${configScript};\nwindow.PRIVIX_VOICE_CONFIG = ${JSON.stringify(voiceConfig)};`
  )
})

app.get("/vendor/livekit-client.esm.mjs", (req, res) => {
  if (!SFU_CONFIG.clientSdkPath) {
    res.status(404).type("text/plain").send("LiveKit client SDK path is not configured")
    return
  }
  const sdkPath = path.resolve(SFU_CONFIG.clientSdkPath)
  fs.access(sdkPath, fs.constants.R_OK, (error) => {
    if (error) {
      res.status(404).type("text/plain").send("LiveKit client SDK file is not readable")
      return
    }
    res.sendFile(sdkPath)
  })
})

app.use(express.static(path.join(__dirname, "..", "client")))

const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 60000
})

const MESSAGE_REACTION_EMOJIS = ["👍", "❤️", "😂", "🔥", "👏", "🎉"]
const MESSAGE_REACTION_EMOJI_SET = new Set(MESSAGE_REACTION_EMOJIS)
const RICH_STATUS_PRESETS = {
  online: "Online",
  coding: "Lagi ngoding",
  afk: "AFK",
  gaming: "Main game",
  busy: "Busy"
}
const RICH_STATUS_KEY_SET = new Set(Object.keys(RICH_STATUS_PRESETS))
const MAX_RICH_STATUS_TEXT_LENGTH = 60
const userPresenceStatusByKey = new Map()
const DRAW_GUESS_WORDS = [
  "kucing",
  "anjing",
  "ikan",
  "burung",
  "kelinci",
  "gajah",
  "harimau",
  "zebra",
  "komputer",
  "laptop",
  "keyboard",
  "mouse",
  "monitor",
  "printer",
  "kamera",
  "telepon",
  "jam tangan",
  "kacamata",
  "payung",
  "sepeda",
  "motor",
  "mobil",
  "pesawat",
  "kereta",
  "kapal",
  "roket",
  "hujan",
  "petir",
  "pelangi",
  "awan",
  "matahari",
  "bulan",
  "bintang",
  "gunung",
  "pantai",
  "laut",
  "danau",
  "hutan",
  "sungai",
  "air terjun",
  "sekolah",
  "rumah sakit",
  "perpustakaan",
  "pasar",
  "restoran",
  "bioskop",
  "stadion",
  "robot",
  "astronot",
  "ninja",
  "dokter",
  "polisi",
  "pemadam",
  "petani",
  "nelayan",
  "guru",
  "nasi goreng",
  "mie ayam",
  "bakso",
  "sate",
  "rendang",
  "roti bakar",
  "es krim",
  "kopi susu",
  "gitar",
  "piano",
  "drum",
  "biola",
  "mikrofon",
  "headphone",
  "gamepad",
  "joystick",
  "bola basket",
  "bola voli",
  "raket",
  "skateboard",
  "layang layang",
  "balon",
  "kado",
  "lilin ulang tahun"
]
const DRAW_GUESS_ROUND_MS = 90 * 1000
const DRAW_GUESS_MAX_STROKES = 2600
const DRAW_GUESS_MAX_GUESS_LENGTH = 60
const WORD_RUSH_WORDS_BY_DIFFICULTY = {
  easy: [
    "rumah",
    "mobil",
    "bulan",
    "hari",
    "pagi",
    "malam",
    "makan",
    "minum",
    "tidur",
    "bangun",
    "jalan",
    "duduk",
    "main",
    "baca",
    "tulis",
    "lihat",
    "dengar",
    "cinta",
    "marah",
    "sedih",
    "senang",
    "takut",
    "sabar",
    "cepat",
    "lambat",
    "besar",
    "kecil",
    "baik",
    "buruk",
    "putih"
  ],
  medium: [
    "makanan",
    "minuman",
    "sekolah",
    "pelajar",
    "guru",
    "buku",
    "kelas",
    "kerja",
    "kantor",
    "dokter",
    "rumah sakit",
    "keluarga",
    "teman",
    "pesta",
    "liburan",
    "belanja",
    "pasar",
    "toko",
    "uang",
    "jual",
    "beli",
    "istirahat",
    "bermain",
    "belajar",
    "latihan",
    "percaya",
    "adil",
    "hemat",
    "mahal",
    "murah"
  ],
  hard: [
    "authorization",
    "cryptography",
    "infrastructure",
    "compatibility",
    "fragmentation",
    "extraordinary",
    "configuration",
    "virtualization",
    "sustainability",
    "interoperable",
    "personalization",
    "responsiveness",
    "collaboration",
    "countermeasure",
    "communication",
    "differentiation",
    "implementation",
    "asynchronous",
    "synchronization",
    "containerization",
    "microservices",
    "reconciliation",
    "deterministic",
    "observability",
    "serialization",
    "idempotency",
    "parallelization",
    "interactivity",
    "accessibility",
    "maintainability",
    "decentralized",
    "multithreading",
    "progressively",
    "reusability",
    "transformation"
  ]
}
const WORD_RUSH_DIFFICULTY_SET = new Set(["easy", "medium", "hard"])
const WORD_RUSH_ROUND_MS_BY_DIFFICULTY = {
  easy: 75 * 1000,
  medium: 60 * 1000,
  hard: 45 * 1000
}
const WORD_RUSH_MAX_GUESS_LENGTH = 80
const GAME_ROOM_NAME_PATTERN = /^game(?:-[a-z0-9-]+)?$/i
const SUPPORTED_GAME_IDS = new Set(["drawguess", "wordrush"])
const drawGuessSessionsByRoom = new Map()
const drawGuessScoresByRoom = new Map()
const drawGuessTimerByRoom = new Map()
const wordRushSessionsByRoom = new Map()
const wordRushScoresByRoom = new Map()
const wordRushTimerByRoom = new Map()
const gameLobbyByRoom = new Map()

function buildPresenceUserKey(userId, username) {
  const resolvedUserId = Number(userId)
  if (Number.isInteger(resolvedUserId) && resolvedUserId > 0) {
    return `id:${resolvedUserId}`
  }
  const normalizedUsername = normalizeText(username).toLowerCase()
  if (!normalizedUsername) return ""
  return `name:${normalizedUsername}`
}

function sanitizeRichStatusPayload(payload) {
  const rawStatusKey = normalizeText(payload && payload.status_key).toLowerCase()
  const statusKey = RICH_STATUS_KEY_SET.has(rawStatusKey) ? rawStatusKey : "online"
  const customStatus = normalizeText(payload && payload.status_text).slice(0, MAX_RICH_STATUS_TEXT_LENGTH)
  return {
    statusKey,
    statusText: customStatus
  }
}

function getDefaultPresenceStatus() {
  return { status_key: "online", status_text: "" }
}

function setPresenceStatusForUser(userId, username, statusPayload = null) {
  const presenceKey = buildPresenceUserKey(userId, username)
  if (!presenceKey) return getDefaultPresenceStatus()
  const normalized =
    statusPayload && typeof statusPayload === "object"
      ? sanitizeRichStatusPayload(statusPayload)
      : getDefaultPresenceStatus()
  const nextValue = {
    status_key: normalized.statusKey,
    status_text: normalized.statusText
  }
  userPresenceStatusByKey.set(presenceKey, nextValue)
  return nextValue
}

function getPresenceStatusForUser(userId, username) {
  const presenceKey = buildPresenceUserKey(userId, username)
  if (!presenceKey) return getDefaultPresenceStatus()
  const saved = userPresenceStatusByKey.get(presenceKey)
  if (!saved) return getDefaultPresenceStatus()
  return {
    status_key: RICH_STATUS_KEY_SET.has(String(saved.status_key || "")) ? String(saved.status_key) : "online",
    status_text: normalizeText(saved.status_text).slice(0, MAX_RICH_STATUS_TEXT_LENGTH)
  }
}

function clearPresenceStatusForUser(userId, username) {
  const presenceKey = buildPresenceUserKey(userId, username)
  if (!presenceKey) return
  userPresenceStatusByKey.delete(presenceKey)
}

function randomDrawGuessWord() {
  if (!Array.isArray(DRAW_GUESS_WORDS) || DRAW_GUESS_WORDS.length === 0) return "misteri"
  const index = Math.floor(Math.random() * DRAW_GUESS_WORDS.length)
  return String(DRAW_GUESS_WORDS[index] || "misteri")
}

function normalizeDrawGuessCompareText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function buildDrawGuessMask(word) {
  const raw = String(word || "")
  if (!raw) return ""
  return raw
    .split("")
    .map((char) => {
      if (char === " ") return "  "
      if (/[a-z0-9]/i.test(char)) return "_ "
      return `${char} `
    })
    .join("")
    .trim()
}

function isGameRoomChannelName(channelName) {
  const safeChannelName = normalizeText(channelName).toLowerCase()
  if (!safeChannelName) return false
  return GAME_ROOM_NAME_PATTERN.test(safeChannelName)
}

function normalizeGameId(value) {
  const gameId = normalizeText(value).toLowerCase()
  if (!SUPPORTED_GAME_IDS.has(gameId)) return ""
  return gameId
}

function getOrCreateGameLobby(roomKey) {
  const key = String(roomKey || "")
  if (!key) return { drawguess: new Set(), wordrush: new Set() }
  if (!gameLobbyByRoom.has(key)) {
    gameLobbyByRoom.set(key, {
      drawguess: new Set(),
      wordrush: new Set()
    })
  }
  return gameLobbyByRoom.get(key)
}

function getGamePlayersFromLobby(roomKey, gameId) {
  const key = String(roomKey || "")
  const safeGameId = normalizeGameId(gameId)
  if (!key || !safeGameId) return []
  const lobby = getOrCreateGameLobby(key)
  const bucket = lobby[safeGameId]
  if (!(bucket instanceof Set)) return []
  return Array.from(bucket)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

function buildGameLobbyState(roomKey, username = "") {
  const key = String(roomKey || "")
  const safeUsername = normalizeText(username)
  const drawguessPlayers = getGamePlayersFromLobby(key, "drawguess")
  const wordrushPlayers = getGamePlayersFromLobby(key, "wordrush")
  const joinedGameId = drawguessPlayers.includes(safeUsername)
    ? "drawguess"
    : wordrushPlayers.includes(safeUsername)
    ? "wordrush"
    : ""
  return {
    room_key: key,
    drawguess_players: drawguessPlayers,
    wordrush_players: wordrushPlayers,
    joined_game_id: joinedGameId
  }
}

function leaveAllGameLobbies(roomKey, username) {
  const key = String(roomKey || "")
  const safeUsername = normalizeText(username)
  if (!key || !safeUsername) return false
  const lobby = getOrCreateGameLobby(key)
  let changed = false
  for (const gameId of SUPPORTED_GAME_IDS) {
    const bucket = lobby[gameId]
    if (bucket instanceof Set && bucket.delete(safeUsername)) {
      changed = true
    }
  }
  return changed
}

function joinGameLobby(roomKey, username, gameId) {
  const key = String(roomKey || "")
  const safeUsername = normalizeText(username)
  const safeGameId = normalizeGameId(gameId)
  if (!key || !safeUsername || !safeGameId) {
    return { ok: false, gameId: "", changed: false, players: [] }
  }
  const lobby = getOrCreateGameLobby(key)
  leaveAllGameLobbies(key, safeUsername)
  const bucket = lobby[safeGameId]
  if (bucket instanceof Set) {
    bucket.add(safeUsername)
  }
  return {
    ok: true,
    gameId: safeGameId,
    changed: true,
    players: getGamePlayersFromLobby(key, safeGameId)
  }
}

function clearWordRushTimer(roomKey) {
  const key = String(roomKey || "")
  const timer = wordRushTimerByRoom.get(key)
  if (timer) {
    clearTimeout(timer)
    wordRushTimerByRoom.delete(key)
  }
}

function normalizeWordRushDifficulty(value) {
  const raw = normalizeText(value).toLowerCase()
  if (!WORD_RUSH_DIFFICULTY_SET.has(raw)) return "medium"
  return raw
}

function randomWordRushWord(difficulty) {
  const safeDifficulty = normalizeWordRushDifficulty(difficulty)
  const wordPool = WORD_RUSH_WORDS_BY_DIFFICULTY[safeDifficulty]
  if (!Array.isArray(wordPool) || wordPool.length === 0) return "word"
  const index = Math.floor(Math.random() * wordPool.length)
  return String(wordPool[index] || "word")
}

function getWordRushRoundMs(difficulty) {
  const safeDifficulty = normalizeWordRushDifficulty(difficulty)
  const value = Number(WORD_RUSH_ROUND_MS_BY_DIFFICULTY[safeDifficulty])
  if (!Number.isFinite(value) || value <= 0) return WORD_RUSH_ROUND_MS_BY_DIFFICULTY.medium
  return value
}

function shuffleText(text) {
  const chars = Array.from(String(text || ""))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

function buildWordRushPrompt(word, difficulty = "medium") {
  const rawWord = normalizeText(word).toLowerCase()
  if (!rawWord) return ""
  return shuffleText(rawWord)
}

function normalizeWordRushCompareText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function getWordRushScoreMap(roomKey) {
  const key = String(roomKey || "")
  if (!key) return new Map()
  if (!wordRushScoresByRoom.has(key)) {
    wordRushScoresByRoom.set(key, new Map())
  }
  return wordRushScoresByRoom.get(key)
}

function serializeWordRushScores(scoreMap) {
  const rows = []
  if (!(scoreMap instanceof Map)) return rows
  scoreMap.forEach((score, username) => {
    const safeUsername = normalizeText(username)
    const safeScore = Number(score) || 0
    if (!safeUsername) return
    rows.push({ username: safeUsername, score: safeScore })
  })
  rows.sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
  return rows
}

function getDrawGuessScoreMap(roomKey) {
  const key = String(roomKey || "")
  if (!key) return new Map()
  if (!drawGuessScoresByRoom.has(key)) {
    drawGuessScoresByRoom.set(key, new Map())
  }
  return drawGuessScoresByRoom.get(key)
}

function serializeDrawGuessScores(scoreMap) {
  const rows = []
  if (!(scoreMap instanceof Map)) return rows
  scoreMap.forEach((score, username) => {
    const safeUsername = normalizeText(username)
    const safeScore = Number(score) || 0
    if (!safeUsername) return
    rows.push({ username: safeUsername, score: safeScore })
  })
  rows.sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
  return rows
}

function clearDrawGuessTimer(roomKey) {
  const key = String(roomKey || "")
  const timer = drawGuessTimerByRoom.get(key)
  if (timer) {
    clearTimeout(timer)
    drawGuessTimerByRoom.delete(key)
  }
}

function clearDrawGuessRoomData(roomKey) {
  const key = String(roomKey || "")
  if (!key) return
  clearDrawGuessTimer(key)
  clearWordRushTimer(key)
  drawGuessSessionsByRoom.delete(key)
  drawGuessScoresByRoom.delete(key)
  wordRushSessionsByRoom.delete(key)
  wordRushScoresByRoom.delete(key)
  gameLobbyByRoom.delete(key)
}

function moveDrawGuessRoomState(oldRoomKey, newRoomKey) {
  const oldKey = String(oldRoomKey || "")
  const nextKey = String(newRoomKey || "")
  if (!oldKey || !nextKey || oldKey === nextKey) return false

  const drawGuessSession = drawGuessSessionsByRoom.get(oldKey) || null
  const drawGuessScoreMap = drawGuessScoresByRoom.get(oldKey) || null
  const wordRushSession = wordRushSessionsByRoom.get(oldKey) || null
  const wordRushScoreMap = wordRushScoresByRoom.get(oldKey) || null
  const gameLobby = gameLobbyByRoom.get(oldKey) || null

  clearDrawGuessTimer(oldKey)
  clearDrawGuessTimer(nextKey)
  clearWordRushTimer(oldKey)
  clearWordRushTimer(nextKey)
  drawGuessSessionsByRoom.delete(oldKey)
  drawGuessScoresByRoom.delete(oldKey)
  wordRushSessionsByRoom.delete(oldKey)
  wordRushScoresByRoom.delete(oldKey)
  gameLobbyByRoom.delete(oldKey)
  drawGuessSessionsByRoom.delete(nextKey)
  drawGuessScoresByRoom.delete(nextKey)
  wordRushSessionsByRoom.delete(nextKey)
  wordRushScoresByRoom.delete(nextKey)
  gameLobbyByRoom.delete(nextKey)

  if (drawGuessSession) {
    drawGuessSession.roomKey = nextKey
    drawGuessSessionsByRoom.set(nextKey, drawGuessSession)
  }
  if (drawGuessScoreMap instanceof Map) {
    drawGuessScoresByRoom.set(nextKey, drawGuessScoreMap)
  }
  if (wordRushSession) {
    wordRushSession.roomKey = nextKey
    wordRushSessionsByRoom.set(nextKey, wordRushSession)
  }
  if (wordRushScoreMap instanceof Map) {
    wordRushScoresByRoom.set(nextKey, wordRushScoreMap)
  }
  if (gameLobby && typeof gameLobby === "object") {
    gameLobbyByRoom.set(nextKey, {
      drawguess: new Set(gameLobby.drawguess instanceof Set ? Array.from(gameLobby.drawguess) : []),
      wordrush: new Set(gameLobby.wordrush instanceof Set ? Array.from(gameLobby.wordrush) : [])
    })
  }
  return {
    movedDrawGuess: Boolean(drawGuessSession),
    movedWordRush: Boolean(wordRushSession),
    movedLobby: Boolean(gameLobby)
  }
}

function normalizeReactionRows(rows) {
  const grouped = new Map()
  ;(rows || []).forEach((row) => {
    const emoji = String(row && row.emoji || "")
    const username = String(row && row.username || "")
    if (!emoji || !username) return
    if (!grouped.has(emoji)) {
      grouped.set(emoji, new Set())
    }
    grouped.get(emoji).add(username)
  })

  return MESSAGE_REACTION_EMOJIS
    .filter((emoji) => grouped.has(emoji))
    .map((emoji) => {
      const users = Array.from(grouped.get(emoji))
      return {
        emoji,
        count: users.length,
        users
      }
    })
}

async function getMessageReactions(messageId) {
  const rows = await dbAll(
    "SELECT emoji, username FROM message_reactions WHERE message_id = ? ORDER BY id ASC",
    [messageId]
  )
  return normalizeReactionRows(rows)
}

async function attachReactionsToMessages(rows) {
  const messages = Array.isArray(rows) ? rows : []
  const messageIds = messages
    .map((row) => Number(row && row.id))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (messageIds.length === 0) return messages.map((row) => ({ ...row, reactions: [] }))

  const placeholders = messageIds.map(() => "?").join(",")
  const reactionRows = await dbAll(
    `SELECT message_id, emoji, username FROM message_reactions WHERE message_id IN (${placeholders}) ORDER BY id ASC`,
    messageIds
  )
  const reactionsByMessageId = new Map()
  reactionRows.forEach((row) => {
    const messageId = Number(row && row.message_id)
    if (!Number.isInteger(messageId)) return
    if (!reactionsByMessageId.has(messageId)) {
      reactionsByMessageId.set(messageId, [])
    }
    reactionsByMessageId.get(messageId).push(row)
  })

  return messages.map((row) => ({
    ...row,
    reactions: normalizeReactionRows(reactionsByMessageId.get(Number(row.id)))
  }))
}

async function attachReplyContextToMessages(rows) {
  const messages = Array.isArray(rows) ? rows : []
  const replyTargetIds = Array.from(
    new Set(
      messages
        .map((row) => Number(row && row.reply_to_message_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  )
  if (replyTargetIds.length === 0) {
    return messages.map((row) => ({
      ...row,
      reply_to: null
    }))
  }

  const placeholders = replyTargetIds.map(() => "?").join(",")
  const replyRows = await dbAll(
    `SELECT id, username, message FROM messages WHERE id IN (${placeholders})`,
    replyTargetIds
  )
  const replyById = new Map()
  ;(replyRows || []).forEach((row) => {
    const id = Number(row && row.id)
    if (!Number.isInteger(id) || id <= 0) return
    replyById.set(id, row)
  })

  return messages.map((row) => {
    const replyId = Number(row && row.reply_to_message_id)
    const replyRow = Number.isInteger(replyId) ? replyById.get(replyId) : null
    return {
      ...row,
      reply_to: replyRow
        ? {
            id: Number(replyRow.id),
            username: String(replyRow.username || ""),
            message: String(replyRow.message || "")
          }
        : null
    }
  })
}

async function enrichMessages(rows) {
  const withReactions = await attachReactionsToMessages(rows)
  return attachReplyContextToMessages(withReactions)
}
const VOICE_DEBUG =
  String(process.env.PRIVIX_VOICE_DEBUG || "").trim() === "1" ||
  String(process.env.VOICE_DEBUG || "").trim() === "1"

function voiceDebugServer(event, details = null) {
  if (!VOICE_DEBUG) return
  const timestamp = new Date().toISOString()
  if (details === null || typeof details === "undefined") {
    console.log(`[voice-debug][server][${timestamp}] ${event}`)
    return
  }
  console.log(`[voice-debug][server][${timestamp}] ${event}`, details)
}

function debugServer(scope, event, details = null) {
  if (!SERVER_DEBUG) return
  const timestamp = new Date().toISOString()
  const prefix = `[privix-debug][server][${scope || "app"}][${timestamp}] ${event}`
  if (details === null || typeof details === "undefined") {
    console.log(prefix)
    return
  }
  console.log(prefix, details)
}

function buildServerPresenceRoomKey(serverId) {
  return `presence:server:${Number(serverId)}`
}

function parseUsernamePayload(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      username: payload.username,
      authToken: payload.auth_token || payload.authToken || ""
    }
  }
  return { username: payload, authToken: "" }
}

async function getValidInviteByCode(code) {
  const invite = await dbGet(
    `
    SELECT i.id, i.server_id, i.code, i.max_uses, i.used_count, i.expires_at, s.name AS server_name
    FROM invites i
    JOIN servers s ON s.id = i.server_id
    WHERE i.code = ?
    LIMIT 1
    `,
    [code]
  )
  if (!invite) {
    const error = new Error("Invite code tidak ditemukan")
    error.code = "INVITE_NOT_FOUND"
    throw error
  }

  if (invite.expires_at) {
    const now = Date.now()
    const expiresAt = new Date(invite.expires_at).getTime()
    if (!Number.isNaN(expiresAt) && expiresAt <= now) {
      const error = new Error("Invite code sudah expired")
      error.code = "INVITE_EXPIRED"
      throw error
    }
  }

  if (invite.max_uses && invite.used_count >= invite.max_uses) {
    const error = new Error("Invite code sudah mencapai batas pemakaian")
    error.code = "INVITE_LIMIT_REACHED"
    throw error
  }

  return invite
}

const voiceRoomStartedAtByKey = new Map()

function inferVoiceRoomStartedAtFromPeers(peers) {
  return (Array.isArray(peers) ? peers : []).reduce((minTs, peer) => {
    const ts = Number(peer && peer.data && peer.data.voiceJoinedAtTs)
    if (!Number.isFinite(ts) || ts <= 0) return minTs
    if (minTs <= 0) return ts
    return Math.min(minTs, ts)
  }, 0)
}

function resolveVoiceRoomStartedAt(voiceRoomKey, peers) {
  if (!voiceRoomKey) return 0
  const list = Array.isArray(peers) ? peers : []
  if (list.length === 0) {
    voiceRoomStartedAtByKey.delete(voiceRoomKey)
    return 0
  }

  const existingTs = Number(voiceRoomStartedAtByKey.get(voiceRoomKey) || 0)
  if (Number.isFinite(existingTs) && existingTs > 0) {
    return existingTs
  }

  const inferredTs = inferVoiceRoomStartedAtFromPeers(list)
  const nextTs = inferredTs > 0 ? inferredTs : Date.now()
  voiceRoomStartedAtByKey.set(voiceRoomKey, nextTs)
  return nextTs
}

io.on("connection", (socket) => {
  console.log("user connected")

  socket.data.username = ""
  socket.data.userId = null
  socket.data.roomKey = ""
  socket.data.activeServerId = null
  socket.data.activeChannel = ""
  socket.data.joinVersion = 0
  socket.data.isTyping = false
  socket.data.voiceRoomKey = ""
  socket.data.voiceServerId = null
  socket.data.voiceChannel = ""
  socket.data.voiceMuted = false
  socket.data.voiceCameraEnabled = false
  socket.data.voiceScreenSharing = false
  socket.data.voiceJoinedAtTs = 0

  async function emitServerOnlineUsers(serverId) {
    const resolvedServerId = Number(serverId)
    if (!Number.isInteger(resolvedServerId) || resolvedServerId <= 0) return

    const presenceRoomKey = buildServerPresenceRoomKey(resolvedServerId)
    const peers = await io.in(presenceRoomKey).fetchSockets()
    const byUser = new Map()

    peers.forEach((peer) => {
      const username = normalizeText(peer.data.username)
      if (!username) return
      const userId = Number(peer.data.userId) || 0
      const uniqueKey = userId > 0 ? `id:${userId}` : `name:${username.toLowerCase()}`
      if (byUser.has(uniqueKey)) return
      const presenceStatus = getPresenceStatusForUser(userId, username)
      byUser.set(uniqueKey, {
        user_id: userId > 0 ? userId : null,
        username,
        channel: normalizeText(peer.data.activeChannel).toLowerCase(),
        status_key: presenceStatus.status_key,
        status_text: presenceStatus.status_text
      })
    })

    io.to(presenceRoomKey).emit("server online users", {
      server_id: resolvedServerId,
      users: Array.from(byUser.values()),
      total: byUser.size,
      updated_at: Date.now()
    })
  }

  function emitTypingIndicator(isTyping) {
    if (!socket.data.username || !socket.data.roomKey) return
    socket.to(socket.data.roomKey).emit("typing indicator", {
      username: socket.data.username,
      channel: socket.data.activeChannel,
      server_id: socket.data.activeServerId,
      is_typing: Boolean(isTyping)
    })
  }

  function clearTypingIndicator() {
    if (socket.data.isTyping) {
      emitTypingIndicator(false)
    }
    socket.data.isTyping = false
  }

  async function getRoomParticipantUsernames(roomKey) {
    const safeRoomKey = String(roomKey || "")
    if (!safeRoomKey) return []
    const peers = await io.in(safeRoomKey).fetchSockets()
    const names = new Set()
    peers.forEach((peer) => {
      const username = normalizeText(peer.data.username)
      if (!username) return
      names.add(username)
    })
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }

  function buildDrawGuessStateForUsername(roomKey, username, participants = []) {
    const safeRoomKey = String(roomKey || "")
    const safeUsername = normalizeText(username)
    const session = drawGuessSessionsByRoom.get(safeRoomKey) || null
    const scoreMap = getDrawGuessScoreMap(safeRoomKey)
    const isDrawer = Boolean(session && safeUsername && session.drawerUsername === safeUsername)
    const gamePlayers = getGamePlayersFromLobby(safeRoomKey, "drawguess")
    return {
      room_key: safeRoomKey,
      active: Boolean(session),
      drawer_username: session ? session.drawerUsername : "",
      is_drawer: isDrawer,
      word_mask: session ? (isDrawer ? session.word : buildDrawGuessMask(session.word)) : "",
      round_started_at_ts: session ? session.startedAtTs : 0,
      round_ends_at_ts: session ? session.endsAtTs : 0,
      strokes: session ? [...session.strokes] : [],
      scores: serializeDrawGuessScores(scoreMap),
      participants: Array.isArray(participants) && participants.length ? participants : gamePlayers
    }
  }

  function buildWordRushStateForUsername(roomKey, username, participants = []) {
    const safeRoomKey = String(roomKey || "")
    const safeUsername = normalizeText(username)
    const session = wordRushSessionsByRoom.get(safeRoomKey) || null
    const scoreMap = getWordRushScoreMap(safeRoomKey)
    const gamePlayers = getGamePlayersFromLobby(safeRoomKey, "wordrush")
    const joined = gamePlayers.includes(safeUsername)
    return {
      room_key: safeRoomKey,
      active: Boolean(session),
      joined: joined,
      difficulty: session ? normalizeWordRushDifficulty(session.difficulty) : "medium",
      word_hint: session ? String(session.wordPrompt || "") : "",
      round_started_at_ts: session ? session.startedAtTs : 0,
      round_ends_at_ts: session ? session.endsAtTs : 0,
      scores: serializeWordRushScores(scoreMap),
      participants: Array.isArray(participants) && participants.length ? participants : gamePlayers
    }
  }

  async function emitGameLobbyStateToRoom(roomKey) {
    const safeRoomKey = String(roomKey || "")
    if (!safeRoomKey) return
    const peers = await io.in(safeRoomKey).fetchSockets()
    peers.forEach((peer) => {
      const username = normalizeText(peer.data.username)
      peer.emit("game lobby state", buildGameLobbyState(safeRoomKey, username))
    })
  }

  async function emitGameLobbyStateToSocket(targetSocket, roomKey) {
    if (!targetSocket) return
    const safeRoomKey = String(roomKey || "")
    if (!safeRoomKey) return
    const username = normalizeText(targetSocket.data.username)
    targetSocket.emit("game lobby state", buildGameLobbyState(safeRoomKey, username))
  }

  async function emitDrawGuessStateToRoom(roomKey) {
    const safeRoomKey = String(roomKey || "")
    if (!safeRoomKey) return
    const peers = await io.in(safeRoomKey).fetchSockets()
    const participants = getGamePlayersFromLobby(safeRoomKey, "drawguess")
    peers.forEach((peer) => {
      const username = normalizeText(peer.data.username)
      peer.emit("drawguess state", buildDrawGuessStateForUsername(safeRoomKey, username, participants))
    })
  }

  async function emitDrawGuessStateToSocket(targetSocket, roomKey) {
    if (!targetSocket) return
    const safeRoomKey = String(roomKey || "")
    if (!safeRoomKey) return
    const username = normalizeText(targetSocket.data.username)
    const participants = getGamePlayersFromLobby(safeRoomKey, "drawguess")
    targetSocket.emit("drawguess state", buildDrawGuessStateForUsername(safeRoomKey, username, participants))
  }

  async function emitWordRushStateToRoom(roomKey) {
    const safeRoomKey = String(roomKey || "")
    if (!safeRoomKey) return
    const peers = await io.in(safeRoomKey).fetchSockets()
    const participants = getGamePlayersFromLobby(safeRoomKey, "wordrush")
    peers.forEach((peer) => {
      const username = normalizeText(peer.data.username)
      peer.emit("wordrush state", buildWordRushStateForUsername(safeRoomKey, username, participants))
    })
  }

  async function emitWordRushStateToSocket(targetSocket, roomKey) {
    if (!targetSocket) return
    const safeRoomKey = String(roomKey || "")
    if (!safeRoomKey) return
    const username = normalizeText(targetSocket.data.username)
    const participants = getGamePlayersFromLobby(safeRoomKey, "wordrush")
    targetSocket.emit("wordrush state", buildWordRushStateForUsername(safeRoomKey, username, participants))
  }

  function normalizeDrawGuessStroke(payload) {
    const toUnit = (value) => {
      const num = Number(value)
      if (!Number.isFinite(num)) return null
      return Math.max(0, Math.min(1, num))
    }
    const x0 = toUnit(payload && payload.x0)
    const y0 = toUnit(payload && payload.y0)
    const x1 = toUnit(payload && payload.x1)
    const y1 = toUnit(payload && payload.y1)
    if ([x0, y0, x1, y1].some((value) => value === null)) return null

    const size = Math.max(0.0025, Math.min(0.05, Number(payload && payload.size) || 0.007))
    const color = normalizeText(payload && payload.color).slice(0, 24) || "#f1f5ff"
    const tool = normalizeText(payload && payload.tool).toLowerCase() === "erase" ? "erase" : "draw"
    return { x0, y0, x1, y1, size, color, tool }
  }

  async function endDrawGuessRound(roomKey, reason, winnerUsername = "") {
    const safeRoomKey = String(roomKey || "")
    const session = drawGuessSessionsByRoom.get(safeRoomKey)
    if (!session) {
      clearDrawGuessTimer(safeRoomKey)
      return
    }

    clearDrawGuessTimer(safeRoomKey)
    drawGuessSessionsByRoom.delete(safeRoomKey)

    const safeWinner = normalizeText(winnerUsername)
    const safeWord = String(session.word || "")
    const createdAt = new Date().toISOString()
    let announcement = `🎨 Draw & Guess selesai. Kata: "${safeWord}".`
    if (safeWinner) {
      announcement = `🎨 ${safeWinner} berhasil menebak kata "${safeWord}"!`
    } else if (reason === "timeout") {
      announcement = `🎨 Waktu habis. Kata yang benar: "${safeWord}".`
    } else if (reason === "drawer_left") {
      announcement = `🎨 Runde berakhir karena drawer keluar. Kata: "${safeWord}".`
    }

    io.to(safeRoomKey).emit("chat message", {
      id: 0,
      username: "Privix Bot",
      message: announcement,
      created_at: createdAt,
      reply_to_message_id: null,
      reply_to: null,
      reactions: [],
      channel: session.channelName,
      server_id: session.serverId
    })

    io.to(safeRoomKey).emit("drawguess round ended", {
      reason: String(reason || "ended"),
      winner_username: safeWinner || null,
      word: safeWord
    })

    await emitDrawGuessStateToRoom(safeRoomKey)
  }

  function scheduleDrawGuessTimeout(roomKey) {
    const safeRoomKey = String(roomKey || "")
    const session = drawGuessSessionsByRoom.get(safeRoomKey)
    if (!session) return
    clearDrawGuessTimer(safeRoomKey)
    const delay = Math.max(200, session.endsAtTs - Date.now())
    const timer = setTimeout(() => {
      endDrawGuessRound(safeRoomKey, "timeout").catch(() => {})
    }, delay)
    drawGuessTimerByRoom.set(safeRoomKey, timer)
  }

  async function handleDrawGuessUserLeave(roomKey, username) {
    const safeRoomKey = String(roomKey || "")
    const safeUsername = normalizeText(username)
    if (!safeRoomKey || !safeUsername) return
    const session = drawGuessSessionsByRoom.get(safeRoomKey)
    if (session && session.drawerUsername === safeUsername) {
      await endDrawGuessRound(safeRoomKey, "drawer_left")
      return
    }
    const participants = getGamePlayersFromLobby(safeRoomKey, "drawguess")
    if (participants.length === 0) {
      clearDrawGuessTimer(safeRoomKey)
      drawGuessSessionsByRoom.delete(safeRoomKey)
      drawGuessScoresByRoom.delete(safeRoomKey)
      return
    }
    await emitDrawGuessStateToRoom(safeRoomKey)
  }

  async function endWordRushRound(roomKey, reason, winnerUsername = "") {
    const safeRoomKey = String(roomKey || "")
    const session = wordRushSessionsByRoom.get(safeRoomKey)
    if (!session) {
      clearWordRushTimer(safeRoomKey)
      return
    }

    clearWordRushTimer(safeRoomKey)
    wordRushSessionsByRoom.delete(safeRoomKey)
    const safeWinner = normalizeText(winnerUsername)
    const safeWord = String(session.word || "")
    const createdAt = new Date().toISOString()
    let announcement = `⚡ Word Rush selesai. Kata: "${safeWord}".`
    if (safeWinner) {
      announcement = `⚡ ${safeWinner} berhasil paling cepat untuk kata "${safeWord}"!`
    } else if (reason === "timeout") {
      announcement = `⚡ Waktu habis. Jawaban Word Rush: "${safeWord}".`
    } else if (reason === "players_left") {
      announcement = `⚡ Word Rush berhenti karena pemain kurang. Kata: "${safeWord}".`
    }

    io.to(safeRoomKey).emit("chat message", {
      id: 0,
      username: "Privix Bot",
      message: announcement,
      created_at: createdAt,
      reply_to_message_id: null,
      reply_to: null,
      reactions: [],
      channel: session.channelName,
      server_id: session.serverId
    })

    io.to(safeRoomKey).emit("wordrush round ended", {
      reason: String(reason || "ended"),
      winner_username: safeWinner || null,
      word: safeWord
    })

    await emitWordRushStateToRoom(safeRoomKey)
  }

  function scheduleWordRushTimeout(roomKey) {
    const safeRoomKey = String(roomKey || "")
    const session = wordRushSessionsByRoom.get(safeRoomKey)
    if (!session) return
    clearWordRushTimer(safeRoomKey)
    const delay = Math.max(200, session.endsAtTs - Date.now())
    const timer = setTimeout(() => {
      endWordRushRound(safeRoomKey, "timeout").catch(() => {})
    }, delay)
    wordRushTimerByRoom.set(safeRoomKey, timer)
  }

  async function handleWordRushUserLeave(roomKey, username) {
    const safeRoomKey = String(roomKey || "")
    const safeUsername = normalizeText(username)
    if (!safeRoomKey || !safeUsername) return
    const session = wordRushSessionsByRoom.get(safeRoomKey)
    if (!session) {
      await emitWordRushStateToRoom(safeRoomKey)
      return
    }
    const participants = getGamePlayersFromLobby(safeRoomKey, "wordrush")
    if (participants.length < 2) {
      await endWordRushRound(safeRoomKey, "players_left")
      return
    }
    await emitWordRushStateToRoom(safeRoomKey)
  }

  async function handleGameUserLeave(roomKey, username) {
    const safeRoomKey = String(roomKey || "")
    const safeUsername = normalizeText(username)
    if (!safeRoomKey || !safeUsername) return
    leaveAllGameLobbies(safeRoomKey, safeUsername)
    await Promise.all([
      emitGameLobbyStateToRoom(safeRoomKey),
      handleDrawGuessUserLeave(safeRoomKey, safeUsername),
      handleWordRushUserLeave(safeRoomKey, safeUsername)
    ])
  }

  function notifyVoiceLeave(roomKey) {
    if (!roomKey) return
    socket.to(roomKey).emit("voice user left", {
      id: socket.id,
      username: socket.data.username || ""
    })
  }

  function normalizeVoiceStreamSource(rawValue) {
    const source = String(rawValue || "").trim().toLowerCase()
    if (source === "screen") return "screen"
    if (source === "camera") return "camera"
    return ""
  }

  function applyVoiceStreamState(source, isActive) {
    if (source === "camera") {
      socket.data.voiceCameraEnabled = Boolean(isActive)
      return
    }
    if (source === "screen") {
      socket.data.voiceScreenSharing = Boolean(isActive)
    }
  }

  async function emitVoicePresenceUpdate(serverId, channelName) {
    if (!serverId || !channelName) return
    const voiceRoomKey = buildVoiceRoomKey(serverId, channelName)
    const peers = await io.in(voiceRoomKey).fetchSockets()
    const roomStartedAtTs = resolveVoiceRoomStartedAt(voiceRoomKey, peers)
    const peerList = peers.map((peer) => ({
      id: peer.id,
      username: peer.data.username || "",
      is_muted: Boolean(peer.data.voiceMuted),
      is_camera_enabled: Boolean(peer.data.voiceCameraEnabled),
      is_screen_sharing: Boolean(peer.data.voiceScreenSharing)
    }))
    const presenceRoomKey = buildServerPresenceRoomKey(serverId)
    io.to(presenceRoomKey).emit("voice presence update", {
      server_id: serverId,
      channel: channelName,
      peers: peerList,
      room_started_at_ts: roomStartedAtTs,
      server_now_ts: Date.now()
    })
  }

  async function emitAllVoicePresenceForServer(serverId) {
    const resolvedServerId = Number(serverId)
    if (!Number.isInteger(resolvedServerId) || resolvedServerId <= 0) return

    const voiceChannels = await dbAll(
      "SELECT name FROM channels WHERE server_id = ? AND type = 'voice' ORDER BY id ASC",
      [resolvedServerId]
    )
    for (const row of voiceChannels) {
      const channelName = normalizeText(row && row.name).toLowerCase()
      if (!channelName) continue
      await emitVoicePresenceUpdate(resolvedServerId, channelName)
    }
  }

  async function leaveVoiceRoom({ notifyPeers = true } = {}) {
    const roomKey = socket.data.voiceRoomKey
    if (!roomKey) return
    const serverId = socket.data.voiceServerId
    const channelName = socket.data.voiceChannel
    socket.leave(roomKey)
    if (notifyPeers) {
      notifyVoiceLeave(roomKey)
    }
    socket.data.voiceRoomKey = ""
    socket.data.voiceServerId = null
    socket.data.voiceChannel = ""
    socket.data.voiceMuted = false
    socket.data.voiceCameraEnabled = false
    socket.data.voiceScreenSharing = false
    socket.data.voiceJoinedAtTs = 0
    if (serverId && channelName) {
      emitVoicePresenceUpdate(serverId, channelName).catch(() => {})
    }
  }

  socket.on("set username", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const previousUserId = Number(socket.data.userId) || 0
      const previousUsername = normalizeText(socket.data.username)
      const { username: rawUsername, authToken } = parseUsernamePayload(payload)
      const nextUsername = normalizeText(rawUsername)
      if (!isValidLength(nextUsername, MAX_USERNAME_LENGTH)) {
        reply({ ok: false, error: `Username wajib 1-${MAX_USERNAME_LENGTH} karakter` })
        return
      }

      const { user, authToken: nextAuthToken } = await ensureUser(nextUsername, authToken)
      const previousPresenceKey = buildPresenceUserKey(previousUserId, previousUsername)
      const nextPresenceKey = buildPresenceUserKey(user.id, user.username)
      if (previousPresenceKey && previousPresenceKey !== nextPresenceKey) {
        clearPresenceStatusForUser(previousUserId, previousUsername)
      }
      socket.data.username = user.username
      socket.data.userId = user.id
      const currentStatus = getPresenceStatusForUser(socket.data.userId, socket.data.username)
      setPresenceStatusForUser(socket.data.userId, socket.data.username, currentStatus)
      if (Number.isInteger(Number(socket.data.activeServerId)) && Number(socket.data.activeServerId) > 0) {
        emitServerOnlineUsers(Number(socket.data.activeServerId)).catch(() => {})
      }
      reply({ ok: true, username: user.username, user_id: user.id, auth_token: nextAuthToken || undefined })
    } catch (error) {
      if (error && error.code === "USERNAME_TAKEN") {
        reply({ ok: false, error: "Username sudah digunakan user lain" })
        return
      }
      console.error("set username error:", error)
      reply({ ok: false, error: "Gagal set username" })
    }
  })

  socket.on("set rich status", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId || !socket.data.username) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }
      const nextStatus = setPresenceStatusForUser(socket.data.userId, socket.data.username, payload)
      const activeServerId = Number(socket.data.activeServerId)
      if (Number.isInteger(activeServerId) && activeServerId > 0) {
        emitServerOnlineUsers(activeServerId).catch(() => {})
      }
      reply({ ok: true, status: nextStatus })
    } catch (error) {
      console.error("set rich status error:", error)
      reply({ ok: false, error: "Gagal update status" })
    }
  })

  socket.on("list servers", async (ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const servers = await getMemberServers(socket.data.userId)
      const withChannels = await Promise.all(
        servers.map(async (item) => {
          const channels = await getServerChannels(item.id)
          return { ...item, channels }
        })
      )

      reply({ ok: true, servers: withChannels })
    } catch (error) {
      console.error("list servers error:", error)
      reply({ ok: false, error: "Gagal memuat server" })
    }
  })

  socket.on("list server members", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "server.members.list"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const members = await getServerMembers(serverId)
      reply({ ok: true, members })
    } catch (error) {
      console.error("list server members error:", error)
      reply({ ok: false, error: "Gagal memuat member server" })
    }
  })

  socket.on("list audit logs", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "audit.list"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const rows = await dbAll(
        `
        SELECT al.id, al.action_type, al.details, al.created_at, u.username AS actor_username
        FROM audit_logs al
        JOIN users u ON u.id = al.actor_user_id
        WHERE al.server_id = ?
        ORDER BY al.id DESC
        LIMIT 25
        `,
        [serverId]
      )
      reply({ ok: true, logs: rows })
    } catch (error) {
      console.error("list audit logs error:", error)
      reply({ ok: false, error: "Gagal memuat audit logs" })
    }
  })

  socket.on("set member role", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      const roleName = normalizeText(payload && payload.role).toLowerCase()

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username target wajib diisi" })
        return
      }
      if (roleName !== "admin" && roleName !== "moderator" && roleName !== "member") {
        reply({ ok: false, error: "Role tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "member.role.set"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User tidak ditemukan" })
        return
      }

      const targetMember = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMember) {
        reply({ ok: false, error: "User bukan member server ini" })
        return
      }

      if (targetUser.id === socket.data.userId && roleName !== "admin") {
        reply({ ok: false, error: "Kamu tidak bisa menurunkan role diri sendiri" })
        return
      }

      const roleId = await getRoleIdByName(serverId, roleName)
      await dbRun(
        "UPDATE server_members SET role_id = ? WHERE id = ?",
        [roleId, targetMember.id]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_role_changed", {
        target_username: targetUser.username,
        role: roleName
      })

      reply({ ok: true, username: targetUser.username, role: roleName })
    } catch (error) {
      console.error("set member role error:", error)
      reply({ ok: false, error: "Gagal update role member" })
    }
  })

  socket.on("kick member", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username target wajib diisi" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "member.kick"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, name, owner_user_id FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User target tidak ditemukan" })
        return
      }

      if (Number(targetUser.id) === Number(socket.data.userId)) {
        reply({ ok: false, error: "Kamu tidak bisa kick diri sendiri" })
        return
      }

      if (Number(targetUser.id) === Number(serverRow.owner_user_id)) {
        reply({ ok: false, error: "Owner server tidak bisa di-kick" })
        return
      }

      const targetMembership = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMembership) {
        reply({ ok: false, error: "User target bukan member server ini" })
        return
      }

      const requesterRoleInfo = permissionCheck.roleInfo
      const targetRoleInfo = await getMemberRoleInfo(targetUser.id, serverId)
      if (!requesterRoleInfo || !targetRoleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }

      if (requesterRoleInfo.priority <= targetRoleInfo.priority) {
        reply({ ok: false, error: "Kamu hanya bisa kick member dengan role di bawahmu" })
        return
      }

      await dbRun(
        "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
        [serverId, targetUser.id]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_kicked", {
        target_username: targetUser.username
      })

      const sockets = await io.fetchSockets()
      for (const s of sockets) {
        if (Number(s.data.userId) !== Number(targetUser.id)) continue
        if (Number(s.data.activeServerId) === serverId) {
          if (s.data.roomKey) {
            s.leave(s.data.roomKey)
          }
          s.leave(buildServerPresenceRoomKey(serverId))
          s.data.roomKey = ""
          s.data.activeServerId = null
          s.data.activeChannel = ""
          s.data.joinVersion = Number(s.data.joinVersion || 0) + 1
        }
        s.emit("removed from server", {
          server_id: serverId,
          server_name: serverRow.name,
          reason: "kicked"
        })
      }
      emitServerOnlineUsers(serverId).catch(() => {})

      reply({
        ok: true,
        server_id: serverId,
        target_username: targetUser.username
      })
    } catch (error) {
      console.error("kick member error:", error)
      reply({ ok: false, error: "Gagal kick member" })
    }
  })

  socket.on("mute member", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      const durationMinutes = Number(payload && payload.duration_minutes)
      const reason = normalizeText(payload && payload.reason)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username target wajib diisi" })
        return
      }
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
        reply({ ok: false, error: "Durasi mute harus 1-10080 menit" })
        return
      }
      if (reason.length > 200) {
        reply({ ok: false, error: "Alasan mute maksimal 200 karakter" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "member.mute"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, name, owner_user_id FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User target tidak ditemukan" })
        return
      }

      if (Number(targetUser.id) === Number(socket.data.userId)) {
        reply({ ok: false, error: "Kamu tidak bisa mute diri sendiri" })
        return
      }

      if (Number(targetUser.id) === Number(serverRow.owner_user_id)) {
        reply({ ok: false, error: "Owner server tidak bisa di-mute" })
        return
      }

      const targetMembership = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMembership) {
        reply({ ok: false, error: "User target bukan member server ini" })
        return
      }

      const requesterRoleInfo = permissionCheck.roleInfo
      const targetRoleInfo = await getMemberRoleInfo(targetUser.id, serverId)
      if (!requesterRoleInfo || !targetRoleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }

      if (requesterRoleInfo.priority <= targetRoleInfo.priority) {
        reply({ ok: false, error: "Kamu hanya bisa mute member dengan role di bawahmu" })
        return
      }

      const mutedUntilTs = Date.now() + durationMinutes * 60 * 1000
      await dbRun(
        `
        UPDATE server_members
        SET muted_until_ts = ?, mute_reason = ?, muted_by_user_id = ?
        WHERE server_id = ? AND user_id = ?
        `,
        [mutedUntilTs, reason || null, socket.data.userId, serverId, targetUser.id]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_muted", {
        target_username: targetUser.username,
        duration_minutes: durationMinutes,
        mute_reason: reason || null,
        muted_until_ts: mutedUntilTs
      })

      const sockets = await io.fetchSockets()
      for (const s of sockets) {
        if (Number(s.data.userId) !== Number(targetUser.id)) continue
        s.emit("member mute state", {
          server_id: serverId,
          server_name: serverRow.name,
          is_muted: true,
          muted_until_ts: mutedUntilTs,
          mute_reason: reason || null
        })
      }

      reply({
        ok: true,
        server_id: serverId,
        target_username: targetUser.username,
        duration_minutes: durationMinutes,
        muted_until_ts: mutedUntilTs
      })
    } catch (error) {
      console.error("mute member error:", error)
      reply({ ok: false, error: "Gagal mute member" })
    }
  })

  socket.on("unmute member", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username target wajib diisi" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "member.mute"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, name, owner_user_id FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User target tidak ditemukan" })
        return
      }

      const targetMembership = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMembership) {
        reply({ ok: false, error: "User target bukan member server ini" })
        return
      }

      const requesterRoleInfo = permissionCheck.roleInfo
      const targetRoleInfo = await getMemberRoleInfo(targetUser.id, serverId)
      if (!requesterRoleInfo || !targetRoleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }
      if (requesterRoleInfo.priority <= targetRoleInfo.priority) {
        reply({ ok: false, error: "Kamu hanya bisa unmute member dengan role di bawahmu" })
        return
      }

      await dbRun(
        `
        UPDATE server_members
        SET muted_until_ts = NULL, mute_reason = NULL, muted_by_user_id = NULL
        WHERE server_id = ? AND user_id = ?
        `,
        [serverId, targetUser.id]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_unmuted", {
        target_username: targetUser.username
      })

      const sockets = await io.fetchSockets()
      for (const s of sockets) {
        if (Number(s.data.userId) !== Number(targetUser.id)) continue
        s.emit("member mute state", {
          server_id: serverId,
          server_name: serverRow.name,
          is_muted: false,
          muted_until_ts: null,
          mute_reason: null
        })
      }

      reply({
        ok: true,
        server_id: serverId,
        target_username: targetUser.username
      })
    } catch (error) {
      console.error("unmute member error:", error)
      reply({ ok: false, error: "Gagal unmute member" })
    }
  })

  socket.on("rename server", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const serverName = normalizeText(payload && payload.name)

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(serverName, MAX_SERVER_NAME_LENGTH)) {
        reply({ ok: false, error: `Nama server wajib 1-${MAX_SERVER_NAME_LENGTH} karakter` })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "server.rename"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      await dbRun("UPDATE servers SET name = ? WHERE id = ?", [serverName, serverId])
      await writeAuditLog(serverId, socket.data.userId, "server_renamed", { server_name: serverName })

      reply({ ok: true, server_id: serverId, name: serverName })
    } catch (error) {
      console.error("rename server error:", error)
      reply({ ok: false, error: "Gagal rename server" })
    }
  })

  socket.on("transfer server owner", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username owner baru wajib diisi" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "server.owner.transfer"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const ownerCheck = await requireServerOwner(socket.data.userId, serverId)
      if (!ownerCheck.ok) {
        reply({ ok: false, error: ownerCheck.error })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User target tidak ditemukan" })
        return
      }
      if (Number(targetUser.id) === Number(socket.data.userId)) {
        reply({ ok: false, error: "Owner baru harus user lain" })
        return
      }

      const targetMembership = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMembership) {
        reply({ ok: false, error: "User target bukan member server ini" })
        return
      }

      const adminRoleId = await getRoleIdByName(serverId, "admin")
      await dbRun("BEGIN TRANSACTION")
      await dbRun(
        "UPDATE servers SET owner_user_id = ? WHERE id = ?",
        [targetUser.id, serverId]
      )
      await dbRun(
        "UPDATE server_members SET role_id = ? WHERE server_id = ? AND user_id = ?",
        [adminRoleId, serverId, targetUser.id]
      )
      await dbRun("COMMIT")

      await writeAuditLog(serverId, socket.data.userId, "server_owner_transferred", {
        from_username: socket.data.username,
        to_username: targetUser.username
      })

      reply({
        ok: true,
        server_id: serverId,
        new_owner_user_id: targetUser.id,
        new_owner_username: targetUser.username
      })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("transfer server owner error:", error)
      reply({ ok: false, error: "Gagal transfer owner server" })
    }
  })

  socket.on("leave server", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, owner_user_id, name FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const memberRows = await dbAll(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ?",
        [serverId, socket.data.userId]
      )
      if (!memberRows || memberRows.length === 0) {
        reply({ ok: false, error: "Kamu bukan member server ini" })
        return
      }

      if (Number(serverRow.owner_user_id) === Number(socket.data.userId)) {
        reply({ ok: false, error: "Owner belum bisa leave server. Transfer owner dulu." })
        return
      }

      await dbRun(
        "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
        [serverId, socket.data.userId]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_left_server", {
        username: socket.data.username
      })

      if (Number(socket.data.activeServerId) === serverId) {
        if (socket.data.roomKey) {
          clearTypingIndicator()
          socket.leave(socket.data.roomKey)
        }
        socket.leave(buildServerPresenceRoomKey(serverId))
        socket.data.roomKey = ""
        socket.data.activeServerId = null
        socket.data.activeChannel = ""
      }
      emitServerOnlineUsers(serverId).catch(() => {})

      const remainingServers = await getMemberServers(socket.data.userId)
      const nextServerId = remainingServers.length > 0 ? remainingServers[0].id : null

      reply({ ok: true, left_server_id: serverId, next_server_id: nextServerId })
    } catch (error) {
      console.error("leave server error:", error)
      reply({ ok: false, error: "Gagal leave server" })
    }
  })

  socket.on("delete server", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const ownerCheck = await requireServerOwner(socket.data.userId, serverId)
      if (!ownerCheck.ok) {
        reply({ ok: false, error: ownerCheck.error })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, owner_user_id, name FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const memberRows = await dbAll(
        "SELECT DISTINCT user_id FROM server_members WHERE server_id = ?",
        [serverId]
      )
      const affectedUserIds = new Set(
        (Array.isArray(memberRows) ? memberRows : [])
          .map((row) => Number(row && row.user_id))
          .filter((value) => Number.isInteger(value) && value > 0)
      )

      await dbRun("DELETE FROM servers WHERE id = ?", [serverId])

      if (Number(socket.data.activeServerId) === serverId) {
        clearTypingIndicator()
        if (socket.data.roomKey) {
          socket.leave(socket.data.roomKey)
        }
        socket.leave(buildServerPresenceRoomKey(serverId))
        socket.data.roomKey = ""
        socket.data.activeServerId = null
        socket.data.activeChannel = ""
        socket.data.joinVersion = Number(socket.data.joinVersion || 0) + 1
      }
      if (Number(socket.data.voiceServerId) === serverId) {
        await leaveVoiceRoom({ notifyPeers: true })
      }

      const sockets = await io.fetchSockets()
      for (const peer of sockets) {
        const peerUserId = Number(peer.data.userId)
        if (!affectedUserIds.has(peerUserId)) continue
        if (peer.id === socket.id) continue

        if (Number(peer.data.activeServerId) === serverId) {
          if (peer.data.roomKey) {
            peer.leave(peer.data.roomKey)
          }
          peer.leave(buildServerPresenceRoomKey(serverId))
          peer.data.roomKey = ""
          peer.data.activeServerId = null
          peer.data.activeChannel = ""
          peer.data.joinVersion = Number(peer.data.joinVersion || 0) + 1
        }

        if (Number(peer.data.voiceServerId) === serverId) {
          const peerVoiceRoomKey = peer.data.voiceRoomKey
          if (peerVoiceRoomKey) {
            peer.to(peerVoiceRoomKey).emit("voice user left", {
              id: peer.id,
              username: peer.data.username || ""
            })
            peer.leave(peerVoiceRoomKey)
          }
          peer.data.voiceRoomKey = ""
          peer.data.voiceServerId = null
          peer.data.voiceChannel = ""
          peer.data.voiceMuted = false
          peer.data.voiceCameraEnabled = false
          peer.data.voiceScreenSharing = false
          peer.data.voiceJoinedAtTs = 0
        }

        peer.emit("removed from server", {
          server_id: serverId,
          server_name: serverRow.name,
          reason: "deleted"
        })
      }

      const remainingServers = await getMemberServers(socket.data.userId)
      const nextServerId = remainingServers.length > 0 ? remainingServers[0].id : null

      reply({ ok: true, deleted_server_id: serverId, next_server_id: nextServerId })
    } catch (error) {
      console.error("delete server error:", error)
      reply({ ok: false, error: "Gagal menghapus server" })
    }
  })

  socket.on("create server", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverName = normalizeText(payload && payload.name)
      if (!isValidLength(serverName, MAX_SERVER_NAME_LENGTH)) {
        reply({ ok: false, error: `Nama server wajib 1-${MAX_SERVER_NAME_LENGTH} karakter` })
        return
      }

      await dbRun("BEGIN TRANSACTION")

      const serverResult = await dbRun(
        "INSERT INTO servers (name, owner_user_id) VALUES (?, ?)",
        [serverName, socket.data.userId]
      )
      const serverId = serverResult.lastID

      const adminRole = await dbRun(
        "INSERT INTO roles (server_id, name, priority) VALUES (?, 'admin', 100)",
        [serverId]
      )

      await dbRun(
        "INSERT INTO roles (server_id, name, priority) VALUES (?, 'member', 1)",
        [serverId]
      )
      await dbRun(
        "INSERT INTO roles (server_id, name, priority) VALUES (?, 'moderator', 50)",
        [serverId]
      )

      await dbRun(
        "INSERT INTO server_members (server_id, user_id, role_id) VALUES (?, ?, ?)",
        [serverId, socket.data.userId, adminRole.lastID]
      )

      await dbRun(
        "INSERT INTO channels (server_id, name, type) VALUES (?, 'general', 'text')",
        [serverId]
      )

      const inviteCode = await ensureInviteForServer(serverId, socket.data.userId)

      await dbRun("COMMIT")
      reply({
        ok: true,
        server_id: serverId,
        server: {
          id: serverId,
          name: serverName,
          channels: [{ name: "general", type: "text" }]
        },
        invite_code: inviteCode
      })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("create server error:", error)
      reply({ ok: false, error: "Gagal membuat server" })
    }
  })

  socket.on("create channel", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.name).toLowerCase()
      const channelType = normalizeText(payload && payload.type).toLowerCase() || "text"
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: `Nama channel wajib 1-${MAX_CHANNEL_LENGTH} karakter` })
        return
      }
      if (!CHANNEL_NAME_PATTERN.test(channelName)) {
        reply({ ok: false, error: "Nama channel hanya boleh huruf kecil, angka, dan '-'" })
        return
      }
      if (!["text", "voice"].includes(channelType)) {
        reply({ ok: false, error: "Tipe channel tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.create"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      await dbRun(
        "INSERT INTO channels (server_id, name, type) VALUES (?, ?, ?)",
        [serverId, channelName, channelType]
      )
      await writeAuditLog(serverId, socket.data.userId, "channel_created", {
        channel: channelName,
        type: channelType
      })
      reply({
        ok: true,
        channel: { server_id: serverId, name: channelName, type: channelType }
      })
    } catch (error) {
      if (error && String(error.message || "").includes("UNIQUE")) {
        reply({ ok: false, error: "Channel sudah ada di server ini" })
        return
      }
      console.error("create channel error:", error)
      reply({ ok: false, error: "Gagal membuat channel" })
    }
  })

  socket.on("get channel permission", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      const roleName = normalizeText(payload && payload.role).toLowerCase() || "member"

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.permission.view"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const channelRow = await dbGet(
        "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }

      const permission = await getChannelPermission(channelRow.id, roleName)
      reply({
        ok: true,
        role: roleName,
        can_view: permission ? Number(permission.can_view) === 1 : true,
        can_send: permission ? Number(permission.can_send) === 1 : true
      })
    } catch (error) {
      console.error("get channel permission error:", error)
      reply({ ok: false, error: "Gagal mengambil permission channel" })
    }
  })

  socket.on("set channel permission", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      const roleName = normalizeText(payload && payload.role).toLowerCase()
      const canView = payload && payload.can_view ? 1 : 0
      const canSend = payload && payload.can_send ? 1 : 0

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }
      if (roleName !== "member") {
        reply({ ok: false, error: "Saat ini hanya role member yang bisa diatur" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.permission.set"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const channelRow = await dbGet(
        "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }

      await dbRun(
        `
        INSERT INTO channel_permissions (channel_id, role_name, can_view, can_send)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(channel_id, role_name)
        DO UPDATE SET can_view = excluded.can_view, can_send = excluded.can_send
        `,
        [channelRow.id, roleName, canView, canSend]
      )
      await writeAuditLog(serverId, socket.data.userId, "channel_permission_updated", {
        channel: channelName,
        role: roleName,
        can_view: canView === 1,
        can_send: canSend === 1
      })

      reply({ ok: true, role: roleName, can_view: canView === 1, can_send: canSend === 1 })
    } catch (error) {
      console.error("set channel permission error:", error)
      reply({ ok: false, error: "Gagal menyimpan permission channel" })
    }
  })

  socket.on("get server invite", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "invite.get"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const code = await ensureInviteForServer(serverId, socket.data.userId)
      reply({ ok: true, code })
    } catch (error) {
      console.error("get server invite error:", error)
      reply({ ok: false, error: "Gagal mengambil invite code" })
    }
  })

  socket.on("regenerate server invite", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "invite.regenerate"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      await dbRun("DELETE FROM invites WHERE server_id = ?", [serverId])
      const code = await ensureInviteForServer(serverId, socket.data.userId)
      await writeAuditLog(serverId, socket.data.userId, "server_invite_regenerated", { code })

      reply({ ok: true, code })
    } catch (error) {
      console.error("regenerate server invite error:", error)
      reply({ ok: false, error: "Gagal regenerate invite code" })
    }
  })

  socket.on("preview invite", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const code = normalizeText(payload && payload.code).toUpperCase()
      if (!code) {
        reply({ ok: false, error: "Invite code tidak valid" })
        return
      }

      const invite = await getValidInviteByCode(code)
      debugServer("invite", "preview ok", {
        socketId: socket.id,
        code,
        serverId: invite.server_id
      })
      let alreadyMember = false
      if (socket.data.userId) {
        const existingMember = await dbGet(
          "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
          [invite.server_id, socket.data.userId]
        )
        alreadyMember = Boolean(existingMember)
      }

      reply({
        ok: true,
        code: invite.code,
        server_id: invite.server_id,
        server_name: invite.server_name,
        already_member: alreadyMember
      })
    } catch (error) {
      const knownInviteError = error && String(error.code || "").startsWith("INVITE_")
      if (!knownInviteError) {
        console.error("preview invite error:", error)
      }
      reply({ ok: false, error: error.message || "Gagal memeriksa invite" })
    }
  })

  socket.on("join via invite", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const code = normalizeText(payload && payload.code).toUpperCase()
      if (!code) {
        reply({ ok: false, error: "Invite code tidak valid" })
        return
      }

      const invite = await getValidInviteByCode(code)
      debugServer("invite", "join requested", {
        socketId: socket.id,
        code,
        serverId: invite.server_id,
        userId: socket.data.userId
      })

      const memberRoleId = await ensureMemberRoleId(invite.server_id)
      const existingMember = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [invite.server_id, socket.data.userId]
      )

      await dbRun("BEGIN TRANSACTION")
      if (!existingMember) {
        await dbRun(
          "INSERT INTO server_members (server_id, user_id, role_id) VALUES (?, ?, ?)",
          [invite.server_id, socket.data.userId, memberRoleId]
        )
        await dbRun(
          "UPDATE invites SET used_count = used_count + 1 WHERE id = ?",
          [invite.id]
        )
        await writeAuditLog(invite.server_id, socket.data.userId, "member_joined_via_invite", {
          code: invite.code
        })
      }
      await dbRun("COMMIT")

      await dbRun(
        "INSERT OR IGNORE INTO channels (server_id, name, type) VALUES (?, 'general', 'text')",
        [invite.server_id]
      )

      reply({ ok: true, server_id: invite.server_id })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("join via invite error:", error)
      reply({ ok: false, error: "Gagal join via invite" })
    }
  })

  socket.on("delete channel", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }
      if (channelName === "general") {
        reply({ ok: false, error: "Channel #general tidak bisa dihapus" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.delete"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const channelRow = await dbGet(
        "SELECT id, name FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }

      const roomKey = buildRoomKey(serverId, channelName)
      clearDrawGuessRoomData(roomKey)
      await dbRun("BEGIN TRANSACTION")
      await dbRun("DELETE FROM messages WHERE channel = ?", [roomKey])
      await dbRun("DELETE FROM channels WHERE id = ?", [channelRow.id])
      await dbRun("COMMIT")
      await writeAuditLog(serverId, socket.data.userId, "channel_deleted", {
        channel: channelName
      })

      io.to(roomKey).emit("system error", { message: `Channel #${channelName} telah dihapus` })
      reply({ ok: true, deleted_channel: channelName })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("delete channel error:", error)
      reply({ ok: false, error: "Gagal menghapus channel" })
    }
  })

  socket.on("rename channel", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const oldChannel = normalizeText(payload && payload.old_channel).toLowerCase()
      const newChannel = normalizeText(payload && payload.new_channel).toLowerCase()

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(oldChannel, MAX_CHANNEL_LENGTH) || !isValidLength(newChannel, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Nama channel tidak valid" })
        return
      }
      if (!CHANNEL_NAME_PATTERN.test(newChannel)) {
        reply({ ok: false, error: "Nama channel hanya boleh huruf kecil, angka, dan '-'" })
        return
      }
      if (oldChannel === "general") {
        reply({ ok: false, error: "Channel #general tidak bisa di-rename" })
        return
      }
      if (oldChannel === newChannel) {
        reply({ ok: false, error: "Nama channel baru harus berbeda" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.rename"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const oldChannelRow = await dbGet(
        "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, oldChannel]
      )
      if (!oldChannelRow) {
        reply({ ok: false, error: "Channel lama tidak ditemukan" })
        return
      }

      const existingNew = await dbGet(
        "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, newChannel]
      )
      if (existingNew) {
        reply({ ok: false, error: "Nama channel baru sudah dipakai" })
        return
      }

      const oldRoomKey = buildRoomKey(serverId, oldChannel)
      const newRoomKey = buildRoomKey(serverId, newChannel)
      const movedGameState = moveDrawGuessRoomState(oldRoomKey, newRoomKey)

      await dbRun("BEGIN TRANSACTION")
      await dbRun(
        "UPDATE channels SET name = ? WHERE id = ?",
        [newChannel, oldChannelRow.id]
      )
      await dbRun(
        "UPDATE messages SET channel = ? WHERE channel = ?",
        [newRoomKey, oldRoomKey]
      )
      await dbRun("COMMIT")
      await writeAuditLog(serverId, socket.data.userId, "channel_renamed", {
        old_channel: oldChannel,
        new_channel: newChannel
      })

      const roomSockets = await io.in(oldRoomKey).fetchSockets()
      for (const s of roomSockets) {
        s.leave(oldRoomKey)
        s.join(newRoomKey)
        if (Number(s.data.activeServerId) === serverId && s.data.activeChannel === oldChannel) {
          s.data.activeChannel = newChannel
          s.data.roomKey = newRoomKey
        }
      }

      io.to(newRoomKey).emit("channel renamed", {
        server_id: serverId,
        old_channel: oldChannel,
        new_channel: newChannel
      })
      if (movedGameState && movedGameState.movedDrawGuess) {
        scheduleDrawGuessTimeout(newRoomKey)
        emitDrawGuessStateToRoom(newRoomKey).catch(() => {})
      }
      if (movedGameState && movedGameState.movedWordRush) {
        scheduleWordRushTimeout(newRoomKey)
        emitWordRushStateToRoom(newRoomKey).catch(() => {})
      }
      if (movedGameState && movedGameState.movedLobby) {
        emitGameLobbyStateToRoom(newRoomKey).catch(() => {})
      }

      reply({
        ok: true,
        server_id: serverId,
        old_channel: oldChannel,
        new_channel: newChannel
      })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("rename channel error:", error)
      reply({ ok: false, error: "Gagal rename channel" })
    }
  })

  socket.on("voice join", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      voiceDebugServer("voice join request", {
        socketId: socket.id,
        serverId: Number(payload && payload.server_id),
        channel: normalizeText(payload && payload.channel).toLowerCase(),
        isMuted: Boolean(payload && payload.is_muted),
        isCameraEnabled: Boolean(payload && payload.is_camera_enabled),
        isScreenSharing: Boolean(payload && payload.is_screen_sharing)
      })
      if (!socket.data.userId || !socket.data.username) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }

      const member = await isServerMember(socket.data.userId, serverId)
      if (!member) {
        reply({ ok: false, error: "Kamu bukan member server ini" })
        return
      }

      const channelRow = await dbGet(
        "SELECT id, name, type FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }
      if (String(channelRow.type || "text") !== "voice") {
        reply({ ok: false, error: "Channel ini bukan voice channel" })
        return
      }

      const roleInfo = await getMemberRoleInfo(socket.data.userId, serverId)
      if (!roleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }

      if (roleInfo.priority < 100) {
        const permission = await getChannelPermission(channelRow.id, roleInfo.roleName)
        if (permission && Number(permission.can_view) !== 1) {
          reply({ ok: false, error: "Kamu tidak punya akses masuk voice channel ini" })
          return
        }
      }

      let canSpeak = true
      if (roleInfo.priority < 100) {
        const permission = await getChannelPermission(channelRow.id, roleInfo.roleName)
        if (permission && Number(permission.can_send) !== 1) {
          canSpeak = false
        }
      }
      const muteState = await getMemberMuteState(socket.data.userId, serverId)
      if (muteState.isMuted) {
        canSpeak = false
      }

      const voiceRoomKey = buildVoiceRoomKey(serverId, channelName)
      if (socket.data.voiceRoomKey === voiceRoomKey) {
        if (!Number(socket.data.voiceJoinedAtTs)) {
          socket.data.voiceJoinedAtTs = Date.now()
        }
        socket.data.voiceMuted = Boolean(payload && payload.is_muted)
        socket.data.voiceCameraEnabled = Boolean(payload && payload.is_camera_enabled)
        socket.data.voiceScreenSharing = Boolean(payload && payload.is_screen_sharing)
        const peers = await io.in(voiceRoomKey).fetchSockets()
        let roomStartedAtTs = resolveVoiceRoomStartedAt(voiceRoomKey, peers)
        if (!roomStartedAtTs) {
          roomStartedAtTs = Date.now()
          voiceRoomStartedAtByKey.set(voiceRoomKey, roomStartedAtTs)
        }
        const peerList = peers
          .filter((peer) => peer.id !== socket.id)
          .map((peer) => ({
            id: peer.id,
            username: peer.data.username || "",
            is_muted: Boolean(peer.data.voiceMuted),
            is_camera_enabled: Boolean(peer.data.voiceCameraEnabled),
            is_screen_sharing: Boolean(peer.data.voiceScreenSharing)
          }))

        reply({
          ok: true,
          server_id: serverId,
          channel: channelName,
          peers: peerList,
          can_speak: canSpeak,
          voice_mode: SFU_CONFIG.enabled ? "sfu" : "mesh",
          room_started_at_ts: roomStartedAtTs,
          server_now_ts: Date.now()
        })
        emitVoicePresenceUpdate(serverId, channelName).catch(() => {})
        return
      }
      if (socket.data.voiceRoomKey && socket.data.voiceRoomKey !== voiceRoomKey) {
        await leaveVoiceRoom({ notifyPeers: true })
      }

      socket.data.voiceMuted = Boolean(payload && payload.is_muted)
      socket.data.voiceCameraEnabled = Boolean(payload && payload.is_camera_enabled)
      socket.data.voiceScreenSharing = Boolean(payload && payload.is_screen_sharing)
      const peers = await io.in(voiceRoomKey).fetchSockets()
      let roomStartedAtTs = resolveVoiceRoomStartedAt(voiceRoomKey, peers)
      if (!roomStartedAtTs) {
        roomStartedAtTs = Date.now()
        voiceRoomStartedAtByKey.set(voiceRoomKey, roomStartedAtTs)
      }
      const peerList = peers
        .filter((peer) => peer.id !== socket.id)
        .map((peer) => ({
          id: peer.id,
          username: peer.data.username || "",
          is_muted: Boolean(peer.data.voiceMuted),
          is_camera_enabled: Boolean(peer.data.voiceCameraEnabled),
          is_screen_sharing: Boolean(peer.data.voiceScreenSharing)
        }))

      socket.join(voiceRoomKey)
      socket.data.voiceRoomKey = voiceRoomKey
      socket.data.voiceServerId = serverId
      socket.data.voiceChannel = channelName
      socket.data.voiceJoinedAtTs = Date.now()
      const joinedRoomStartedAtTs = roomStartedAtTs

      socket.to(voiceRoomKey).emit("voice user joined", {
        id: socket.id,
        username: socket.data.username || "",
        is_muted: Boolean(socket.data.voiceMuted),
        is_camera_enabled: Boolean(socket.data.voiceCameraEnabled),
        is_screen_sharing: Boolean(socket.data.voiceScreenSharing),
        room_started_at_ts: joinedRoomStartedAtTs,
        server_now_ts: Date.now()
      })

      emitVoicePresenceUpdate(serverId, channelName).catch(() => {})

      reply({
        ok: true,
        server_id: serverId,
        channel: channelName,
        peers: peerList,
        can_speak: canSpeak,
        voice_mode: SFU_CONFIG.enabled ? "sfu" : "mesh",
        room_started_at_ts: joinedRoomStartedAtTs,
        server_now_ts: Date.now()
      })
      voiceDebugServer("voice join success", {
        socketId: socket.id,
        serverId,
        channel: channelName,
        peers: peerList.length,
        canSpeak,
        voiceRoomKey
      })
    } catch (error) {
      voiceDebugServer("voice join error", {
        socketId: socket.id,
        message: error && error.message ? error.message : String(error)
      })
      console.error("voice join error:", error)
      reply({ ok: false, error: "Gagal join voice channel" })
    }
  })

  socket.on("voice sfu token", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId || !socket.data.username) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }
      if (!SFU_CONFIG.enabled) {
        reply({ ok: false, error: "SFU belum aktif di server" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }

      const expectedVoiceRoomKey = buildVoiceRoomKey(serverId, channelName)
      if (socket.data.voiceRoomKey !== expectedVoiceRoomKey) {
        reply({ ok: false, error: "Join voice dulu sebelum meminta token SFU" })
        return
      }

      const member = await isServerMember(socket.data.userId, serverId)
      if (!member) {
        reply({ ok: false, error: "Kamu bukan member server ini" })
        return
      }

      const roomName = buildSfuRoomName(serverId, channelName)
      const token = await issueLivekitToken(SFU_CONFIG, {
        identity: socket.id,
        displayName: socket.data.username || "Unknown",
        roomName,
        metadata: {
          user_id: Number(socket.data.userId) || 0,
          username: socket.data.username || "",
          server_id: serverId,
          channel: channelName
        }
      })

      reply({
        ok: true,
        provider: SFU_CONFIG.provider || "livekit",
        ws_url: SFU_CONFIG.wsUrl,
        token,
        room_name: roomName,
        identity: socket.id
      })
      voiceDebugServer("voice sfu token issued", {
        socketId: socket.id,
        roomName,
        serverId,
        channel: channelName
      })
    } catch (error) {
      voiceDebugServer("voice sfu token error", {
        socketId: socket.id,
        message: error && error.message ? error.message : String(error)
      })
      reply({ ok: false, error: "Gagal membuat token SFU" })
    }
  })

  socket.on("voice presence", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId || !socket.data.username) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }

      const member = await isServerMember(socket.data.userId, serverId)
      if (!member) {
        reply({ ok: false, error: "Kamu bukan member server ini" })
        return
      }

      const channelRow = await dbGet(
        "SELECT id, name, type FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }
      if (String(channelRow.type || "text") !== "voice") {
        reply({ ok: false, error: "Channel ini bukan voice channel" })
        return
      }

      const roleInfo = await getMemberRoleInfo(socket.data.userId, serverId)
      if (!roleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }

      if (roleInfo.priority < 100) {
        const permission = await getChannelPermission(channelRow.id, roleInfo.roleName)
        if (permission && Number(permission.can_view) !== 1) {
          reply({ ok: false, error: "Kamu tidak punya akses melihat channel ini" })
          return
        }
      }

      const voiceRoomKey = buildVoiceRoomKey(serverId, channelName)
      const peers = await io.in(voiceRoomKey).fetchSockets()
      const roomStartedAtTs = resolveVoiceRoomStartedAt(voiceRoomKey, peers)
      const peerList = peers.map((peer) => ({
        id: peer.id,
        username: peer.data.username || "",
        is_muted: Boolean(peer.data.voiceMuted),
        is_camera_enabled: Boolean(peer.data.voiceCameraEnabled),
        is_screen_sharing: Boolean(peer.data.voiceScreenSharing)
      }))

      reply({
        ok: true,
        server_id: serverId,
        channel: channelName,
        peers: peerList,
        room_started_at_ts: roomStartedAtTs,
        server_now_ts: Date.now()
      })
    } catch (error) {
      console.error("voice presence error:", error)
      reply({ ok: false, error: "Gagal ambil data voice" })
    }
  })

  socket.on("voice leave", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      await leaveVoiceRoom({ notifyPeers: true })
      reply({ ok: true })
    } catch (error) {
      console.error("voice leave error:", error)
      reply({ ok: false, error: "Gagal keluar voice channel" })
    }
  })

  socket.on("voice signal", (payload) => {
    try {
      const targetId = payload && (payload.target_id || payload.targetId)
      const data = payload && payload.data
      if (!targetId || !data || !socket.data.voiceRoomKey) return
      voiceDebugServer("voice signal relay request", {
        fromId: socket.id,
        targetId,
        type: data && data.type ? data.type : data && data.candidate ? "candidate" : data && data.restart ? "restart" : "unknown",
        roomKey: socket.data.voiceRoomKey
      })

      const targetSocket = io.sockets.sockets.get(targetId)
      if (!targetSocket || targetSocket.data.voiceRoomKey !== socket.data.voiceRoomKey) {
        return
      }

      targetSocket.emit("voice signal", {
        from_id: socket.id,
        data
      })
      voiceDebugServer("voice signal relayed", {
        fromId: socket.id,
        targetId,
        type: data && data.type ? data.type : data && data.candidate ? "candidate" : data && data.restart ? "restart" : "unknown"
      })
    } catch (error) {
      console.error("voice signal error:", error)
    }
  })

  socket.on("voice mute state", (payload) => {
    try {
      if (!socket.data.voiceRoomKey) return
      socket.data.voiceMuted = Boolean(payload && payload.is_muted)
      socket.to(socket.data.voiceRoomKey).emit("voice mute state", {
        id: socket.id,
        is_muted: Boolean(socket.data.voiceMuted)
      })
      if (socket.data.voiceServerId && socket.data.voiceChannel) {
        emitVoicePresenceUpdate(socket.data.voiceServerId, socket.data.voiceChannel).catch(() => {})
      }
    } catch (error) {
      console.error("voice mute state error:", error)
    }
  })

  socket.on("voice stream state", (payload) => {
    try {
      if (!socket.data.voiceRoomKey) return
      const source = normalizeVoiceStreamSource(payload && payload.source)
      if (!source) return
      const isActive = Boolean(payload && payload.is_active)
      applyVoiceStreamState(source, isActive)
      voiceDebugServer("voice stream state", {
        socketId: socket.id,
        roomKey: socket.data.voiceRoomKey,
        source,
        isActive
      })
      socket.to(socket.data.voiceRoomKey).emit("voice stream state", {
        id: socket.id,
        source,
        is_active: isActive
      })
      if (socket.data.voiceServerId && socket.data.voiceChannel) {
        emitVoicePresenceUpdate(socket.data.voiceServerId, socket.data.voiceChannel).catch(() => {})
      }
    } catch (error) {
      console.error("voice stream state error:", error)
    }
  })

  socket.on("voice camera state", (payload) => {
    try {
      if (!socket.data.voiceRoomKey) return
      applyVoiceStreamState("camera", Boolean(payload && payload.is_camera_enabled))
      voiceDebugServer("voice camera state", {
        socketId: socket.id,
        roomKey: socket.data.voiceRoomKey,
        isCameraEnabled: socket.data.voiceCameraEnabled
      })
      socket.to(socket.data.voiceRoomKey).emit("voice camera state", {
        id: socket.id,
        is_camera_enabled: Boolean(socket.data.voiceCameraEnabled)
      })
      if (socket.data.voiceServerId && socket.data.voiceChannel) {
        emitVoicePresenceUpdate(socket.data.voiceServerId, socket.data.voiceChannel).catch(() => {})
      }
    } catch (error) {
      console.error("voice camera state error:", error)
    }
  })

  socket.on("voice screen state", (payload) => {
    try {
      if (!socket.data.voiceRoomKey) return
      applyVoiceStreamState("screen", Boolean(payload && payload.is_screen_sharing))
      voiceDebugServer("voice screen state", {
        socketId: socket.id,
        roomKey: socket.data.voiceRoomKey,
        isScreenSharing: socket.data.voiceScreenSharing
      })
      socket.to(socket.data.voiceRoomKey).emit("voice screen state", {
        id: socket.id,
        is_screen_sharing: Boolean(socket.data.voiceScreenSharing)
      })
      if (socket.data.voiceServerId && socket.data.voiceChannel) {
        emitVoicePresenceUpdate(socket.data.voiceServerId, socket.data.voiceChannel).catch(() => {})
      }
    } catch (error) {
      console.error("voice screen state error:", error)
    }
  })

  socket.on("join server channel", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId || !socket.data.username) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }

      const member = await isServerMember(socket.data.userId, serverId)
      if (!member) {
        reply({ ok: false, error: "Kamu bukan member server ini" })
        return
      }

      const channelRow = await dbGet(
        "SELECT id, name FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }

      const roleInfo = await getMemberRoleInfo(socket.data.userId, serverId)
      if (!roleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }

      if (roleInfo.priority < 100) {
        const permission = await getChannelPermission(channelRow.id, roleInfo.roleName)
        if (permission && Number(permission.can_view) !== 1) {
          reply({ ok: false, error: "Kamu tidak punya akses melihat channel ini" })
          return
        }
      }

      const nextRoomKey = buildRoomKey(serverId, channelName)
      const previousRoom = socket.data.roomKey
      const previousServerId = Number(socket.data.activeServerId)
      if (previousRoom) {
        clearTypingIndicator()
        socket.leave(previousRoom)
        handleGameUserLeave(previousRoom, socket.data.username).catch(() => {})
      }
      if (Number.isInteger(previousServerId) && previousServerId > 0 && previousServerId !== serverId) {
        socket.leave(buildServerPresenceRoomKey(previousServerId))
      }

      socket.join(nextRoomKey)
      socket.join(buildServerPresenceRoomKey(serverId))
      socket.data.roomKey = nextRoomKey
      socket.data.activeServerId = serverId
      socket.data.activeChannel = channelName
      socket.data.joinVersion += 1
      const joinVersion = socket.data.joinVersion

      const rows = await dbAll(
        "SELECT id, username, message, created_at, reply_to_message_id FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 20",
        [nextRoomKey]
      )
      const historyRows = await enrichMessages(rows.reverse())

      if (socket.data.joinVersion !== joinVersion || socket.data.roomKey !== nextRoomKey) {
        reply({ ok: false, error: "Join channel dibatalkan" })
        return
      }

      reply({
        ok: true,
        server_id: serverId,
        channel: channelName,
        history: historyRows
      })
      emitGameLobbyStateToSocket(socket, nextRoomKey).catch(() => {})
      emitDrawGuessStateToSocket(socket, nextRoomKey).catch(() => {})
      emitWordRushStateToSocket(socket, nextRoomKey).catch(() => {})
      emitGameLobbyStateToRoom(nextRoomKey).catch(() => {})
      emitDrawGuessStateToRoom(nextRoomKey).catch(() => {})
      emitWordRushStateToRoom(nextRoomKey).catch(() => {})
      if (Number.isInteger(previousServerId) && previousServerId > 0 && previousServerId !== serverId) {
        emitServerOnlineUsers(previousServerId).catch(() => {})
      }
      emitServerOnlineUsers(serverId).catch(() => {})
      emitAllVoicePresenceForServer(serverId).catch(() => {})
    } catch (error) {
      console.error("join server channel error:", error)
      reply({ ok: false, error: "Gagal masuk channel" })
    }
  })

  // Backward compatibility: legacy global channel flow
  socket.on("join channel", async (channel, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!LEGACY_CHANNELS_ENABLED) {
        reply({ ok: false, error: "Legacy channel sudah dinonaktifkan. Gunakan server channel." })
        return
      }
      const channelName = normalizeText(channel)
      if (!socket.data.username) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }
      const roomKey = `legacy:${channelName}`
      const previousServerId = Number(socket.data.activeServerId)
      if (socket.data.roomKey) {
        clearTypingIndicator()
        socket.leave(socket.data.roomKey)
        handleGameUserLeave(socket.data.roomKey, socket.data.username).catch(() => {})
      }
      if (Number.isInteger(previousServerId) && previousServerId > 0) {
        socket.leave(buildServerPresenceRoomKey(previousServerId))
      }
      socket.join(roomKey)
      socket.data.roomKey = roomKey
      socket.data.activeServerId = 0
      socket.data.activeChannel = channelName
      socket.data.joinVersion += 1
      const rows = await dbAll(
        "SELECT id, username, message, created_at, reply_to_message_id FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 20",
        [roomKey]
      )
      const historyRows = await enrichMessages(rows.reverse())
      reply({ ok: true, channel: channelName, history: historyRows })
      emitGameLobbyStateToSocket(socket, roomKey).catch(() => {})
      emitDrawGuessStateToSocket(socket, roomKey).catch(() => {})
      emitWordRushStateToSocket(socket, roomKey).catch(() => {})
      emitGameLobbyStateToRoom(roomKey).catch(() => {})
      emitDrawGuessStateToRoom(roomKey).catch(() => {})
      emitWordRushStateToRoom(roomKey).catch(() => {})
      if (Number.isInteger(previousServerId) && previousServerId > 0) {
        emitServerOnlineUsers(previousServerId).catch(() => {})
      }
    } catch (error) {
      reply({ ok: false, error: "Gagal join channel" })
    }
  })

  socket.on("chat message", async (data) => {
    try {
      if (!data || typeof data.message !== "string") return
      const message = normalizeText(data.message)
      const requestedReplyMessageId = Number(data.reply_to_message_id)
      const username = socket.data.username
      const roomKey = socket.data.roomKey
      const serverId = Number(socket.data.activeServerId)
      const activeChannel = normalizeText(socket.data.activeChannel).toLowerCase()

      if (!username || !roomKey) return
      if (!isValidLength(message, MAX_MESSAGE_LENGTH)) {
        socket.emit("system error", { message: `Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter` })
        return
      }

      if (socket.data.isTyping) {
        clearTypingIndicator()
      }

      if (Number.isInteger(serverId) && serverId > 0 && activeChannel) {
        const roleInfo = await getMemberRoleInfo(socket.data.userId, serverId)
        if (!roleInfo) {
          socket.emit("system error", { message: "Role member tidak ditemukan" })
          return
        }

        const muteState = await getMemberMuteState(socket.data.userId, serverId)
        if (!muteState.isMember) {
          socket.emit("system error", { message: "Kamu bukan member server ini" })
          return
        }
        if (muteState.isMuted) {
          const remainingMs = Math.max(0, Number(muteState.mutedUntilTs || 0) - Date.now())
          const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000))
          const reasonText = muteState.muteReason ? ` Alasan: ${muteState.muteReason}` : ""
          socket.emit("system error", {
            message: `Kamu sedang di-mute (${remainingMinutes} menit lagi).${reasonText}`
          })
          return
        }

        if (roleInfo.priority < 100) {
          const channelRow = await dbGet(
            "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
            [serverId, activeChannel]
          )
          if (!channelRow) {
            socket.emit("system error", { message: "Channel tidak ditemukan" })
            return
          }

          const permission = await getChannelPermission(channelRow.id, roleInfo.roleName)
          if (permission && Number(permission.can_send) !== 1) {
            socket.emit("system error", { message: "Kamu tidak punya izin mengirim pesan di channel ini" })
            return
          }
        }
      }

      let replyToMessageId = null
      let replyToPayload = null
      if (Number.isInteger(requestedReplyMessageId) && requestedReplyMessageId > 0) {
        const replyRow = await dbGet(
          "SELECT id, username, message FROM messages WHERE id = ? AND channel = ? LIMIT 1",
          [requestedReplyMessageId, roomKey]
        )
        if (!replyRow) {
          socket.emit("system error", { message: "Pesan reply tidak ditemukan" })
          return
        }
        replyToMessageId = Number(replyRow.id)
        replyToPayload = {
          id: replyToMessageId,
          username: String(replyRow.username || ""),
          message: String(replyRow.message || "")
        }
      }

      const createdAt = new Date().toISOString()
      const created = await dbRun(
        "INSERT INTO messages (username, channel, message, created_at, reply_to_message_id) VALUES (?, ?, ?, ?, ?)",
        [username, roomKey, message, createdAt, replyToMessageId]
      )
      const messageId = Number(created && created.lastID)

      io.to(roomKey).emit("chat message", {
        id: messageId,
        username,
        message,
        created_at: createdAt,
        reply_to_message_id: replyToMessageId,
        reply_to: replyToPayload,
        reactions: [],
        channel: socket.data.activeChannel,
        server_id: socket.data.activeServerId
      })
    } catch (error) {
      console.error("chat message error:", error)
      socket.emit("system error", { message: "Gagal menyimpan pesan" })
    }
  })

  socket.on("message reaction", async (payload) => {
    try {
      const username = socket.data.username
      const roomKey = socket.data.roomKey
      const messageId = Number(payload && payload.message_id)
      const emoji = String((payload && payload.emoji) || "").trim()

      if (!username || !roomKey) return
      if (!Number.isInteger(messageId) || messageId <= 0) return
      if (!MESSAGE_REACTION_EMOJI_SET.has(emoji)) {
        socket.emit("system error", { message: "Reaction tidak valid" })
        return
      }

      const messageRow = await dbGet("SELECT id FROM messages WHERE id = ? AND channel = ? LIMIT 1", [
        messageId,
        roomKey
      ])
      if (!messageRow) {
        socket.emit("system error", { message: "Pesan tidak ditemukan" })
        return
      }

      const existingReaction = await dbGet(
        "SELECT id, emoji FROM message_reactions WHERE message_id = ? AND username = ? ORDER BY id ASC LIMIT 1",
        [messageId, username]
      )
      const currentEmoji = String(existingReaction && existingReaction.emoji || "")
      const isSameEmoji = currentEmoji === emoji

      await dbRun(
        "DELETE FROM message_reactions WHERE message_id = ? AND username = ?",
        [messageId, username]
      )

      if (!isSameEmoji) {
        await dbRun(
          "INSERT INTO message_reactions (message_id, username, emoji) VALUES (?, ?, ?)",
          [messageId, username, emoji]
        )
      }

      io.to(roomKey).emit("message reaction update", {
        message_id: messageId,
        reactions: await getMessageReactions(messageId)
      })
    } catch (error) {
      console.error("message reaction error:", error)
      socket.emit("system error", { message: "Gagal update reaction" })
    }
  })

  socket.on("delete message", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const username = socket.data.username
      const roomKey = socket.data.roomKey
      const messageId = Number(payload && payload.message_id)

      if (!username || !roomKey) {
        reply({ ok: false, error: "Belum join channel" })
        return
      }
      if (!Number.isInteger(messageId) || messageId <= 0) {
        reply({ ok: false, error: "Pesan tidak valid" })
        return
      }

      const messageRow = await dbGet(
        "SELECT id, username FROM messages WHERE id = ? AND channel = ? LIMIT 1",
        [messageId, roomKey]
      )
      if (!messageRow) {
        reply({ ok: false, error: "Pesan tidak ditemukan" })
        return
      }
      if (String(messageRow.username || "") !== String(username)) {
        reply({ ok: false, error: "Kamu hanya bisa menghapus pesanmu sendiri" })
        return
      }

      await dbRun("DELETE FROM messages WHERE id = ? AND channel = ?", [messageId, roomKey])
      io.to(roomKey).emit("message deleted", {
        message_id: messageId,
        deleted_by: username
      })
      reply({ ok: true, message_id: messageId })
    } catch (error) {
      console.error("delete message error:", error)
      reply({ ok: false, error: "Gagal menghapus pesan" })
      socket.emit("system error", { message: "Gagal menghapus pesan" })
    }
  })

  socket.on("game join", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const roomKey = String(socket.data.roomKey || "")
      const username = normalizeText(socket.data.username)
      const channelName = normalizeText(socket.data.activeChannel)
      const gameId = normalizeGameId(payload && payload.game_id)
      if (!roomKey || !username || !channelName) {
        reply({ ok: false, error: "Join channel dulu" })
        return
      }
      if (!gameId) {
        reply({ ok: false, error: "Game tidak valid" })
        return
      }
      if (!isGameRoomChannelName(channelName)) {
        reply({
          ok: false,
          error: "Masuk room game dulu (#game / #game-*) untuk main."
        })
        return
      }

      const previousJoinedGameId = buildGameLobbyState(roomKey, username).joined_game_id
      const joined = joinGameLobby(roomKey, username, gameId)
      if (!joined.ok) {
        reply({ ok: false, error: "Gagal masuk game" })
        return
      }

      if (previousJoinedGameId && previousJoinedGameId !== joined.gameId) {
        if (previousJoinedGameId === "drawguess") {
          await handleDrawGuessUserLeave(roomKey, username)
        } else if (previousJoinedGameId === "wordrush") {
          await handleWordRushUserLeave(roomKey, username)
        }
      }

      await Promise.all([
        emitGameLobbyStateToRoom(roomKey),
        emitDrawGuessStateToRoom(roomKey),
        emitWordRushStateToRoom(roomKey)
      ])

      reply({
        ok: true,
        game_id: joined.gameId,
        players: joined.players,
        username
      })
    } catch (error) {
      console.error("game join error:", error)
      reply({ ok: false, error: "Gagal masuk game" })
    }
  })

  socket.on("game leave", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const roomKey = String(socket.data.roomKey || "")
      const username = normalizeText(socket.data.username)
      const gameId = normalizeGameId(payload && payload.game_id)
      if (!roomKey || !username) {
        reply({ ok: false, error: "Join channel dulu" })
        return
      }
      if (!gameId) {
        reply({ ok: false, error: "Game tidak valid" })
        return
      }
      const lobby = getOrCreateGameLobby(roomKey)
      const bucket = lobby[gameId]
      const removed = bucket instanceof Set ? bucket.delete(username) : false

      if (gameId === "drawguess") {
        await handleDrawGuessUserLeave(roomKey, username)
      } else if (gameId === "wordrush") {
        await handleWordRushUserLeave(roomKey, username)
      }

      await Promise.all([
        emitGameLobbyStateToRoom(roomKey),
        emitDrawGuessStateToRoom(roomKey),
        emitWordRushStateToRoom(roomKey)
      ])
      reply({
        ok: true,
        game_id: gameId,
        removed: Boolean(removed)
      })
    } catch (error) {
      console.error("game leave error:", error)
      reply({ ok: false, error: "Gagal keluar game" })
    }
  })

  socket.on("drawguess start", async (ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const roomKey = String(socket.data.roomKey || "")
      const username = normalizeText(socket.data.username)
      const serverId = Number(socket.data.activeServerId) || 0
      const channelName = normalizeText(socket.data.activeChannel)
      if (!roomKey || !username || !channelName) {
        reply({ ok: false, error: "Join channel dulu" })
        return
      }
      if (!isGameRoomChannelName(channelName)) {
        reply({
          ok: false,
          code: "DRAWGUESS_REQUIRE_GAME_ROOM",
          error: "Masuk room game dulu (#game / #game-*) untuk main."
        })
        return
      }
      if (drawGuessSessionsByRoom.has(roomKey)) {
        reply({ ok: false, code: "DRAWGUESS_ACTIVE_ROUND", error: "Ronde game masih berjalan" })
        return
      }

      if (serverId > 0) {
        const channelRow = await dbGet(
          "SELECT type FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
          [serverId, channelName]
        )
        if (!channelRow || String(channelRow.type || "text") !== "text") {
          reply({ ok: false, error: "Draw & Guess hanya untuk text channel" })
          return
        }
      }

      const participants = getGamePlayersFromLobby(roomKey, "drawguess")
      if (!participants.includes(username)) {
        reply({
          ok: false,
          code: "DRAWGUESS_JOIN_REQUIRED",
          error: "Kamu belum masuk ke game Draw & Guess"
        })
        return
      }
      if (participants.length < 2) {
        reply({
          ok: false,
          code: "DRAWGUESS_NEED_PLAYERS",
          error: "Butuh minimal 2 pemain di room game",
          players: participants,
          min_players: 2
        })
        return
      }

      const scoreMap = getDrawGuessScoreMap(roomKey)
      if (!scoreMap.has(username)) {
        scoreMap.set(username, 0)
      }

      const word = randomDrawGuessWord()
      const startedAtTs = Date.now()
      const session = {
        roomKey,
        serverId,
        channelName,
        drawerUsername: username,
        word,
        startedAtTs,
        endsAtTs: startedAtTs + DRAW_GUESS_ROUND_MS,
        strokes: []
      }
      drawGuessSessionsByRoom.set(roomKey, session)
      scheduleDrawGuessTimeout(roomKey)

      io.to(roomKey).emit("drawguess round started", {
        drawer_username: username,
        round_ends_at_ts: session.endsAtTs
      })
      await emitDrawGuessStateToRoom(roomKey)
      reply({ ok: true })
    } catch (error) {
      console.error("drawguess start error:", error)
      reply({ ok: false, error: "Gagal memulai Draw & Guess" })
    }
  })

  socket.on("drawguess stroke", (payload) => {
    try {
      const roomKey = String(socket.data.roomKey || "")
      const username = normalizeText(socket.data.username)
      if (!roomKey || !username) return
      const session = drawGuessSessionsByRoom.get(roomKey)
      if (!session) return
      if (session.drawerUsername !== username) return

      const stroke = normalizeDrawGuessStroke(payload)
      if (!stroke) return
      session.strokes.push(stroke)
      if (session.strokes.length > DRAW_GUESS_MAX_STROKES) {
        session.strokes = session.strokes.slice(session.strokes.length - DRAW_GUESS_MAX_STROKES)
      }
      socket.to(roomKey).emit("drawguess stroke", stroke)
    } catch (error) {
      console.error("drawguess stroke error:", error)
    }
  })

  socket.on("drawguess clear", async () => {
    try {
      const roomKey = String(socket.data.roomKey || "")
      const username = normalizeText(socket.data.username)
      if (!roomKey || !username) return
      const session = drawGuessSessionsByRoom.get(roomKey)
      if (!session) return
      if (session.drawerUsername !== username) return
      session.strokes = []
      io.to(roomKey).emit("drawguess clear")
      await emitDrawGuessStateToRoom(roomKey)
    } catch (error) {
      console.error("drawguess clear error:", error)
    }
  })

  socket.on("drawguess guess", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const roomKey = String(socket.data.roomKey || "")
      const username = normalizeText(socket.data.username)
      const guessText = normalizeText(payload && payload.guess).slice(0, DRAW_GUESS_MAX_GUESS_LENGTH)
      if (!roomKey || !username) {
        reply({ ok: false, error: "Join channel dulu" })
        return
      }
      const session = drawGuessSessionsByRoom.get(roomKey)
      if (!session) {
        reply({ ok: false, error: "Belum ada ronde aktif" })
        return
      }
      const participants = getGamePlayersFromLobby(roomKey, "drawguess")
      if (!participants.includes(username)) {
        reply({ ok: false, error: "Kamu belum masuk game Draw & Guess" })
        return
      }
      if (session.drawerUsername === username) {
        reply({ ok: false, error: "Drawer tidak bisa menebak" })
        return
      }
      if (!guessText) {
        reply({ ok: false, error: "Tebakan kosong" })
        return
      }

      const isCorrect =
        normalizeDrawGuessCompareText(guessText) === normalizeDrawGuessCompareText(session.word)
      if (!isCorrect) {
        reply({ ok: true, correct: false })
        return
      }

      const scoreMap = getDrawGuessScoreMap(roomKey)
      const previous = Number(scoreMap.get(username) || 0)
      scoreMap.set(username, previous + 10)

      if (session.drawerUsername) {
        const previousDrawer = Number(scoreMap.get(session.drawerUsername) || 0)
        scoreMap.set(session.drawerUsername, previousDrawer + 5)
      }

      await endDrawGuessRound(roomKey, "solved", username)
      reply({ ok: true, correct: true, points: 10 })
    } catch (error) {
      console.error("drawguess guess error:", error)
      reply({ ok: false, error: "Gagal memproses tebakan" })
    }
  })

  socket.on("wordrush start", async (payload, ack) => {
    let startPayload = payload
    let reply = typeof ack === "function" ? ack : () => {}
    if (typeof payload === "function") {
      reply = payload
      startPayload = {}
    }
    try {
      const roomKey = String(socket.data.roomKey || "")
      const username = normalizeText(socket.data.username)
      const serverId = Number(socket.data.activeServerId) || 0
      const channelName = normalizeText(socket.data.activeChannel)
      const difficulty = normalizeWordRushDifficulty(startPayload && startPayload.difficulty)
      if (!roomKey || !username || !channelName) {
        reply({ ok: false, error: "Join channel dulu" })
        return
      }
      if (!isGameRoomChannelName(channelName)) {
        reply({
          ok: false,
          code: "WORDRUSH_REQUIRE_GAME_ROOM",
          error: "Masuk room game dulu (#game / #game-*) untuk main."
        })
        return
      }
      if (wordRushSessionsByRoom.has(roomKey)) {
        reply({ ok: false, code: "WORDRUSH_ACTIVE_ROUND", error: "Ronde Word Rush masih berjalan" })
        return
      }
      if (serverId > 0) {
        const channelRow = await dbGet(
          "SELECT type FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
          [serverId, channelName]
        )
        if (!channelRow || String(channelRow.type || "text") !== "text") {
          reply({ ok: false, error: "Word Rush hanya untuk text channel" })
          return
        }
      }

      const players = getGamePlayersFromLobby(roomKey, "wordrush")
      if (!players.includes(username)) {
        reply({
          ok: false,
          code: "WORDRUSH_JOIN_REQUIRED",
          error: "Kamu belum masuk ke game Word Rush"
        })
        return
      }
      if (players.length < 2) {
        reply({
          ok: false,
          code: "WORDRUSH_NEED_PLAYERS",
          error: "Butuh minimal 2 pemain di Word Rush",
          players,
          min_players: 2
        })
        return
      }

      const scoreMap = getWordRushScoreMap(roomKey)
      players.forEach((playerName) => {
        if (!scoreMap.has(playerName)) {
          scoreMap.set(playerName, 0)
        }
      })

      const word = randomWordRushWord(difficulty)
      const roundMs = getWordRushRoundMs(difficulty)
      const startedAtTs = Date.now()
      const session = {
        roomKey,
        serverId,
        channelName,
        difficulty,
        word,
        wordPrompt: buildWordRushPrompt(word, difficulty),
        startedAtTs,
        endsAtTs: startedAtTs + roundMs
      }
      wordRushSessionsByRoom.set(roomKey, session)
      scheduleWordRushTimeout(roomKey)

      io.to(roomKey).emit("wordrush round started", {
        difficulty: session.difficulty,
        round_ends_at_ts: session.endsAtTs,
        word_hint: session.wordPrompt
      })
      await emitWordRushStateToRoom(roomKey)
      reply({ ok: true, difficulty: session.difficulty })
    } catch (error) {
      console.error("wordrush start error:", error)
      reply({ ok: false, error: "Gagal memulai Word Rush" })
    }
  })

  socket.on("wordrush guess", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const roomKey = String(socket.data.roomKey || "")
      const username = normalizeText(socket.data.username)
      const guessText = normalizeText(payload && payload.guess).slice(0, WORD_RUSH_MAX_GUESS_LENGTH)
      if (!roomKey || !username) {
        reply({ ok: false, error: "Join channel dulu" })
        return
      }
      const session = wordRushSessionsByRoom.get(roomKey)
      if (!session) {
        reply({ ok: false, error: "Belum ada ronde Word Rush aktif" })
        return
      }
      const players = getGamePlayersFromLobby(roomKey, "wordrush")
      if (!players.includes(username)) {
        reply({ ok: false, error: "Kamu belum masuk game Word Rush" })
        return
      }
      if (!guessText) {
        reply({ ok: false, error: "Tebakan kosong" })
        return
      }

      const isCorrect =
        normalizeWordRushCompareText(guessText) === normalizeWordRushCompareText(session.word)
      if (!isCorrect) {
        reply({ ok: true, correct: false })
        return
      }

      const scoreMap = getWordRushScoreMap(roomKey)
      const previous = Number(scoreMap.get(username) || 0)
      scoreMap.set(username, previous + 10)
      await endWordRushRound(roomKey, "solved", username)
      reply({ ok: true, correct: true, points: 10 })
    } catch (error) {
      console.error("wordrush guess error:", error)
      reply({ ok: false, error: "Gagal memproses tebakan Word Rush" })
    }
  })

  socket.on("typing state", (payload) => {
    try {
      if (!socket.data.username || !socket.data.roomKey) return
      const nextIsTyping = Boolean(payload && payload.is_typing)
      if (nextIsTyping === socket.data.isTyping) return

      socket.data.isTyping = nextIsTyping
      emitTypingIndicator(nextIsTyping)
    } catch (error) {
      console.error("typing state error:", error)
    }
  })

  socket.on("disconnect", () => {
    const previousRoomKey = String(socket.data.roomKey || "")
    const previousUsername = normalizeText(socket.data.username)
    const activeServerId = Number(socket.data.activeServerId)
    const disconnectedUserId = Number(socket.data.userId) || 0
    const disconnectedUsername = normalizeText(socket.data.username)
    clearTypingIndicator()
    leaveVoiceRoom({ notifyPeers: true }).catch(() => {})
    if (previousRoomKey && previousUsername) {
      handleGameUserLeave(previousRoomKey, previousUsername).catch(() => {})
    }
    if (disconnectedUserId > 0 || disconnectedUsername) {
      setTimeout(async () => {
        try {
          const peers = await io.fetchSockets()
          const stillConnected = peers.some((peer) => {
            const peerUserId = Number(peer.data.userId) || 0
            if (disconnectedUserId > 0 && peerUserId > 0) {
              return peerUserId === disconnectedUserId
            }
            const peerUsername = normalizeText(peer.data.username).toLowerCase()
            return Boolean(peerUsername && peerUsername === disconnectedUsername.toLowerCase())
          })
          if (!stillConnected) {
            clearPresenceStatusForUser(disconnectedUserId, disconnectedUsername)
          }
        } catch {}
      }, 0)
    }
    if (Number.isInteger(activeServerId) && activeServerId > 0) {
      setTimeout(() => {
        emitServerOnlineUsers(activeServerId).catch(() => {})
      }, 0)
    }
    console.log("user disconnected")
  })
})

const PORT = Number(process.env.PORT) || 3000

async function startServer() {
  try {
    await initDatabase()
    server.listen(PORT, () => {
      console.log(`Privix server running on port ${PORT} (${isPostgres ? "postgres" : "sqlite"})`)
      logVoiceRuntimeReadiness()
    })
  } catch (error) {
    console.error("Database init failed:", error)
    process.exitCode = 1
  }
}

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} sedang dipakai. Jalankan dengan port lain.`)
    return
  }
  console.error("Server error:", err)
})

startServer()
