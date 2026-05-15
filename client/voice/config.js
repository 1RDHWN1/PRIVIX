const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
]

function resolveIceConfig() {
  const raw =
    (typeof window !== "undefined" && (window.PRIVIX_ICE || window.PRIVIX_TURN)) || null
  if (!raw) {
    return { iceServers: DEFAULT_ICE_SERVERS }
  }

  if (Array.isArray(raw)) {
    return { iceServers: raw.length > 0 ? raw : DEFAULT_ICE_SERVERS }
  }

  if (typeof raw === "string") {
    return { iceServers: [{ urls: raw }, ...DEFAULT_ICE_SERVERS] }
  }

  if (typeof raw === "object") {
    if (Array.isArray(raw.iceServers)) {
      return {
        ...raw,
        iceServers: raw.iceServers.length > 0 ? raw.iceServers : DEFAULT_ICE_SERVERS
      }
    }
    if (raw.urls) {
      return { iceServers: [raw, ...DEFAULT_ICE_SERVERS] }
    }
  }

  return { iceServers: DEFAULT_ICE_SERVERS }
}

const ICE_CONFIG = resolveIceConfig()

function resolveVoiceRuntimeConfig() {
  const fromWindow =
    (typeof window !== "undefined" && window.PRIVIX_VOICE_CONFIG && typeof window.PRIVIX_VOICE_CONFIG === "object")
      ? window.PRIVIX_VOICE_CONFIG
      : {}

  const useSfu = Boolean(fromWindow.use_sfu)
  const provider = String(fromWindow.sfu_provider || "mesh").trim().toLowerCase()
  const wsUrl = String(fromWindow.sfu_ws_url || "").trim()
  const clientSdkUrl = String(fromWindow.sfu_client_sdk_url || "").trim()
  const hasTurn = Boolean(fromWindow.has_turn)
  const meshPeerSoftLimit = Number(fromWindow.mesh_peer_soft_limit || 4)

  return {
    useSfu,
    provider: useSfu ? (provider || "livekit") : "mesh",
    wsUrl,
    clientSdkUrl,
    hasTurn,
    meshPeerSoftLimit: Number.isFinite(meshPeerSoftLimit) && meshPeerSoftLimit > 0 ? meshPeerSoftLimit : 4
  }
}

const VOICE_RUNTIME_CONFIG = resolveVoiceRuntimeConfig()
const VOICE_USE_SFU = Boolean(VOICE_RUNTIME_CONFIG.useSfu)

function isVoiceSfuEnabled() {
  return VOICE_USE_SFU
}

export {
  DEFAULT_ICE_SERVERS,
  ICE_CONFIG,
  VOICE_RUNTIME_CONFIG,
  VOICE_USE_SFU,
  isVoiceSfuEnabled
}
