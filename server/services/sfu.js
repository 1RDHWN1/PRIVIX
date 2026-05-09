const crypto = require("crypto")

function readEnvFlag(...keys) {
  for (const key of keys) {
    const raw = String(process.env[key] || "").trim().toLowerCase()
    if (!raw) continue
    if (["1", "true", "yes", "on"].includes(raw)) return true
    if (["0", "false", "no", "off"].includes(raw)) return false
  }
  return false
}

function normalizeProvider(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase()
  if (value === "livekit") return "livekit"
  return ""
}

function resolveSfuConfig() {
  const useSfu = readEnvFlag("PRIVIX_VOICE_USE_SFU", "VOICE_USE_SFU")
  const provider = normalizeProvider(process.env.PRIVIX_SFU_PROVIDER || process.env.VOICE_SFU_PROVIDER || "livekit")
  const wsUrl = String(process.env.PRIVIX_LIVEKIT_URL || process.env.LIVEKIT_URL || "").trim()
  const apiKey = String(process.env.PRIVIX_LIVEKIT_API_KEY || process.env.LIVEKIT_API_KEY || "").trim()
  const apiSecret = String(process.env.PRIVIX_LIVEKIT_API_SECRET || process.env.LIVEKIT_API_SECRET || "").trim()
  const clientSdkUrl = String(process.env.PRIVIX_LIVEKIT_CLIENT_SDK_URL || process.env.LIVEKIT_CLIENT_SDK_URL || "").trim()

  const enabled = Boolean(useSfu && provider === "livekit" && wsUrl && apiKey && apiSecret)

  return {
    useSfu: Boolean(useSfu),
    enabled,
    provider: provider || "livekit",
    wsUrl,
    apiKey,
    apiSecret,
    clientSdkUrl
  }
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

function signJwtHS256(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const content = `${encodedHeader}.${encodedPayload}`
  const signature = crypto
    .createHmac("sha256", secret)
    .update(content)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
  return `${content}.${signature}`
}

function buildSfuRoomName(serverId, channelName) {
  return `s:${Number(serverId)}:v:${String(channelName || "").toLowerCase()}`
}

function issueLivekitToken(config, { identity, displayName, roomName, metadata = null, ttlSec = 3600 }) {
  if (!config || config.provider !== "livekit" || !config.apiKey || !config.apiSecret) {
    throw new Error("SFU LiveKit belum dikonfigurasi")
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const payload = {
    iss: config.apiKey,
    sub: String(identity || ""),
    nbf: Math.max(0, nowSec - 10),
    exp: nowSec + Math.max(60, Number(ttlSec) || 3600),
    iat: nowSec,
    jti: crypto.randomBytes(10).toString("hex"),
    name: String(displayName || identity || "Privix User"),
    video: {
      roomJoin: true,
      room: String(roomName || ""),
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  }

  if (metadata && typeof metadata === "object") {
    payload.metadata = JSON.stringify(metadata)
  }

  return signJwtHS256(payload, config.apiSecret)
}

module.exports = {
  resolveSfuConfig,
  buildSfuRoomName,
  issueLivekitToken
}
