function isVoiceDebugEnabled() {
  try {
    if (typeof window !== "undefined" && window.PRIVIX_VOICE_DEBUG === true) return true
    if (typeof localStorage !== "undefined" && localStorage.getItem("voice:debug") === "1") return true
  } catch {}
  return false
}

function voiceDebug(event, details = null) {
  if (!isVoiceDebugEnabled()) return
  const timestamp = new Date().toISOString()
  if (details === null || typeof details === "undefined") {
    console.log(`[voice-debug][client][${timestamp}] ${event}`)
    return
  }
  console.log(`[voice-debug][client][${timestamp}] ${event}`, details)
}

function describeTrack(track) {
  if (!track) return null
  let settings = {}
  try {
    if (typeof track.getSettings === "function") {
      settings = track.getSettings() || {}
    }
  } catch {}
  return {
    id: track.id || "",
    kind: track.kind || "",
    enabled: track.enabled !== false,
    readyState: track.readyState || "",
    muted: Boolean(track.muted),
    settings
  }
}

function describeStream(stream) {
  if (!stream || typeof stream.getTracks !== "function") {
    return { available: false, tracks: [] }
  }
  return {
    available: true,
    id: stream.id || "",
    tracks: stream.getTracks().map((track) => describeTrack(track))
  }
}

try {
  if (typeof window !== "undefined") {
    const api = {
      enable() {
        try {
          localStorage.setItem("voice:debug", "1")
        } catch {}
        window.PRIVIX_VOICE_DEBUG = true
      },
      disable() {
        try {
          localStorage.removeItem("voice:debug")
        } catch {}
        window.PRIVIX_VOICE_DEBUG = false
      },
      status() {
        return isVoiceDebugEnabled()
      }
    }
    if (!window.privixVoiceDebug) {
      window.privixVoiceDebug = api
    }
  }
} catch {}

export { isVoiceDebugEnabled, voiceDebug, describeTrack, describeStream }
