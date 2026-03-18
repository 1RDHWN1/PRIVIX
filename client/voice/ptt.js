import { socket } from "../socket.js"
import { notify } from "../notice.js"
import { voicePttToggle, voicePttKeyLabel, voicePttSetKeyBtn } from "../dom.js"
import { voiceState } from "./state.js"
import { updateSelfTileState } from "./participants.js"
import { updateVoiceUi } from "./ui.js"

const PTT_ENABLED_KEY = "voice:ptt_enabled"
const PTT_KEY_CODE = "voice:ptt_key"
const DEFAULT_PTT_CODE = "KeyV"

function formatKeyLabel(code) {
  if (!code) return "V"
  if (code.startsWith("Key")) return code.slice(3).toUpperCase()
  if (code.startsWith("Digit")) return code.slice(5)
  if (code === "Space") return "Space"
  if (code.startsWith("Arrow")) return code.replace("Arrow", "")
  return code
}

function isEditableTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return target.isContentEditable
}

function emitMuteState() {
  if (!socket.connected || !voiceState.isJoined) return
  const isMuted = !voiceState.canSpeak || voiceState.isMuted
  socket.emit("voice mute state", { is_muted: isMuted })
}

function syncPttUi() {
  if (voicePttToggle) {
    voicePttToggle.checked = Boolean(voiceState.pushToTalkEnabled)
    voicePttToggle.disabled = !voiceState.isJoined || !voiceState.canSpeak
  }
  if (voicePttKeyLabel) {
    voicePttKeyLabel.textContent = formatKeyLabel(voiceState.pushToTalkKey)
  }
}

function applyPushToTalkState() {
  const track =
    voiceState.localStream && voiceState.localStream.getAudioTracks().length > 0
      ? voiceState.localStream.getAudioTracks()[0]
      : null
  if (!track) {
    syncPttUi()
    return
  }

  if (voiceState.pushToTalkEnabled) {
    const shouldEnable = Boolean(voiceState.pushToTalkActive)
    track.enabled = voiceState.canSpeak && shouldEnable
    voiceState.isMuted = !shouldEnable
  } else {
    track.enabled = voiceState.canSpeak && !voiceState.isMuted
  }

  updateSelfTileState()
  emitMuteState()
  updateVoiceUi()
  syncPttUi()
}

function setPushToTalkEnabled(enabled, { persist = true } = {}) {
  const next = Boolean(enabled)
  if (next === voiceState.pushToTalkEnabled) return
  if (next && (!voiceState.isJoined || !voiceState.canSpeak)) {
    notify("Push-to-talk hanya aktif saat kamu sudah join voice.")
    return
  }

  if (next) {
    voiceState.wasMutedBeforePtt = voiceState.isMuted
    voiceState.pushToTalkActive = false
    voiceState.isMuted = true
  } else {
    voiceState.pushToTalkActive = false
    if (typeof voiceState.wasMutedBeforePtt === "boolean") {
      voiceState.isMuted = voiceState.wasMutedBeforePtt
    }
  }

  voiceState.pushToTalkEnabled = next
  if (persist) {
    try {
      localStorage.setItem(PTT_ENABLED_KEY, next ? "1" : "0")
    } catch {}
  }
  applyPushToTalkState()
}

function setPushToTalkKey(code, { persist = true } = {}) {
  if (!code) return
  voiceState.pushToTalkKey = code
  if (persist) {
    try {
      localStorage.setItem(PTT_KEY_CODE, code)
    } catch {}
  }
  syncPttUi()
}

function handleKeyDown(event) {
  if (!voiceState.pushToTalkEnabled) return
  if (voiceState.isCapturingPttKey) return
  if (!voiceState.isJoined || !voiceState.canSpeak) return
  if (isEditableTarget(event.target)) return
  if (event.repeat) return
  if (event.code !== voiceState.pushToTalkKey) return
  voiceState.pushToTalkActive = true
  applyPushToTalkState()
}

function handleKeyUp(event) {
  if (!voiceState.pushToTalkEnabled) return
  if (voiceState.isCapturingPttKey) return
  if (event.code !== voiceState.pushToTalkKey) return
  voiceState.pushToTalkActive = false
  applyPushToTalkState()
}

function startKeyCapture() {
  if (voiceState.isCapturingPttKey) return
  voiceState.isCapturingPttKey = true
  if (voicePttKeyLabel) {
    voicePttKeyLabel.textContent = "Press key"
  }

  const onKey = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.code === "Escape") {
      voiceState.isCapturingPttKey = false
      syncPttUi()
      window.removeEventListener("keydown", onKey, true)
      return
    }
    setPushToTalkKey(event.code)
    voiceState.isCapturingPttKey = false
    window.removeEventListener("keydown", onKey, true)
  }

  window.addEventListener("keydown", onKey, true)
}

function loadPttSettings() {
  let enabled = false
  let keyCode = DEFAULT_PTT_CODE
  try {
    const storedEnabled = localStorage.getItem(PTT_ENABLED_KEY)
    enabled = storedEnabled === "1" || storedEnabled === "true"
    keyCode = String(localStorage.getItem(PTT_KEY_CODE) || DEFAULT_PTT_CODE)
  } catch {}
  voiceState.pushToTalkEnabled = enabled
  voiceState.pushToTalkKey = keyCode
}

function initPushToTalk() {
  loadPttSettings()
  syncPttUi()

  if (voicePttToggle) {
    voicePttToggle.addEventListener("change", () => {
      setPushToTalkEnabled(voicePttToggle.checked)
    })
  }

  if (voicePttSetKeyBtn) {
    voicePttSetKeyBtn.addEventListener("click", (event) => {
      event.preventDefault()
      startKeyCapture()
    })
  }

  window.addEventListener("keydown", handleKeyDown)
  window.addEventListener("keyup", handleKeyUp)
}

export { initPushToTalk, applyPushToTalkState, setPushToTalkEnabled }
