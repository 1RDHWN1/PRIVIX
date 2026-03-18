import { notify } from "../notice.js"
import { voiceState } from "./state.js"

function ensureAudioContext() {
  if (voiceState.audioContext) {
    if (voiceState.audioContext.state === "suspended") {
      voiceState.audioContext.resume().catch(() => {})
    }
    return voiceState.audioContext
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return null
  try {
    voiceState.audioContext = new AudioCtx()
    return voiceState.audioContext
  } catch {
    return null
  }
}

function attemptPlayAudio(el) {
  if (!el || typeof el.play !== "function") return
  const playPromise = el.play()
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      if (!voiceState.iceFailureNotified) {
        notify("Klik Join Voice untuk mengaktifkan audio.")
      }
    })
  }
}

function playNotificationTone(type) {
  const ctx = ensureAudioContext()
  if (!ctx) return
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {})
  }

  const now = ctx.currentTime
  const gain = ctx.createGain()
  gain.gain.value = 0.5
  gain.connect(ctx.destination)

  const beep = (freq, start, duration) => {
    const osc = ctx.createOscillator()
    osc.type = "sine"
    osc.frequency.setValueAtTime(freq, start)
    osc.connect(gain)
    osc.start(start)
    osc.stop(start + duration)
  }

  if (type === "join") {
    beep(520, now, 0.08)
    beep(680, now + 0.1, 0.08)
  } else if (type === "leave") {
    beep(320, now, 0.12)
  }
}

function escapeCssValue(value) {
  const safe = String(value || "")
  if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(safe)
  }
  return safe.replace(/(["\\])/g, "\\$1")
}
function applySidebarSpeakingState(peerId, isSpeaking) {
  if (!peerId) return
  const row = document.querySelector(`.voice-channel-member[data-peer-id="${escapeCssValue(String(peerId))}"]`)
  if (!row) return

  const muted = row.classList.contains("is-muted")
  const speaking = Boolean(isSpeaking) && !muted
  row.classList.toggle("is-speaking", speaking)
}

function setSpeakingState(peerId, isSpeaking) {
  if (!peerId) return
  voiceState.speakingState.set(peerId, Boolean(isSpeaking))
  const tile = voiceState.tileEls.get(peerId)
  if (tile) {
    tile.classList.toggle("is-speaking", Boolean(isSpeaking))
  }
  applySidebarSpeakingState(peerId, isSpeaking)
}

function startSpeakingLoop() {
  if (voiceState.analyserLoopId) return
  const loop = () => {
    voiceState.analyserLoopId = requestAnimationFrame(loop)
    if (voiceState.analysers.size === 0) {
      stopSpeakingLoop()
      return
    }
    voiceState.analysers.forEach((entry, peerId) => {
      if (!entry || !entry.analyser || !entry.data) return
      entry.analyser.getByteTimeDomainData(entry.data)
      let sum = 0
      for (let i = 0; i < entry.data.length; i += 1) {
        const v = entry.data[i] - 128
        sum += Math.abs(v)
      }
      const avg = sum / entry.data.length
      const speaking = avg > 6
      if (entry.speaking !== speaking) {
        entry.speaking = speaking
        setSpeakingState(peerId, speaking)
      }
    })
  }
  voiceState.analyserLoopId = requestAnimationFrame(loop)
}

function stopSpeakingLoop() {
  if (voiceState.analyserLoopId) {
    cancelAnimationFrame(voiceState.analyserLoopId)
    voiceState.analyserLoopId = 0
  }
}

function attachAnalyser(peerId, stream) {
  if (!peerId || !stream) return
  if (voiceState.analysers.has(peerId)) return
  const ctx = ensureAudioContext()
  if (!ctx) return
  try {
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.85
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    voiceState.analysers.set(peerId, { analyser, data, source, speaking: false })
    startSpeakingLoop()
  } catch {}
}

function removeAnalyser(peerId) {
  const entry = voiceState.analysers.get(peerId)
  if (entry && entry.source) {
    try {
      entry.source.disconnect()
    } catch {}
  }
  voiceState.analysers.delete(peerId)
  voiceState.speakingState.delete(peerId)
}

export {
  ensureAudioContext,
  attemptPlayAudio,
  playNotificationTone,
  attachAnalyser,
  removeAnalyser,
  startSpeakingLoop,
  stopSpeakingLoop
}

