import { notify } from "../notice.js"
import { socket } from "../socket.js"
import {
  voiceInputDeviceSelect,
  voiceCameraDeviceSelect,
  voiceVideoQualitySelect,
  voiceCameraRow,
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
import { setParticipantCameraEnabled } from "./participants.js"
import { applyPushToTalkState } from "./ptt.js"
import { syncOutgoingVideoTrack, syncOutgoingAudioTrack } from "./rtc.js"
import { updateVoiceUi } from "./ui.js"

const INPUT_DEVICE_KEY = "voice:input_device"
const CAMERA_DEVICE_KEY = "voice:camera_device"
const CAMERA_FACING_MODE_KEY = "voice:camera_facing_mode"
const CAMERA_QUALITY_MODE_KEY = "voice:camera_quality_mode"
const OUTPUT_DEVICE_KEY = "voice:output_device"
const OUTPUT_VOLUME_KEY = "voice:output_volume"
const INPUT_GAIN_KEY = "voice:input_gain"
const AUTO_CAMERA_PROFILE_COOLDOWN_MS = 9000

const CAMERA_PROFILES = {
  high: { width: 1280, height: 720, frameRate: 24 },
  balanced: { width: 960, height: 540, frameRate: 20 },
  low: { width: 640, height: 360, frameRate: 15 }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeFacingMode(value) {
  return value === "environment" ? "environment" : "user"
}

function normalizeQualityMode(value) {
  if (value === "high" || value === "balanced" || value === "low") return value
  return "auto"
}

function isLikelyMobileClient() {
  const ua = String((navigator && navigator.userAgent) || "")
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(max-width: 900px)").matches
  }
  return false
}

function resolveAutoCameraProfile(summary = voiceState.qualitySummary) {
  const level = String((summary && summary.level) || "Unknown")
  if (level === "Poor") return "low"
  if (level === "Fair") return "balanced"
  if (level === "Good") return "high"
  return "balanced"
}

function resolveTargetCameraProfile(summary = voiceState.qualitySummary) {
  const mode = normalizeQualityMode(voiceState.cameraQualityMode)
  if (mode === "auto") {
    return resolveAutoCameraProfile(summary)
  }
  return mode
}

function getCameraProfileSettings(profileKey) {
  const fallback = CAMERA_PROFILES.balanced
  return CAMERA_PROFILES[profileKey] || fallback
}

function buildCameraTrackConstraints(profileKey) {
  const profile = getCameraProfileSettings(profileKey)
  return {
    width: { ideal: profile.width, max: profile.width },
    height: { ideal: profile.height, max: profile.height },
    frameRate: { ideal: profile.frameRate, max: profile.frameRate }
  }
}

function buildCameraMediaConstraints() {
  const useDeviceId = !voiceState.preferCameraFacingMode
  const deviceId = useDeviceId && voiceState.cameraDeviceId && voiceState.cameraDeviceId !== "default"
    ? voiceState.cameraDeviceId
    : ""
  const profile = resolveTargetCameraProfile()
  const trackConstraints = buildCameraTrackConstraints(profile)
  const facingMode = normalizeFacingMode(voiceState.cameraFacingMode)

  const video = {
    ...trackConstraints,
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facingMode } })
  }

  return { profile, deviceId, facingMode, constraints: { video, audio: false } }
}

function getLiveVideoTracks(stream) {
  if (!stream || typeof stream.getVideoTracks !== "function") return []
  return stream.getVideoTracks().filter((track) => track && track.readyState === "live")
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
  let cameraDeviceId = ""
  let cameraFacingMode = "user"
  let cameraQualityMode = "auto"
  let outputDeviceId = ""
  try {
    inputDeviceId = String(localStorage.getItem(INPUT_DEVICE_KEY) || "")
    cameraDeviceId = String(localStorage.getItem(CAMERA_DEVICE_KEY) || "")
    cameraFacingMode = String(localStorage.getItem(CAMERA_FACING_MODE_KEY) || "user")
    cameraQualityMode = String(localStorage.getItem(CAMERA_QUALITY_MODE_KEY) || "auto")
    outputDeviceId = String(localStorage.getItem(OUTPUT_DEVICE_KEY) || "")
  } catch {}

  voiceState.inputDeviceId = inputDeviceId
  voiceState.cameraDeviceId = cameraDeviceId
  voiceState.cameraFacingMode = normalizeFacingMode(cameraFacingMode)
  voiceState.cameraQualityMode = normalizeQualityMode(cameraQualityMode)
  voiceState.cameraAppliedProfile = resolveTargetCameraProfile()
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
  const cameras = devices.filter((device) => device.kind === "videoinput")
  const outputs = devices.filter((device) => device.kind === "audiooutput")
  voiceState.availableCameraCount = cameras.length
  voiceState.canFlipCamera = cameras.length > 1 || (cameras.length > 0 && isLikelyMobileClient())

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

  if (voiceCameraDeviceSelect) {
    voiceCameraDeviceSelect.innerHTML = ""
    if (cameras.length === 0) {
      const option = document.createElement("option")
      option.value = ""
      option.textContent = "Tidak ada kamera"
      voiceCameraDeviceSelect.appendChild(option)
      voiceCameraDeviceSelect.disabled = true
      if (voiceCameraRow) {
        voiceCameraRow.classList.add("is-disabled")
      }
    } else {
      voiceCameraDeviceSelect.disabled = false
      cameras.forEach((device, index) => {
        const option = document.createElement("option")
        option.value = device.deviceId
        option.textContent = device.label || `Camera ${index + 1}`
        voiceCameraDeviceSelect.appendChild(option)
      })
      if (!voiceState.cameraDeviceId || !cameras.some((d) => d.deviceId === voiceState.cameraDeviceId)) {
        voiceState.cameraDeviceId = cameras[0].deviceId
      }
      voiceCameraDeviceSelect.value = voiceState.cameraDeviceId
      if (voiceCameraRow) {
        voiceCameraRow.classList.remove("is-disabled")
      }
    }
  }

  if (voiceVideoQualitySelect) {
    const mode = normalizeQualityMode(voiceState.cameraQualityMode)
    voiceState.cameraQualityMode = mode
    voiceVideoQualitySelect.disabled = cameras.length === 0
    if (voiceVideoQualitySelect.value !== mode) {
      voiceVideoQualitySelect.value = mode
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

  return { inputs, cameras, outputs }
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

function hasMatchingDevice(devices, deviceId) {
  if (!deviceId) return false
  return Array.isArray(devices) && devices.some((device) => device && device.deviceId === deviceId)
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

async function createLocalCameraStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return null
  }
  const { profile, deviceId, facingMode, constraints } = buildCameraMediaConstraints()

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    voiceState.cameraAppliedProfile = profile
    return stream
  } catch (error) {
    if (deviceId) {
      voiceState.cameraDeviceId = ""
      const fallbackConstraints = {
        video: {
          ...buildCameraTrackConstraints(profile),
          facingMode: { ideal: facingMode }
        },
        audio: false
      }
      const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints)
      voiceState.cameraAppliedProfile = profile
      return stream
    }
    throw error
  }
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

async function handleLocalCameraTrackEnded(track, { silent = false } = {}) {
  if (!track) return
  if (voiceState.isCameraBusy) return
  if (voiceState.localCameraTrack !== track || !voiceState.isCameraEnabled) return

  if (voiceState.localStream) {
    voiceState.localStream.getVideoTracks().forEach((item) => {
      voiceState.localStream.removeTrack(item)
    })
  }

  if (voiceState.localCameraStream) {
    voiceState.localCameraStream.getTracks().forEach((item) => {
      if (item !== track) {
        item.stop()
      }
    })
  }

  voiceState.localCameraStream = null
  voiceState.localCameraTrack = null
  voiceState.isCameraEnabled = false
  voiceState.restoreCameraAfterJoin = false

  const selfId = voiceState.selfId || socket.id
  if (selfId) {
    setParticipantCameraEnabled(selfId, false)
  }

  await syncOutgoingVideoTrack(null)

  if (socket.connected && voiceState.isJoined) {
    socket.emit("voice camera state", { is_camera_enabled: false })
  }

  updateVoiceUi()
  if (!silent) {
    notify("Kamera berhenti. Cek izin browser atau device.")
  }
}

async function replaceOutgoingTracks(stream) {
  const nextTrack =
    stream && typeof stream.getAudioTracks === "function" ? stream.getAudioTracks()[0] || null : null
  await syncOutgoingAudioTrack(nextTrack)
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

    const preservedVideoTracks = getLiveVideoTracks(voiceState.localStream)

    if (voiceState.rawStream) {
      voiceState.rawStream.getTracks().forEach((track) => track.stop())
    }
    if (voiceState.localStream && voiceState.localStream !== voiceState.rawStream) {
      voiceState.localStream.getAudioTracks().forEach((track) => track.stop())
    }
    stopExistingInputPipeline()

    voiceState.rawStream = result.rawStream
    voiceState.localStream = result.stream
    preservedVideoTracks.forEach((track) => {
      if (!voiceState.localStream.getVideoTracks().includes(track)) {
        voiceState.localStream.addTrack(track)
      }
    })
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

async function reacquireLocalCameraStream({ silent = false } = {}) {
  try {
    const cameraStream = await createLocalCameraStream()
    if (!cameraStream) {
      if (!silent) {
        notify("Browser tidak mendukung kamera.")
      }
      return null
    }

    const nextTrack = cameraStream.getVideoTracks()[0]
    if (!nextTrack) {
      cameraStream.getTracks().forEach((track) => track.stop())
      if (!silent) {
        notify("Track kamera tidak tersedia.")
      }
      return null
    }

    nextTrack.onended = () => {
      handleLocalCameraTrackEnded(nextTrack).catch(() => {})
    }

    if (!voiceState.localStream) {
      voiceState.localStream = new MediaStream()
    }

    voiceState.localStream.getVideoTracks().forEach((track) => {
      voiceState.localStream.removeTrack(track)
    })

    if (voiceState.localCameraStream) {
      voiceState.localCameraStream.getTracks().forEach((track) => track.stop())
    }

    voiceState.localCameraStream = cameraStream
    voiceState.localCameraTrack = nextTrack
    voiceState.localStream.addTrack(nextTrack)

    await syncOutgoingVideoTrack(nextTrack)
    return cameraStream
  } catch (error) {
    if (!silent) {
      notify("Kamera tidak bisa diakses. Coba ganti device.")
    }
    return null
  }
}

function setCameraDevice(deviceId) {
  voiceState.cameraDeviceId = deviceId || ""
  voiceState.preferCameraFacingMode = false
  try {
    localStorage.setItem(CAMERA_DEVICE_KEY, voiceState.cameraDeviceId)
  } catch {}

  if (voiceState.isJoined && voiceState.isCameraEnabled) {
    reacquireLocalCameraStream({ silent: true }).catch(() => {})
  }
}

async function applyCameraProfile({ summary = voiceState.qualitySummary, silent = true, forceReacquire = false } = {}) {
  const targetProfile = resolveTargetCameraProfile(summary)
  if (!voiceState.isJoined || !voiceState.isCameraEnabled || !voiceState.localCameraTrack) {
    voiceState.cameraAppliedProfile = targetProfile
    return targetProfile
  }
  if (voiceState.isCameraQualityApplying) {
    return voiceState.cameraAppliedProfile || targetProfile
  }

  voiceState.isCameraQualityApplying = true
  try {
    if (!forceReacquire && voiceState.localCameraTrack.applyConstraints) {
      try {
        await voiceState.localCameraTrack.applyConstraints(buildCameraTrackConstraints(targetProfile))
        voiceState.cameraAppliedProfile = targetProfile
        return targetProfile
      } catch {
        // Fallback to full stream reacquire for browsers with limited constraint support.
      }
    }

    const stream = await reacquireLocalCameraStream({ silent })
    if (stream) {
      voiceState.cameraAppliedProfile = targetProfile
      return targetProfile
    }
    return voiceState.cameraAppliedProfile || targetProfile
  } finally {
    voiceState.isCameraQualityApplying = false
  }
}

function setCameraFacingMode(nextFacingMode) {
  const normalized = normalizeFacingMode(nextFacingMode)
  voiceState.cameraFacingMode = normalized
  try {
    localStorage.setItem(CAMERA_FACING_MODE_KEY, normalized)
  } catch {}
}

async function toggleCameraFacingMode({ silent = false } = {}) {
  const nextFacing = voiceState.cameraFacingMode === "environment" ? "user" : "environment"
  setCameraFacingMode(nextFacing)
  voiceState.preferCameraFacingMode = true

  // Facing mode and explicit deviceId can conflict on some browsers.
  voiceState.cameraDeviceId = ""
  try {
    localStorage.setItem(CAMERA_DEVICE_KEY, "")
  } catch {}

  if (voiceState.isJoined && voiceState.isCameraEnabled) {
    const stream = await reacquireLocalCameraStream({ silent })
    if (!stream && !silent) {
      notify("Gagal mengganti kamera depan/belakang")
    }
  } else if (!silent) {
    notify(nextFacing === "environment" ? "Mode kamera belakang dipilih" : "Mode kamera depan dipilih")
  }

  return voiceState.cameraFacingMode
}

function setCameraQualityMode(nextMode) {
  const normalized = normalizeQualityMode(nextMode)
  voiceState.cameraQualityMode = normalized
  try {
    localStorage.setItem(CAMERA_QUALITY_MODE_KEY, normalized)
  } catch {}

  if (normalized !== "auto") {
    voiceState.lastCameraAutoTuneAt = 0
  }

  applyCameraProfile({ summary: voiceState.qualitySummary, silent: true }).catch(() => {})
}

async function syncAdaptiveCameraQuality(summary) {
  if (normalizeQualityMode(voiceState.cameraQualityMode) !== "auto") return
  if (!voiceState.isJoined || !voiceState.isCameraEnabled || !voiceState.localCameraTrack) return
  if (voiceState.isCameraQualityApplying) return

  const targetProfile = resolveTargetCameraProfile(summary)
  if (targetProfile === voiceState.cameraAppliedProfile) return

  const now = Date.now()
  if (now - Number(voiceState.lastCameraAutoTuneAt || 0) < AUTO_CAMERA_PROFILE_COOLDOWN_MS) return
  voiceState.lastCameraAutoTuneAt = now
  await applyCameraProfile({ summary, silent: true })
}

async function handleMediaDeviceChange() {
  const previousInputDeviceId = voiceState.inputDeviceId
  const previousCameraDeviceId = voiceState.cameraDeviceId
  const previousOutputDeviceId = voiceState.outputDeviceId
  const previousCameraTrack = voiceState.localCameraTrack
  const wasCameraEnabled = Boolean(voiceState.isJoined && voiceState.isCameraEnabled && previousCameraTrack)

  const deviceSnapshot = await refreshDeviceOptions()
  if (!deviceSnapshot) {
    updateVoiceUi()
    return
  }

  const { inputs, cameras, outputs } = deviceSnapshot
  const inputMissing = hasMatchingDevice(inputs, previousInputDeviceId) === false && Boolean(previousInputDeviceId)
  const cameraMissing = hasMatchingDevice(cameras, previousCameraDeviceId) === false && Boolean(previousCameraDeviceId)
  const outputMissing = hasMatchingDevice(outputs, previousOutputDeviceId) === false && Boolean(previousOutputDeviceId)

  if (inputMissing && voiceState.isJoined && voiceState.canSpeak) {
    if (inputs.length > 0) {
      const stream = await reacquireLocalStream({ silent: true })
      if (stream) {
        notify("Mikrofon berubah. Privix mencoba pindah ke device yang tersedia.")
      }
    } else {
      notify("Mikrofon tidak terdeteksi. Cek device atau izin browser.")
    }
  }

  if (cameraMissing && wasCameraEnabled) {
    if (cameras.length > 0) {
      const stream = await reacquireLocalCameraStream({ silent: true })
      if (stream) {
        notify("Kamera berubah. Privix mencoba pindah ke device yang tersedia.")
      } else if (previousCameraTrack) {
        await handleLocalCameraTrackEnded(previousCameraTrack, { silent: true })
        notify("Kamera terputus dan dimatikan.")
      }
    } else if (previousCameraTrack) {
      await handleLocalCameraTrackEnded(previousCameraTrack, { silent: true })
      notify("Kamera terputus dan dimatikan.")
    }
  }

  if (outputMissing) {
    applyOutputToAll()
    if (voiceState.isJoined || voiceState.audioEls.size > 0) {
      notify("Output audio berubah ke device default yang tersedia.")
    }
  }

  updateVoiceUi()
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
    const updatePopoverAnchor = () => {
      if (!voiceSettingsPopover.classList.contains("is-open")) return
      const popRect = voiceSettingsPopover.getBoundingClientRect()
      const toggleRect = voiceSettingsToggleBtn.getBoundingClientRect()
      if (!Number.isFinite(popRect.width) || popRect.width <= 0) return
      const target = toggleRect.left + toggleRect.width / 2 - popRect.left
      const arrowX = clamp(target, 22, popRect.width - 22)
      voiceSettingsPopover.style.setProperty("--voice-popover-arrow-x", `${Math.round(arrowX)}px`)
    }

    const schedulePopoverAnchorUpdate = () => {
      if (!voiceSettingsPopover.classList.contains("is-open")) return
      requestAnimationFrame(() => {
        updatePopoverAnchor()
      })
    }

    const setOpen = (open) => {
      voiceSettingsPopover.classList.toggle("is-open", open)
      voiceSettingsPopover.setAttribute("aria-hidden", open ? "false" : "true")
      voiceSettingsToggleBtn.setAttribute("aria-expanded", open ? "true" : "false")
      if (open) {
        schedulePopoverAnchorUpdate()
      }
    }

    voiceSettingsToggleBtn.addEventListener("click", (event) => {
      event.stopPropagation()
      const isOpen = voiceSettingsPopover.classList.contains("is-open")
      setOpen(!isOpen)
      if (!isOpen) {
        refreshDeviceOptions().catch(() => {})
        schedulePopoverAnchorUpdate()
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

    window.addEventListener("resize", () => {
      schedulePopoverAnchorUpdate()
    })

    window.addEventListener("orientationchange", () => {
      schedulePopoverAnchorUpdate()
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

  if (voiceCameraDeviceSelect) {
    voiceCameraDeviceSelect.addEventListener("change", () => {
      setCameraDevice(voiceCameraDeviceSelect.value)
    })
    voiceCameraDeviceSelect.addEventListener("focus", () => {
      refreshDeviceOptions().catch(() => {})
    })
  }

  if (voiceVideoQualitySelect) {
    voiceVideoQualitySelect.addEventListener("change", () => {
      setCameraQualityMode(voiceVideoQualitySelect.value)
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
      handleMediaDeviceChange().catch(() => {
        refreshDeviceOptions().catch(() => {})
      })
    })
  }
}

export {
  initVoiceSettings,
  refreshDeviceOptions,
  applyOutputSettings,
  createLocalAudioStream,
  createLocalCameraStream,
  handleLocalCameraTrackEnded,
  reacquireLocalStream,
  reacquireLocalCameraStream,
  setCameraDevice,
  setCameraQualityMode,
  toggleCameraFacingMode,
  syncAdaptiveCameraQuality,
  stopExistingInputPipeline
}
