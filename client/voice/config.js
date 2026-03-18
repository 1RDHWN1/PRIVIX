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

export { DEFAULT_ICE_SERVERS, ICE_CONFIG }
