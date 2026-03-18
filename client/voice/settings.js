import { notify } from "../notice.js"
import {
  voiceInputDeviceSelect,
  voiceOutputDeviceSelect,
  voiceOutputRow,
  voiceOutputVolumeSlider,
  voiceOutputVolumeValue,
  voiceInputGainSlider,
  voiceInputGainValue,
  voiceSettingsToggleBtn,
  voiceSettingsPopover
} from "../dom.js"
import { voiceState } from "./state.js"
import { ensureAudioContext, attachAnalyser, removeAnalyser } from "./audio.js"
import { applyPushToTalkState } from "./ptt.js"

const INPUT_DEVICE_KEY = "voice:input_device"
const OUTPUT_DEVICE_KEY = "voice:output_device"
const OUTPUT_VOLUME_KEY = "voice:output_volume"
const INPUT_GAIN_KEY = "voice:input_gain"

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

function loadStoredSettings() {
  let outputVolume = 0.8
  let inputGain = 1
  try {
    const storedVolume = Number(localStorage.getItem(OUTPUT_VOLUME_KEY))
    const storedGain = Number(localStorage.getItem(INPUT_GAIN_KEY))
    if (Number.isFinite(storedVolume)) {
      outputVolume = clamp(storedVolume, 0, 1)
    }
    if (Number.isFinite(storedGain)) {
      inputGain = clamp(storedGain, 0.5, 2)
    }
  } catch {}

  let inputDeviceId = ""
  let outputDeviceId = ""
  try {
    inputDeviceId = String(localStorage.getItem(INPUT_DEVICE_KEY) || "")
    outputDeviceId = String(localStorage.getItem(OUTPUT_DEVICE_KEY) || "")
  } catch {}

  voiceState.inputDeviceId = inputDeviceId
  voiceState.outputDeviceId = outputDeviceId
  voiceState.outputVolume = outputVolume
  voiceState.inputGain = inputGain
}

function updateVolumeUi() {
  if (voiceOutputVolumeSlider) {
    voiceOutputVolumeSlider.value = String(Math.round((voiceState.outputVolume || 0) * 100))
  }
  if (voiceOutputVolumeValue) {
    voiceOutputVolumeValue.textContent = `${Math.round((voiceState.outputVolume || 0) * 100)}%`
  }
}

function updateGainUi() {
  if (voiceInputGainSlider) {
    voiceInputGainSlider.value = String(Math.round((voiceState.inputGain || 1) * 100))
  }
  if (voiceInputGainValue) {
    voiceInputGainValue.textContent = `${Math.round((voiceState.inputGain || 1) * 100)}%`
  }
}

function hasOutputDeviceSupport() {
  if (typeof HTMLMediaElement === "undefined") return false
  return typeof HTMLMediaElement.prototype.setSinkId === "function"
}

async function refreshDeviceOptions() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return

  let devices = []
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    return
  }

  const inputs = devices.filter((device) => device.kind === "audioinput")
  const outputs = devices.filter((device) => device.kind === "audiooutput")

  if (voiceInputDeviceSelect) {
    voiceInputDeviceSelect.innerHTML = ""
    if (inputs.length === 0) {
      const option = document.createElement("option")
      option.value = ""
      option.textContent = "Tidak ada mikrofon"
      voiceInputDeviceSelect.appendChild(option)
      voiceInputDeviceSelect.disabled = true
    } else {
      voiceInputDeviceSelect.disabled = false
      inputs.forEach((device, index) => {
        const option = document.createElement("option")
        option.value = device.deviceId
        option.textContent = device.label || `Microphone ${index + 1}`
        voiceInputDeviceSelect.appendChild(option)
      })
      if (!voiceState.inputDeviceId || !inputs.some((d) => d.deviceId === voiceState.inputDeviceId)) {
        voiceState.inputDeviceId = inputs[0].deviceId
      }
      voiceInputDeviceSelect.value = voiceState.inputDeviceId
    }
  }

  if (voiceOutputDeviceSelect) {
    const outputSupported = hasOutputDeviceSupport()
    voiceOutputDeviceSelect.innerHTML = ""
    if (!outputSupported) {
      const option = document.createElement("option")
      option.value = ""
      option.textContent = "Output default (tidak bisa pilih)"
      voiceOutputDeviceSelect.appendChild(option)
      voiceOutputDeviceSelect.disabled = true
      if (voiceOutputRow) {
        voiceOutputRow.classList.add("is-disabled")
      }
    } else if (outputs.length === 0) {
      const option = document.createElement("option")
      option.value = ""
      option.textContent = "Output default"
      voiceOutputDeviceSelect.appendChild(option)
      voiceOutputDeviceSelect.disabled = false
      if (voiceOutputRow) {
        voiceOutputRow.classList.remove("is-disabled")
      }
    } else {
      voiceOutputDeviceSelect.disabled = false
      outputs.forEach((device, index) => {
        const option = document.createElement("option")
        option.value = device.deviceId
        option.textContent = device.label || `Speaker ${index + 1}`
        voiceOutputDeviceSelect.appendChild(option)
      })
      if (
        !voiceState.outputDeviceId ||
        !outputs.some((d) => d.deviceId === voiceState.outputDeviceId)
      ) {
        voiceState.outputDeviceId = outputs[0].deviceId
      }
      voiceOutputDeviceSelect.value = voiceState.outputDeviceId
      if (voiceOutputRow) {
        voiceOutputRow.classList.remove("is-disabled")
      }
    }
  }
}

function applyOutputSettings(audioEl) {
  if (!audioEl) return
  audioEl.volume = clamp(Number(voiceState.outputVolume || 0.8), 0, 1)
  if (voiceState.outputDeviceId && audioEl.setSinkId) {
    audioEl.setSinkId(voiceState.outputDeviceId).catch(() => {
      if (!voiceState.outputDeviceFailureNotified) {
        voiceState.outputDeviceFailureNotified = true
        notify("Output device belum didukung di browser ini.")
      }
    })
  }
}

function applyOutputToAll() {
  voiceState.audioEls.forEach((audioEl) => {
    applyOutputSettings(audioEl)
  })
}

async function createLocalAudioStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return null
  }
  const deviceId = voiceState.inputDeviceId && voiceState.inputDeviceId !== "default"
    ? voiceState.inputDeviceId
    : ""
  const constraints = {
    audio: deviceId ? { deviceId: { exact: deviceId } } : true
  }
  let rawStream = null
  try {
    rawStream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch (error) {
    if (deviceId) {
      voiceState.inputDeviceId = ""
      rawStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } else {
      throw error
    }
  }

  const ctx = ensureAudioContext()
  if (!ctx) {
    return { stream: rawStream, rawStream, gainNode: null, sourceNode: null }
  }

  const sourceNode = ctx.createMediaStreamSource(rawStream)
  const gainNode = ctx.createGain()
  gainNode.gain.value = clamp(Number(voiceState.inputGain || 1), 0.5, 2)
  const destination = ctx.createMediaStreamDestination()
  sourceNode.connect(gainNode)
  gainNode.connect(destination)

  return { stream: destination.stream, rawStream, gainNode, sourceNode }
}

function stopExistingInputPipeline() {
  if (voiceState.inputSourceNode) {
    try {
      voiceState.inputSourceNode.disconnect()
    } catch {}
  }
  if (voiceState.inputGainNode) {
    try {
      voiceState.inputGainNode.disconnect()
    } catch {}
  }
  voiceState.inputSourceNode = null
  voiceState.inputGainNode = null
}

async function replaceOutgoingTracks(stream) {
  if (!stream) return
  const tracks = stream.getAudioTracks()
  if (tracks.length === 0) return

  voiceState.peers.forEach((pc) => {
    const senders = pc.getSenders().filter((sender) => sender.track && sender.track.kind === "audio")
    if (senders.length === 0) {
      tracks.forEach((track) => pc.addTrack(track, stream))
      return
    }
    senders.forEach((sender) => {
      sender.replaceTrack(tracks[0]).catch(() => {})
    })
  })
}

async function reacquireLocalStream({ silent = false } = {}) {
  try {
    const result = await createLocalAudioStream()
    if (!result) {
      if (!silent) {
        notify("Browser tidak mendukung input suara.")
      }
      return null
    }

    if (voiceState.rawStream) {
      voiceState.rawStream.getTracks().forEach((track) => track.stop())
    }
    if (voiceState.localStream && voiceState.localStream !== voiceState.rawStream) {
      voiceState.localStream.getTracks().forEach((track) => track.stop())
    }
    stopExistingInputPipeline()

    voiceState.rawStream = result.rawStream
    voiceState.localStream = result.stream
    voiceState.inputGainNode = result.gainNode
    voiceState.inputSourceNode = result.sourceNode

    removeAnalyser(voiceState.selfId)
    attachAnalyser(voiceState.selfId, voiceState.localStream)

    await replaceOutgoingTracks(voiceState.localStream)
    applyPushToTalkState()
    return voiceState.localStream
  } catch (error) {
    if (!silent) {
      notify("Mic tidak bisa diakses. Coba ganti device.")
    }
    return null
  }
}

function setInputDevice(deviceId) {
  voiceState.inputDeviceId = deviceId || ""
  try {
    localStorage.setItem(INPUT_DEVICE_KEY, voiceState.inputDeviceId)
  } catch {}

  if (voiceState.isJoined && !voiceState.canSpeak) {
    notify("Kamu sedang listener, mic tidak bisa diaktifkan.")
    return
  }

  if (voiceState.isJoined && voiceState.canSpeak) {
    reacquireLocalStream({ silent: true }).catch(() => {})
  }
}

function setOutputDevice(deviceId) {
  voiceState.outputDeviceId = deviceId || ""
  try {
    localStorage.setItem(OUTPUT_DEVICE_KEY, voiceState.outputDeviceId)
  } catch {}
  applyOutputToAll()
}

function setOutputVolume(value) {
  voiceState.outputVolume = clamp(value, 0, 1)
  try {
    localStorage.setItem(OUTPUT_VOLUME_KEY, String(voiceState.outputVolume))
  } catch {}
  updateVolumeUi()
  applyOutputToAll()
}

function setInputGain(value) {
  voiceState.inputGain = clamp(value, 0.5, 2)
  try {
    localStorage.setItem(INPUT_GAIN_KEY, String(voiceState.inputGain))
  } catch {}
  updateGainUi()
  if (voiceState.inputGainNode) {
    voiceState.inputGainNode.gain.value = voiceState.inputGain
  }
}

function initVoiceSettings() {
  loadStoredSettings()
  updateVolumeUi()
  updateGainUi()

  if (voiceSettingsToggleBtn && voiceSettingsPopover) {
    const setOpen = (open) => {
      voiceSettingsPopover.classList.toggle("is-open", open)
      voiceSettingsPopover.setAttribute("aria-hidden", open ? "false" : "true")
      voiceSettingsToggleBtn.setAttribute("aria-expanded", open ? "true" : "false")
    }

    voiceSettingsToggleBtn.addEventListener("click", (event) => {
      event.stopPropagation()
      const isOpen = voiceSettingsPopover.classList.contains("is-open")
      setOpen(!isOpen)
      if (!isOpen) {
        refreshDeviceOptions().catch(() => {})
      }
    })

    document.addEventListener("click", (event) => {
      if (!voiceSettingsPopover.classList.contains("is-open")) return
      if (voiceSettingsPopover.contains(event.target)) return
      if (voiceSettingsToggleBtn.contains(event.target)) return
      setOpen(false)
    })

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    })
  }

  if (voiceInputDeviceSelect) {
    voiceInputDeviceSelect.addEventListener("change", () => {
      setInputDevice(voiceInputDeviceSelect.value)
    })
    voiceInputDeviceSelect.addEventListener("focus", () => {
      refreshDeviceOptions().catch(() => {})
    })
  }

  if (voiceOutputDeviceSelect) {
    voiceOutputDeviceSelect.addEventListener("change", () => {
      setOutputDevice(voiceOutputDeviceSelect.value)
    })
    voiceOutputDeviceSelect.addEventListener("focus", () => {
      refreshDeviceOptions().catch(() => {})
    })
  }

  if (voiceOutputVolumeSlider) {
    voiceOutputVolumeSlider.addEventListener("input", () => {
      const next = Number(voiceOutputVolumeSlider.value) / 100
      setOutputVolume(next)
    })
  }

  if (voiceInputGainSlider) {
    voiceInputGainSlider.addEventListener("input", () => {
      const next = Number(voiceInputGainSlider.value) / 100
      setInputGain(next)
    })
  }

  applyOutputToAll()
  refreshDeviceOptions().catch(() => {})
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      refreshDeviceOptions().catch(() => {})
    })
  }
}

export {
  initVoiceSettings,
  refreshDeviceOptions,
  applyOutputSettings,
  createLocalAudioStream,
  reacquireLocalStream,
  stopExistingInputPipeline
}
