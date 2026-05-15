const { AccessToken } = require("livekit-server-sdk")

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
  const clientSdkPath = String(process.env.PRIVIX_LIVEKIT_CLIENT_SDK_PATH || process.env.LIVEKIT_CLIENT_SDK_PATH || "").trim()

  const enabled = Boolean(useSfu && provider === "livekit" && wsUrl && apiKey && apiSecret)

  return {
    useSfu: Boolean(useSfu),
    enabled,
    provider: provider || "livekit",
    wsUrl,
    apiKey,
    apiSecret,
    clientSdkUrl,
    clientSdkPath
  }
}

function buildSfuRoomName(serverId, channelName) {
  return `s:${Number(serverId)}:v:${String(channelName || "").toLowerCase()}`
}

async function issueLivekitToken(config, { identity, displayName, roomName, metadata = null, ttlSec = 3600 }) {
  if (!config || config.provider !== "livekit" || !config.apiKey || !config.apiSecret) {
    throw new Error("SFU LiveKit belum dikonfigurasi")
  }
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: String(identity || ""),
    name: String(displayName || identity || "Privix User"),
    metadata: metadata && typeof metadata === "object" ? JSON.stringify(metadata) : undefined,
    ttl: Math.max(60, Number(ttlSec) || 3600)
  })
  token.addGrant({
    roomJoin: true,
    room: String(roomName || ""),
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  })
  return token.toJwt()
}

module.exports = {
  resolveSfuConfig,
  buildSfuRoomName,
  issueLivekitToken
}
