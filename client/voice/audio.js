import { notify } from "../notice.js"
import { voiceState } from "./state.js"
import { updateVoiceUi } from "./ui.js"

function ensureAudioContext() {
  if (voiceState.audioContext) {
    if (voiceState.audioContext.state === "suspended") {
      voiceState.audioContext.resume().then(() => {
        voiceState.audioPlaybackPromptShown = false
      }).catch(() => {})
    }
    return voiceState.audioContext
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return null
  try {
    voiceState.audioContext = new AudioCtx()
    voiceState.audioPlaybackPromptShown = false
    return voiceState.audioContext
  } catch {
    return null
  }
}

function attemptPlayAudio(el) {
  if (!el || typeof el.play !== "function") return
  const playPromise = el.play()
  if (playPromise && typeof playPromise.then === "function") {
    playPromise.then(() => {
      voiceState.audioPlaybackPromptShown = false
    }).catch(() => {
      if (!voiceState.audioPlaybackPromptShown) {
        voiceState.audioPlaybackPromptShown = true
        notify("Klik area aplikasi untuk mengaktifkan audio voice.")
      }
    })
    return
  }
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      if (!voiceState.audioPlaybackPromptShown) {
        voiceState.audioPlaybackPromptShown = true
        notify("Klik area aplikasi untuk mengaktifkan audio voice.")
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
  if (voiceState.stageLayoutMode === "focus") {
    updateVoiceUi()
  }
}

function applySpeakingVisualLevel(peerId, level) {
  const tile = voiceState.tileEls.get(peerId)
  if (!tile) return
  const safe = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  tile.style.setProperty("--voice-speaking-level", safe.toFixed(3))
}

function startSpeakingLoop() {
  if (voiceState.analyserLoopId) return
  const ATTACK_THRESHOLD = 7.4
  const RELEASE_THRESHOLD = 4.8
  const RELEASE_HOLD_FRAMES = 7
  const SMOOTHING_ALPHA = 0.24
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
      const previousSmoothed = Number(entry.smoothedLevel) || 0
      const smoothed = previousSmoothed + (avg - previousSmoothed) * SMOOTHING_ALPHA
      entry.smoothedLevel = smoothed

      let speaking = Boolean(entry.speaking)
      if (speaking) {
        if (smoothed < RELEASE_THRESHOLD) {
          entry.releaseHoldFrames = Math.max(0, Number(entry.releaseHoldFrames || 0) - 1)
          if (entry.releaseHoldFrames <= 0) {
            speaking = false
          }
        } else {
          entry.releaseHoldFrames = RELEASE_HOLD_FRAMES
        }
      } else if (smoothed > ATTACK_THRESHOLD) {
        speaking = true
        entry.releaseHoldFrames = RELEASE_HOLD_FRAMES
      }

      const visualLevel = Math.min(1, smoothed / 18)
      if (!Number.isFinite(entry.lastVisualLevel) || Math.abs(visualLevel - entry.lastVisualLevel) >= 0.04) {
        entry.lastVisualLevel = visualLevel
        applySpeakingVisualLevel(peerId, visualLevel)
      }

      if (entry.speaking !== speaking) {
        entry.speaking = speaking
        setSpeakingState(peerId, speaking)
        if (!speaking) {
          applySpeakingVisualLevel(peerId, 0)
        }
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
    voiceState.analysers.set(peerId, {
      analyser,
      data,
      source,
      speaking: false,
      smoothedLevel: 0,
      releaseHoldFrames: 0,
      lastVisualLevel: 0
    })
    applySpeakingVisualLevel(peerId, 0)
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
  applySpeakingVisualLevel(peerId, 0)
  setSpeakingState(peerId, false)
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
