import {
  voicePanel,
  chatRoot,
  voiceStatus,
  voiceNetworkPill,
  voiceNetworkLatency,
  voiceJoinBtn,
  voiceLeaveBtn,
  voiceMuteBtn,
  voiceCameraBtn,
  voiceScreenBtn,
  voiceCameraFlipBtn,
  voiceLayoutBtn,
  voiceStage,
  voiceStageGrid,
  voiceStageTitle,
  voiceStageSubtitle,
  voiceJoinHeroBtn,
  voiceRoster,
  voiceQuality,
  voiceSettingsSessionChip,
  voiceSettingsCameraChip,
  voiceSettingsNetworkChip,
  voiceInputDeviceSelect,
  voiceInputDeviceHint,
  voiceCameraDeviceSelect,
  voiceCameraDeviceHint,
  voiceVideoQualitySelect,
  voiceVideoQualityHint,
  voiceOutputDeviceSelect,
  voiceOutputDeviceHint
} from "../dom.js"
import { notify } from "../notice.js"
import { setElementHidden, updateVoiceChannelListUi } from "../ui.js"
import { voiceState, resetVoiceStageState } from "./state.js"
import { updateSelfTileState } from "./participants.js"

let voiceUiRenderToken = 0
let lastRosterSignature = ""
let lastStageSignature = ""
let stageLayoutHydrated = false
let focusShiftUntil = 0
let focusShiftTimerId = 0

const STAGE_LAYOUT_STORAGE_KEY = "voice:stage_layout_mode"
const STAGE_LAYOUT_GRID = "grid"
const STAGE_LAYOUT_FOCUS = "focus"
const STAGE_FOCUS_LOCK_MS = 1800
const STAGE_FOCUS_SHIFT_MS = 360

function normalizeStageLayoutMode(value) {
  return value === STAGE_LAYOUT_FOCUS ? STAGE_LAYOUT_FOCUS : STAGE_LAYOUT_GRID
}

function hydrateStageLayoutMode() {
  if (stageLayoutHydrated) return
  stageLayoutHydrated = true
  try {
    voiceState.stageLayoutMode = normalizeStageLayoutMode(localStorage.getItem(STAGE_LAYOUT_STORAGE_KEY))
  } catch {
    voiceState.stageLayoutMode = normalizeStageLayoutMode(voiceState.stageLayoutMode)
  }
}

function persistStageLayoutMode(nextMode) {
  try {
    localStorage.setItem(STAGE_LAYOUT_STORAGE_KEY, nextMode)
  } catch {}
}

function scheduleFocusShiftUpdate() {
  if (focusShiftTimerId) {
    clearTimeout(focusShiftTimerId)
    focusShiftTimerId = 0
  }
  const remaining = focusShiftUntil - Date.now()
  if (remaining <= 0) return
  focusShiftTimerId = setTimeout(() => {
    focusShiftTimerId = 0
    updateVoiceUi()
  }, remaining + 12)
}

function getParticipantCount() {
  return voiceState.participants.size
}

function setControlLabel(button, text) {
  if (!button) return
  const label = button.querySelector(".voice-control-label")
  if (label) {
    label.textContent = text
  }
}

function setVoiceStageLayoutMode(nextMode) {
  const normalized = normalizeStageLayoutMode(nextMode)
  hydrateStageLayoutMode()
  if (voiceState.stageLayoutMode === normalized) return
  voiceState.stageLayoutMode = normalized
  resetVoiceStageState()
  focusShiftUntil = 0
  if (focusShiftTimerId) {
    clearTimeout(focusShiftTimerId)
    focusShiftTimerId = 0
  }
  persistStageLayoutMode(normalized)
  updateVoiceUi()
}

function setExpandedScreenShareId(participantId) {
  const nextId = String(participantId || "")
  if (voiceState.expandedScreenShareId === nextId) return
  voiceState.expandedScreenShareId = nextId
  if (nextId) {
    voiceState.stageFocusId = nextId
    voiceState.stageFocusLockUntil = Date.now() + STAGE_FOCUS_LOCK_MS
  }
  updateVoiceUi({ immediate: true })
}

function toggleVoiceStageLayoutMode() {
  hydrateStageLayoutMode()
  const nextMode =
    voiceState.stageLayoutMode === STAGE_LAYOUT_FOCUS ? STAGE_LAYOUT_GRID : STAGE_LAYOUT_FOCUS
  setVoiceStageLayoutMode(nextMode)
  notify(nextMode === STAGE_LAYOUT_FOCUS ? "Focus speaker mode aktif." : "Grid mode aktif.")
}

function formatQualityText() {
  if (!voiceState.isJoined) return "Quality: --"
  const summary = voiceState.qualitySummary
  if (!summary || !summary.updatedAt) return "Quality: Mengukur..."
  const loss = Number.isFinite(summary.lossPct) ? summary.lossPct.toFixed(1) : "0.0"
  const rtt = Number.isFinite(summary.rttMs) ? Math.round(summary.rttMs) : 0
  const jitter = Number.isFinite(summary.jitterMs) ? Math.round(summary.jitterMs) : 0
  return `Quality: ${summary.level} • RTT ${rtt}ms • Jitter ${jitter}ms • Loss ${loss}%`
}

function resolveNetworkPillState() {
  if (!voiceState.isJoined) {
    return { text: "-- ms", levelClass: "is-idle" }
  }

  const summary = voiceState.qualitySummary
  if (!summary || !summary.updatedAt) {
    return { text: "...", levelClass: "is-idle" }
  }

  const rtt = Number.isFinite(summary.rttMs) ? Math.max(0, Math.round(summary.rttMs)) : 0
  if (summary.level === "Poor") {
    return { text: `${rtt} ms`, levelClass: "is-poor" }
  }
  if (summary.level === "Fair") {
    return { text: `${rtt} ms`, levelClass: "is-fair" }
  }
  if (summary.level !== "Good" && summary.level !== "Solo") {
    return { text: "...", levelClass: "is-idle" }
  }

  return { text: `${rtt} ms`, levelClass: "is-good" }
}

function updateNetworkPill() {
  if (!voiceNetworkPill || !voiceNetworkLatency) return
  const state = resolveNetworkPillState()
  voiceNetworkLatency.textContent = state.text
  voiceNetworkPill.classList.remove("is-good", "is-fair", "is-poor", "is-idle")
  voiceNetworkPill.classList.add(state.levelClass)
}

function setSettingsChip(el, text, tone = "idle") {
  if (!el) return
  el.textContent = text
  el.classList.remove("is-good", "is-fair", "is-poor", "is-idle")
  if (tone === "good" || tone === "fair" || tone === "poor") {
    el.classList.add(`is-${tone}`)
    return
  }
  el.classList.add("is-idle")
}

function getSelectLabel(select, fallback) {
  if (!select) return fallback
  const option = select.selectedOptions && select.selectedOptions[0]
  return String((option && option.textContent) || fallback || "").trim()
}

function formatAppliedCameraProfile() {
  const profile = String(voiceState.cameraAppliedProfile || "balanced")
  if (profile === "high") return "high"
  if (profile === "low") return "low"
  return "balanced"
}

function formatPeerLatency(value) {
  const rtt = Number(value)
  if (!Number.isFinite(rtt) || rtt <= 0) return "--"
  return String(Math.max(1, Math.round(rtt)))
}

function getParticipantQualityMeta(participant) {
  if (!participant) {
    return { label: "NET --", tone: "is-idle" }
  }
  const participantId = participant.sourceParticipantId || participant.id

  if (participant.isSelf) {
    if (!voiceState.isJoined) return { label: "NET --", tone: "is-idle" }
    const summary = voiceState.qualitySummary
    if (!summary || !summary.updatedAt) return { label: "NET ...", tone: "is-idle" }
    const level = String(summary.level || "Unknown")
    if (level === "Good") return { label: `GOOD ${formatPeerLatency(summary.rttMs)}ms`, tone: "is-good" }
    if (level === "Fair") return { label: `FAIR ${formatPeerLatency(summary.rttMs)}ms`, tone: "is-fair" }
    if (level === "Poor") return { label: `POOR ${formatPeerLatency(summary.rttMs)}ms`, tone: "is-poor" }
    if (level === "Solo") return { label: "SOLO", tone: "is-good" }
    return { label: "NET ...", tone: "is-idle" }
  }

  const peerStats = voiceState.peerStats.get(participantId)
  if (!peerStats) {
    return { label: "NET ...", tone: "is-idle" }
  }
  const level = String(peerStats.level || "Unknown")
  if (level === "Good") return { label: `GOOD ${formatPeerLatency(peerStats.rttMs)}ms`, tone: "is-good" }
  if (level === "Fair") return { label: `FAIR ${formatPeerLatency(peerStats.rttMs)}ms`, tone: "is-fair" }
  if (level === "Poor") return { label: `POOR ${formatPeerLatency(peerStats.rttMs)}ms`, tone: "is-poor" }
  return { label: "NET ...", tone: "is-idle" }
}

function applyTileQualityBadge(tile, participant) {
  if (!tile) return
  const badge = tile.querySelector(".voice-quality-badge")
  if (!badge) return
  const meta = getParticipantQualityMeta(participant)
  badge.textContent = meta.label
  badge.classList.remove("is-good", "is-fair", "is-poor", "is-idle")
  badge.classList.add(meta.tone)
}

function updateVoiceSettingsUi() {
  const networkLevel = String((voiceState.qualitySummary && voiceState.qualitySummary.level) || "Unknown")

  if (voiceSettingsSessionChip) {
    let label = "Not joined"
    let tone = "idle"
    if (voiceState.isConnecting) {
      label = "Connecting"
      tone = "fair"
    } else if (voiceState.isJoined && !voiceState.canSpeak) {
      label = "Listener"
      tone = "fair"
    } else if (voiceState.isJoined && voiceState.isMuted) {
      label = "Muted"
      tone = "fair"
    } else if (voiceState.isJoined) {
      label = voiceState.pushToTalkEnabled ? "Push to talk" : "Mic live"
      tone = "good"
    } else if (voiceState.isVoiceChannel) {
      label = "Ready to join"
    }
    setSettingsChip(voiceSettingsSessionChip, label, tone)
  }

  if (voiceSettingsCameraChip) {
    let label = "Cam off"
    let tone = "idle"
    if (voiceState.availableCameraCount <= 0) {
      label = "No camera"
      tone = "poor"
    } else if (voiceState.isCameraBusy) {
      label = "Cam busy"
      tone = "fair"
    } else if (voiceState.isCameraEnabled) {
      label = "Cam on"
      tone = "good"
    }
    setSettingsChip(voiceSettingsCameraChip, label, tone)
  }

  if (voiceSettingsNetworkChip) {
    let label = "Network --"
    let tone = "idle"
    if (voiceState.isJoined && voiceState.qualitySummary && voiceState.qualitySummary.updatedAt) {
      label = `Network ${networkLevel}`
      tone =
        networkLevel === "Poor" ? "poor" : networkLevel === "Fair" ? "fair" : networkLevel === "Good" ? "good" : "idle"
    } else if (voiceState.isJoined) {
      label = "Network..."
      tone = "idle"
    }
    setSettingsChip(voiceSettingsNetworkChip, label, tone)
  }

  if (voiceInputDeviceHint) {
    const selectedLabel = getSelectLabel(voiceInputDeviceSelect, "Default microphone")
    if (voiceState.isJoined && !voiceState.canSpeak) {
      voiceInputDeviceHint.textContent = "Listener mode aktif. Mic tidak akan dikirim ke room."
    } else if (voiceState.isJoined) {
      voiceInputDeviceHint.textContent = `${selectedLabel} aktif dengan input gain ${Math.round((voiceState.inputGain || 1) * 100)}%.`
    } else {
      voiceInputDeviceHint.textContent = `${selectedLabel} akan dipakai saat join voice.`
    }
  }

  if (voiceCameraDeviceHint) {
    const selectedLabel = getSelectLabel(voiceCameraDeviceSelect, "No camera detected")
    if (voiceState.availableCameraCount <= 0) {
      voiceCameraDeviceHint.textContent = "Tidak ada kamera terdeteksi di browser atau device."
    } else if (voiceState.isCameraEnabled) {
      voiceCameraDeviceHint.textContent =
        `${selectedLabel} aktif • ${voiceState.cameraFacingMode === "environment" ? "back" : "front"} • ${formatAppliedCameraProfile()}.`
    } else {
      voiceCameraDeviceHint.textContent = `${selectedLabel} siap dipakai saat on-cam diaktifkan.`
    }
  }

  if (voiceVideoQualityHint) {
    const mode = String(voiceState.cameraQualityMode || "auto")
    if (voiceState.availableCameraCount <= 0) {
      voiceVideoQualityHint.textContent = "Video quality akan tersedia saat kamera terdeteksi."
    } else if (mode === "auto") {
      const applied = formatAppliedCameraProfile()
      voiceVideoQualityHint.textContent = voiceState.isCameraEnabled
        ? `Auto sedang menyesuaikan kualitas dan saat ini memakai profil ${applied}.`
        : `Auto siap menyesuaikan kualitas saat kamera aktif. Profil saat ini: ${applied}.`
    } else {
      voiceVideoQualityHint.textContent = `Mode ${mode} akan dipakai untuk stream kamera kamu.`
    }
  }

  if (voiceOutputDeviceHint) {
    const selectedLabel = getSelectLabel(voiceOutputDeviceSelect, "Default output")
    voiceOutputDeviceHint.textContent =
      `${selectedLabel} untuk audio voice room dengan volume ${Math.round((voiceState.outputVolume || 0) * 100)}%.`
  }
}

function getInitials(name) {
  const safe = String(name || "").trim()
  if (!safe) return "??"
  const parts = safe.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function getAvatarGradient(name) {
  const safe = String(name || "")
  let hash = 0
  for (let i = 0; i < safe.length; i += 1) {
    hash = (hash * 31 + safe.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  const hue2 = (hue + 30) % 360
  return `linear-gradient(135deg, hsl(${hue}, 65%, 45%), hsl(${hue2}, 65%, 40%))`
}

function hasLiveVideoTrack(stream) {
  if (!stream || typeof stream.getVideoTracks !== "function") return false
  return stream.getVideoTracks().some((track) => track && track.readyState === "live")
}

function normalizeCameraRatio(rawValue) {
  const ratio = Number(rawValue)
  if (!Number.isFinite(ratio) || ratio <= 0) return 0
  return Math.min(2.2, Math.max(0.56, ratio))
}

function getStreamCameraRatio(stream) {
  if (!stream || typeof stream.getVideoTracks !== "function") return 0
  const track = stream
    .getVideoTracks()
    .find((item) => item && item.readyState === "live")
  if (!track || typeof track.getSettings !== "function") return 0
  const settings = track.getSettings()
  const settingsRatio = normalizeCameraRatio(settings && settings.aspectRatio)
  if (settingsRatio > 0) return settingsRatio
  const width = Number(settings && settings.width)
  const height = Number(settings && settings.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0
  return normalizeCameraRatio(width / height)
}

function buildVideoOnlyStream(stream) {
  if (!stream || typeof MediaStream === "undefined" || typeof stream.getVideoTracks !== "function") {
    return stream
  }
  const videoTracks = stream.getVideoTracks().filter((track) => track && track.readyState === "live")
  if (videoTracks.length === 0) return stream
  return new MediaStream(videoTracks)
}

function buildStageMicIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  icon.setAttribute("viewBox", "0 0 24 24")
  icon.setAttribute("fill", "none")
  icon.setAttribute("aria-hidden", "true")

  const mic = document.createElementNS("http://www.w3.org/2000/svg", "path")
  mic.classList.add("voice-mic-body")
  mic.setAttribute("d", "M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3z")
  mic.setAttribute("fill", "currentColor")

  const stem = document.createElementNS("http://www.w3.org/2000/svg", "path")
  stem.classList.add("voice-mic-stem")
  stem.setAttribute("d", "M11 17.9V21h2v-3.1a7 7 0 0 0 4.9-2.7l-1.4-1.4A5 5 0 0 1 12 16a5 5 0 0 1-5-5H5a7 7 0 0 0 6 6.9z")
  stem.setAttribute("fill", "currentColor")

  const slash = document.createElementNS("http://www.w3.org/2000/svg", "path")
  slash.classList.add("voice-mic-slash")
  slash.setAttribute("d", "M4.6 4.6 19.4 19.4")
  slash.setAttribute("stroke", "currentColor")
  slash.setAttribute("stroke-width", "2.2")
  slash.setAttribute("stroke-linecap", "round")

  icon.appendChild(mic)
  icon.appendChild(stem)
  icon.appendChild(slash)
  return icon
}

function buildMediaBadge(isSelf, kind = "camera") {
  const badge = document.createElement("div")
  badge.className = "voice-camera-badge"
  if (kind === "screen") {
    badge.textContent = isSelf ? "YOU • SCREEN" : "SCREEN"
  } else {
    badge.textContent = isSelf ? "YOU • CAM" : "CAM"
  }
  return badge
}

function buildSortedParticipantSnapshot() {
  return Array.from(voiceState.participants.values()).sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1
    if (!a.isSelf && b.isSelf) return 1
    return String(a.username || "").localeCompare(String(b.username || ""))
  })
}

function getParticipantStream(participant) {
  const sourceId = participant && participant.sourceParticipantId ? participant.sourceParticipantId : participant && participant.id
  if (!sourceId) {
    return null
  }

  if (participant && participant.isScreenTile) {
    const screenStream = voiceState.mediaStreamsBySource.get(`${sourceId}::screen`)
    if (screenStream) return screenStream
    if (participant.isSelf && sourceId === voiceState.selfId) {
      return voiceState.localScreenStream
    }
  }

  if (participant && participant.isSelf && sourceId === voiceState.selfId) {
    if (participant.isCameraEnabled && voiceState.localCameraStream) {
      return voiceState.localCameraStream
    }
    return voiceState.localStream
  }

  const cameraStream = voiceState.mediaStreamsBySource.get(`${sourceId}::camera`)
  if (cameraStream) return cameraStream

  return voiceState.mediaStreams.get(sourceId)
}

function getParticipantSpeakingScore(participant) {
  if (!participant || !participant.id) return 0
  const participantId = participant.sourceParticipantId || participant.id
  const analyserEntry = voiceState.analysers.get(participantId)
  const visualLevel = Number(analyserEntry && analyserEntry.lastVisualLevel)
  if (Number.isFinite(visualLevel) && visualLevel > 0) {
    return Math.min(1, Math.max(0, visualLevel))
  }
  if (voiceState.speakingState.get(participantId)) {
    return 0.36
  }
  return 0
}

function resolveFocusParticipantId(participants) {
  if (!Array.isArray(participants) || participants.length === 0) {
    voiceState.stageFocusId = ""
    voiceState.stageFocusLockUntil = 0
    return ""
  }

  const now = Date.now()
  const byId = new Map(participants.map((participant) => [participant.id, participant]))
  const currentId = String(voiceState.stageFocusId || "")
  const currentParticipant = byId.get(currentId) || null
  const currentScore = currentParticipant ? getParticipantSpeakingScore(currentParticipant) : 0
  const currentLockUntil = Number(voiceState.stageFocusLockUntil || 0)

  if (currentParticipant && (currentScore >= 0.38 || now < currentLockUntil)) {
    return currentParticipant.id
  }

  const bestSpeaker = participants
    .map((participant) => ({ participant, score: getParticipantSpeakingScore(participant) }))
    .sort((a, b) => b.score - a.score)[0]

  if (bestSpeaker && bestSpeaker.score >= 0.24) {
    if (bestSpeaker.participant.id !== currentId) {
      voiceState.stageFocusLockUntil = now + STAGE_FOCUS_LOCK_MS
    }
    return bestSpeaker.participant.id
  }

  if (currentParticipant) {
    return currentParticipant.id
  }

  const withScreenShare = participants.find((participant) => {
    if (!participant || !participant.isScreenTile) return false
    return hasLiveVideoTrack(getParticipantStream(participant))
  })
  if (withScreenShare) {
    return withScreenShare.id
  }

  const withCamera = participants.find((participant) => {
    if (!participant || !participant.isCameraEnabled) return false
    return hasLiveVideoTrack(getParticipantStream(participant))
  })

  return (withCamera || participants[0]).id
}

function getStreamRenderToken(stream) {
  if (!stream) return ""
  const tracks = typeof stream.getTracks === "function" ? stream.getTracks() : []
  return tracks
    .map((track) =>
      [
        String(track && track.kind ? track.kind : ""),
        String(track && track.id ? track.id : ""),
        String(track && track.readyState ? track.readyState : ""),
        track && track.enabled === false ? "off" : "on"
      ].join(":")
    )
    .sort()
    .join("|")
}

function getStageTileRenderSignature(participant) {
  const stream = getParticipantStream(participant)
  const muted = participant.isSelf ? !voiceState.canSpeak || voiceState.isMuted : participant.isMuted
  const hasVideo = participant && participant.isScreenTile
    ? hasLiveVideoTrack(stream)
    : Boolean(participant.isCameraEnabled) && hasLiveVideoTrack(stream)
  return [
    participant.id,
    participant.sourceParticipantId || "",
    participant.username || "",
    participant.isSelf ? 1 : 0,
    participant.isScreenTile ? 1 : 0,
    muted ? 1 : 0,
    participant.isCameraEnabled ? 1 : 0,
    participant.isScreenSharing ? 1 : 0,
    hasVideo ? 1 : 0,
    getStreamRenderToken(stream)
  ].join("::")
}

function applyStageTileLiveState(tile, participant) {
  if (!tile || !participant) return
  const participantId = participant.sourceParticipantId || participant.id
  const isMuted = participant.isSelf ? !voiceState.canSpeak || voiceState.isMuted : participant.isMuted
  tile.classList.toggle("is-muted", Boolean(isMuted))
  tile.classList.toggle("is-speaking", Boolean(voiceState.speakingState.get(participantId)))

  const analyserEntry = voiceState.analysers.get(participantId)
  const visualLevel = Number(analyserEntry && analyserEntry.lastVisualLevel)
  if (Number.isFinite(visualLevel) && visualLevel > 0) {
    tile.style.setProperty("--voice-speaking-level", String(Math.min(1, Math.max(0, visualLevel))))
  } else {
    tile.style.setProperty("--voice-speaking-level", "0")
  }
  applyTileQualityBadge(tile, participant)
}

function getRosterSignature() {
  if (!voiceState.isVoiceChannel) return "off"
  if (voiceState.isConnecting) return "connecting"

  const sorted = buildSortedParticipantSnapshot()
  const summary = sorted
    .map((participant) => {
      const muted = participant.isSelf ? !voiceState.canSpeak || voiceState.isMuted : participant.isMuted
      return `${participant.id}:${participant.username}:${participant.isSelf ? 1 : 0}:${muted ? 1 : 0}`
    })
    .join("|")

  return [
    voiceState.channelName,
    voiceState.isJoined ? 1 : 0,
    voiceState.canSpeak ? 1 : 0,
    voiceState.isMuted ? 1 : 0,
    summary
  ].join("||")
}

function getStageSignature({
  tiles = null,
  isFocusLayout = false,
  isScreenExpanded = false,
  focusParticipantId = "",
  isFocusShifting = false
} = {}) {
  const stageTiles = Array.isArray(tiles) ? tiles : getSortedStageParticipants()
  const tileSummary = stageTiles
    .map((participant) => {
      const stream = getParticipantStream(participant)
      const muted = participant.isSelf ? !voiceState.canSpeak || voiceState.isMuted : participant.isMuted
      const hasCameraVideo = Boolean(participant.isCameraEnabled) && hasLiveVideoTrack(stream)
      return [
        participant.id,
        participant.sourceParticipantId || "",
        participant.isScreenTile ? 1 : 0,
        participant.username,
        participant.isSelf ? 1 : 0,
        muted ? 1 : 0,
        participant.isCameraEnabled ? 1 : 0,
        participant.isScreenSharing ? 1 : 0,
        hasCameraVideo ? 1 : 0,
        voiceState.speakingState.get(participant.id) ? 1 : 0,
        getStreamRenderToken(stream)
      ].join(":")
    })
    .join("|")

  return [
    voiceState.isVoiceChannel ? 1 : 0,
    voiceState.channelName,
    voiceState.isConnected ? 1 : 0,
    voiceState.isReady ? 1 : 0,
    voiceState.isJoined ? 1 : 0,
    voiceState.isConnecting ? 1 : 0,
    voiceState.stageLayoutMode,
    isFocusLayout ? 1 : 0,
    isScreenExpanded ? 1 : 0,
    focusParticipantId,
    voiceState.expandedScreenShareId || "",
    isFocusShifting ? 1 : 0,
    tileSummary
  ].join("||")
}

function updateRosterUi(options = {}) {
  if (!voiceRoster) return
  const force = Boolean(options && options.force)
  const signature = getRosterSignature()
  if (!force && signature === lastRosterSignature) return
  lastRosterSignature = signature

  if (!voiceState.isVoiceChannel) {
    voiceRoster.textContent = "Tidak ada peserta"
    return
  }

  if (voiceState.isConnecting) {
    voiceRoster.textContent = "Menghubungkan..."
    return
  }

  const entries = buildSortedParticipantSnapshot()
  if (entries.length === 0) {
    voiceRoster.textContent = voiceState.isJoined ? "Tidak ada peserta" : "Belum ada yang join"
    return
  }

  voiceRoster.innerHTML = ""
  entries.forEach((participant) => {
    const row = document.createElement("div")
    const nameEl = document.createElement(participant.isSelf ? "strong" : "span")
    const safeName = participant.username || "Unknown"
    nameEl.textContent = safeName
    row.appendChild(nameEl)

    if (participant.isSelf) {
      let suffix = " (you)"
      if (!voiceState.canSpeak) {
        suffix = " (listener)"
      } else if (voiceState.isMuted) {
        suffix = " (muted)"
      }
      row.appendChild(document.createTextNode(suffix))
    } else if (participant.isMuted) {
      row.appendChild(document.createTextNode(" (muted)"))
    }

    voiceRoster.appendChild(row)
  })
}

function createStageTile(participant) {
  const tile = document.createElement("div")
  tile.className = "voice-tile"
  tile.dataset.peerId = participant.id
  if (participant && participant.isScreenTile) {
    tile.classList.add("is-screen")
    tile.style.setProperty("--voice-tile-ratio", "1.6")
  }

  if (participant.isSelf) {
    tile.classList.add("is-self")
    if (!voiceState.canSpeak || voiceState.isMuted) {
      tile.classList.add("is-muted")
    }
  } else if (participant.isMuted) {
    tile.classList.add("is-muted")
  }

  const participantStream = getParticipantStream(participant)
  const hasVideo = participant && participant.isScreenTile
    ? hasLiveVideoTrack(participantStream)
    : Boolean(participant.isCameraEnabled) && hasLiveVideoTrack(participantStream)
  const isExpandedScreen = Boolean(participant && participant.isScreenTile && voiceState.expandedScreenShareId === participant.id)

  if (hasVideo) {
    const applyTileVideoRatio = (ratioValue) => {
      const ratio = normalizeCameraRatio(ratioValue)
      if (!ratio) return
      tile.style.setProperty("--voice-tile-ratio", String(ratio))
    }

    applyTileVideoRatio(getStreamCameraRatio(participantStream))
    tile.classList.add("has-video")
    const video = document.createElement("video")
    video.className = "voice-tile-video"
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    video.defaultMuted = true
    video.volume = 0
    video.setAttribute("muted", "")
    video.srcObject = buildVideoOnlyStream(participantStream)
    const syncRatioFromMetadata = () => {
      const width = Number(video.videoWidth)
      const height = Number(video.videoHeight)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
      applyTileVideoRatio(width / height)
    }
    video.addEventListener("loadedmetadata", syncRatioFromMetadata)
    video.addEventListener("resize", syncRatioFromMetadata)
    const playPromise = video.play()
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {})
    }
    tile.appendChild(video)
    tile.appendChild(buildMediaBadge(Boolean(participant.isSelf), participant.isScreenTile ? "screen" : "camera"))
    if (participant && participant.isScreenTile) {
      tile.classList.add("is-expandable")
      tile.tabIndex = 0
      tile.setAttribute("role", "button")
      tile.setAttribute(
        "aria-label",
        isExpandedScreen ? "Kecilkan share screen" : `Perbesar share screen ${participant.username || ""}`.trim()
      )
      tile.title = isExpandedScreen ? "Klik untuk kecilkan share screen" : "Klik untuk perbesar share screen"
      tile.addEventListener("click", () => {
        setExpandedScreenShareId(isExpandedScreen ? "" : participant.id)
      })
      tile.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        setExpandedScreenShareId(isExpandedScreen ? "" : participant.id)
      })

      const expandHint = document.createElement("div")
      expandHint.className = "voice-screen-expand-hint"
      expandHint.textContent = isExpandedScreen ? "Click to minimize" : "Click to enlarge"
      tile.appendChild(expandHint)

      if (isExpandedScreen) {
        const closeButton = document.createElement("button")
        closeButton.type = "button"
        closeButton.className = "voice-screen-close"
        closeButton.setAttribute("aria-label", "Kecilkan share screen")
        closeButton.textContent = "Close"
        closeButton.addEventListener("click", (event) => {
          event.stopPropagation()
          setExpandedScreenShareId("")
        })
        tile.appendChild(closeButton)
      }
    }
  } else {
    const avatar = document.createElement("div")
    avatar.className = "voice-avatar"
    avatar.textContent = getInitials(participant.username)
    avatar.style.background = getAvatarGradient(participant.username)
    tile.appendChild(avatar)
  }

  const qualityBadge = document.createElement("div")
  qualityBadge.className = "voice-quality-badge is-idle"
  tile.appendChild(qualityBadge)
  applyTileQualityBadge(tile, participant)

  const name = document.createElement("div")
  name.className = "voice-name"
  name.textContent = participant.username || "Unknown"

  const mic = document.createElement("div")
  mic.className = "voice-mic"
  mic.appendChild(buildStageMicIcon())

  tile.appendChild(name)
  tile.appendChild(mic)
  voiceState.tileEls.set(participant.id, tile)

  const participantId = participant.sourceParticipantId || participant.id
  if (voiceState.speakingState.get(participantId)) {
    tile.classList.add("is-speaking")
  }
  const analyserEntry = voiceState.analysers.get(participantId)
  const visualLevel = Number(analyserEntry && analyserEntry.lastVisualLevel)
  if (Number.isFinite(visualLevel) && visualLevel > 0) {
    tile.style.setProperty("--voice-speaking-level", String(Math.min(1, Math.max(0, visualLevel))))
  } else {
    tile.style.setProperty("--voice-speaking-level", "0")
  }

  return tile
}

function getSortedStageParticipants() {
  const baseParticipants = Array.from(voiceState.participants.values()).sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1
    if (!a.isSelf && b.isSelf) return 1
    return String(a.username || "").localeCompare(String(b.username || ""))
  })

  const expanded = []
  baseParticipants.forEach((participant) => {
    const participantStream = getParticipantStream(participant)
    const shouldRenderScreenTile =
      Boolean(participant.isScreenSharing) ||
      (Boolean(participant && !participant.isCameraEnabled) && hasLiveVideoTrack(participantStream))

    expanded.push({
      ...participant,
      sourceParticipantId: participant.id,
      isScreenTile: false
    })
    if (shouldRenderScreenTile) {
      expanded.push({
        ...participant,
        id: `${participant.id}::screen`,
        sourceParticipantId: participant.id,
        isScreenTile: true
      })
    }
  })
  return expanded
}

function getAdaptiveStageLayout(count) {
  const safeCount = Math.max(1, Number(count) || 1)

  let desktopColumns = 1
  let desktopRatioTarget = 1.38
  let desktopMaxWidth = "1040px"
  let desktopHeightTarget = "80vh"
  if (safeCount === 1) {
    desktopColumns = 1
    desktopRatioTarget = 1.38
    desktopMaxWidth = "1040px"
    desktopHeightTarget = "82vh"
  } else if (safeCount === 2) {
    desktopColumns = 2
    desktopRatioTarget = 1.34
    desktopMaxWidth = "1160px"
    desktopHeightTarget = "82vh"
  } else if (safeCount === 3) {
    desktopColumns = 2
    desktopRatioTarget = 1.32
    desktopMaxWidth = "1120px"
    desktopHeightTarget = "82vh"
  } else if (safeCount <= 6) {
    desktopColumns = 3
    desktopRatioTarget = 1.24
    desktopMaxWidth = "1500px"
    desktopHeightTarget = "78vh"
  } else if (safeCount <= 9) {
    desktopColumns = 3
    desktopRatioTarget = 1.16
    desktopMaxWidth = "1560px"
    desktopHeightTarget = "74vh"
  } else {
    desktopColumns = 3
    desktopRatioTarget = 1.08
    desktopMaxWidth = "1620px"
    desktopHeightTarget = "72vh"
  }

  let mobileColumns = 1
  let mobileRatioTarget = 1.16
  let mobileHeightTarget = "62vh"
  if (safeCount <= 2) {
    mobileColumns = 1
    mobileRatioTarget = 1.1
    mobileHeightTarget = "66vh"
  } else if (safeCount === 3) {
    mobileColumns = 2
    mobileRatioTarget = 0.98
    mobileHeightTarget = "64vh"
  } else if (safeCount <= 6) {
    mobileColumns = 2
    mobileRatioTarget = 0.94
    mobileHeightTarget = "62vh"
  } else if (safeCount <= 9) {
    mobileColumns = 2
    mobileRatioTarget = 0.88
    mobileHeightTarget = "60vh"
  } else {
    mobileColumns = 2
    mobileRatioTarget = 0.82
    mobileHeightTarget = "58vh"
  }

  const desktopRows = Math.ceil(safeCount / desktopColumns)
  const mobileRows = Math.ceil(safeCount / mobileColumns)

  let desktopMinTileHeight = 170
  let mobileMinTileHeight = 132
  let focusFeaturedMinHeight = 200
  let focusSecondaryMinHeight = 112
  let focusFeaturedMinHeightMobile = 186
  let focusSecondaryMinHeightMobile = 102
  if (safeCount <= 2) {
    desktopMinTileHeight = 212
    mobileMinTileHeight = 160
    focusFeaturedMinHeight = 236
    focusSecondaryMinHeight = 136
    focusFeaturedMinHeightMobile = 206
    focusSecondaryMinHeightMobile = 118
  } else if (safeCount <= 4) {
    desktopMinTileHeight = 182
    mobileMinTileHeight = 142
    focusFeaturedMinHeight = 214
    focusSecondaryMinHeight = 124
    focusFeaturedMinHeightMobile = 194
    focusSecondaryMinHeightMobile = 110
  } else if (safeCount <= 6) {
    desktopMinTileHeight = 158
    mobileMinTileHeight = 126
    focusFeaturedMinHeight = 198
    focusSecondaryMinHeight = 112
    focusFeaturedMinHeightMobile = 182
    focusSecondaryMinHeightMobile = 102
  } else {
    desktopMinTileHeight = 142
    mobileMinTileHeight = 112
    focusFeaturedMinHeight = 184
    focusSecondaryMinHeight = 100
    focusFeaturedMinHeightMobile = 168
    focusSecondaryMinHeightMobile = 96
  }

  let desktopWidthTarget = "90%"
  if (safeCount === 1) {
    desktopWidthTarget = "74%"
  } else if (safeCount === 2) {
    desktopWidthTarget = "90%"
  } else if (safeCount === 3) {
    desktopWidthTarget = "84%"
  } else if (safeCount <= 6) {
    desktopWidthTarget = "92%"
  } else if (safeCount <= 9) {
    desktopWidthTarget = "90%"
  }

  return {
    desktopColumns,
    desktopRows,
    desktopMaxWidth,
    desktopWidthTarget,
    desktopRatioTarget: String(desktopRatioTarget),
    desktopHeightTarget,
    desktopMinTileHeight: String(desktopMinTileHeight),
    focusFeaturedMinHeight: String(focusFeaturedMinHeight),
    focusSecondaryMinHeight: String(focusSecondaryMinHeight),
    mobileColumns,
    mobileRows,
    mobileRatioTarget: String(mobileRatioTarget),
    mobileHeightTarget,
    mobileMinTileHeight: String(mobileMinTileHeight),
    focusFeaturedMinHeightMobile: String(focusFeaturedMinHeightMobile),
    focusSecondaryMinHeightMobile: String(focusSecondaryMinHeightMobile),
    mobileMaxWidth: "100%",
    mobileWidthTarget: "100%"
  }
}

function updateVoiceStageUi(options = {}) {
  if (!voiceStage) return
  hydrateStageLayoutMode()
  const force = Boolean(options && options.force)

  const tiles = getSortedStageParticipants()
  const expandedScreenTile = tiles.find((participant) =>
    participant &&
    participant.isScreenTile &&
    participant.id === voiceState.expandedScreenShareId &&
    hasLiveVideoTrack(getParticipantStream(participant))
  )
  if (voiceState.expandedScreenShareId && !expandedScreenTile) {
    voiceState.expandedScreenShareId = ""
  }
  const isScreenExpanded = Boolean(expandedScreenTile)
  const isFocusLayout = !isScreenExpanded && voiceState.stageLayoutMode === STAGE_LAYOUT_FOCUS && tiles.length > 1
  const nextFocusParticipantId = isFocusLayout ? resolveFocusParticipantId(tiles) : ""
  const previousFocusId = String(voiceState.stageFocusId || "")

  if (voiceState.stageFocusId !== nextFocusParticipantId) {
    voiceState.stageFocusId = nextFocusParticipantId
    if (isFocusLayout && nextFocusParticipantId && previousFocusId && previousFocusId !== nextFocusParticipantId) {
      focusShiftUntil = Date.now() + STAGE_FOCUS_SHIFT_MS
      scheduleFocusShiftUpdate()
    }
    if (!nextFocusParticipantId) {
      voiceState.stageFocusLockUntil = 0
      focusShiftUntil = 0
    }
  }

  const isFocusShifting = isFocusLayout && Date.now() < focusShiftUntil

  const signature = getStageSignature({
    tiles,
    isFocusLayout,
    isScreenExpanded,
    focusParticipantId: voiceState.stageFocusId,
    isFocusShifting
  })
  if (!force && signature === lastStageSignature) return
  lastStageSignature = signature

  setElementHidden(voiceStage, !voiceState.isVoiceChannel)
  if (!voiceState.isVoiceChannel) {
    if (chatRoot) {
      chatRoot.classList.remove("is-screen-expanded")
    }
    return
  }

  if (voiceStageTitle) {
    voiceStageTitle.textContent = voiceState.channelName || "voice"
  }

  voiceStage.classList.toggle("is-populated", tiles.length > 0)
  voiceStage.classList.toggle("is-empty", tiles.length === 0)
  voiceStage.classList.toggle("is-joined", voiceState.isJoined)
  if (chatRoot) {
    chatRoot.classList.toggle("is-screen-expanded", isScreenExpanded)
  }

  if (voiceStageSubtitle) {
    const count = getParticipantCount()
    if (count === 0) {
      voiceStageSubtitle.textContent = "Belum ada yang join voice"
    } else if (count === 1) {
      const only = Array.from(voiceState.participants.values())[0]
      voiceStageSubtitle.textContent =
        only && only.isSelf ? "Kamu sedang di voice" : `${only.username || "Seseorang"} sedang di voice`
    } else {
      const names = Array.from(voiceState.participants.values())
        .filter((item) => !item.isSelf)
        .map((item) => item.username)
        .slice(0, 2)
        .filter(Boolean)
      const extra = count - 1 - names.length
      if (names.length > 0) {
        voiceStageSubtitle.textContent = `${names.join(", ")}${
          extra > 0 ? `, dan ${extra} lainnya` : ""
        } sedang di voice`
      } else {
        voiceStageSubtitle.textContent = `${count} orang sedang di voice`
      }
    }
  }

  if (voiceJoinHeroBtn) {
    voiceJoinHeroBtn.disabled =
      !voiceState.isConnected ||
      !voiceState.isReady ||
      !voiceState.isVoiceChannel ||
      voiceState.isJoined ||
      voiceState.isConnecting
    voiceJoinHeroBtn.textContent = voiceState.isJoined ? "Joined" : "Join Voice"
    setElementHidden(voiceJoinHeroBtn, voiceState.isJoined || voiceState.isConnecting)
  }

  if (voiceStageGrid) {
    const previousTileEls = new Map(voiceState.tileEls)
    const nextTileEls = new Map()
    const layout = getAdaptiveStageLayout(tiles.length)
    const focusSpan = 2
    const renderedTiles = isScreenExpanded
      ? [
          ...tiles.filter((participant) => participant.id === voiceState.expandedScreenShareId),
          ...tiles.filter((participant) => participant.id !== voiceState.expandedScreenShareId)
        ]
      : isFocusLayout
      ? [
          ...tiles.filter((participant) => participant.id === voiceState.stageFocusId),
          ...tiles.filter((participant) => participant.id !== voiceState.stageFocusId)
        ]
      : tiles

    voiceStageGrid.classList.toggle("is-single", tiles.length === 1)
    voiceStageGrid.classList.toggle("is-multi", tiles.length > 1)
    voiceStageGrid.classList.toggle("is-focus", isFocusLayout)
    voiceStageGrid.classList.toggle("is-screen-expanded", isScreenExpanded)
    voiceStageGrid.classList.toggle("is-shifting", isFocusShifting)
    voiceStageGrid.dataset.tileCount = String(tiles.length)
    voiceStageGrid.style.setProperty("--voice-stage-grid-columns", String(layout.desktopColumns))
    voiceStageGrid.style.setProperty("--voice-stage-grid-rows", String(layout.desktopRows))
    voiceStageGrid.style.setProperty("--voice-stage-grid-max-width", layout.desktopMaxWidth)
    voiceStageGrid.style.setProperty("--voice-stage-grid-width-target", layout.desktopWidthTarget)
    voiceStageGrid.style.setProperty("--voice-stage-tile-ratio-target", layout.desktopRatioTarget)
    voiceStageGrid.style.setProperty("--voice-stage-grid-height-target", layout.desktopHeightTarget)
    voiceStageGrid.style.setProperty("--voice-stage-tile-min-height", `${layout.desktopMinTileHeight}px`)
    voiceStageGrid.style.setProperty("--voice-stage-focus-featured-min-height", `${layout.focusFeaturedMinHeight}px`)
    voiceStageGrid.style.setProperty("--voice-stage-focus-secondary-min-height", `${layout.focusSecondaryMinHeight}px`)
    voiceStageGrid.style.setProperty("--voice-stage-grid-columns-mobile", String(layout.mobileColumns))
    voiceStageGrid.style.setProperty("--voice-stage-grid-rows-mobile", String(layout.mobileRows))
    voiceStageGrid.style.setProperty("--voice-stage-tile-ratio-target-mobile", layout.mobileRatioTarget)
    voiceStageGrid.style.setProperty("--voice-stage-grid-height-target-mobile", layout.mobileHeightTarget)
    voiceStageGrid.style.setProperty("--voice-stage-tile-min-height-mobile", `${layout.mobileMinTileHeight}px`)
    voiceStageGrid.style.setProperty(
      "--voice-stage-focus-featured-min-height-mobile",
      `${layout.focusFeaturedMinHeightMobile}px`
    )
    voiceStageGrid.style.setProperty(
      "--voice-stage-focus-secondary-min-height-mobile",
      `${layout.focusSecondaryMinHeightMobile}px`
    )
    voiceStageGrid.style.setProperty("--voice-stage-grid-max-width-mobile", layout.mobileMaxWidth)
    voiceStageGrid.style.setProperty("--voice-stage-grid-width-target-mobile", layout.mobileWidthTarget)
    voiceStageGrid.style.setProperty("--voice-focus-span", String(focusSpan))
    setElementHidden(voiceStageGrid, tiles.length === 0)

    renderedTiles.forEach((participant) => {
      const renderSignature = getStageTileRenderSignature(participant)
      let tile = previousTileEls.get(participant.id)
      if (!tile || tile.dataset.renderSignature !== renderSignature) {
        if (tile) {
          tile.remove()
        }
        tile = createStageTile(participant)
        tile.dataset.renderSignature = renderSignature
      } else {
        applyStageTileLiveState(tile, participant)
      }
      if (isScreenExpanded) {
        tile.classList.toggle("is-featured", participant.id === voiceState.expandedScreenShareId)
        tile.classList.toggle("is-secondary", participant.id !== voiceState.expandedScreenShareId)
      } else if (isFocusLayout) {
        tile.classList.toggle("is-featured", participant.id === voiceState.stageFocusId)
        tile.classList.toggle("is-secondary", participant.id !== voiceState.stageFocusId)
      }
      voiceStageGrid.appendChild(tile)
      nextTileEls.set(participant.id, tile)
    })

    Array.from(voiceStageGrid.children).forEach((child) => {
      const peerId = child && child.dataset ? child.dataset.peerId : ""
      if (!peerId || nextTileEls.get(peerId) !== child) {
        child.remove()
      }
    })
    voiceState.tileEls = nextTileEls
  }
}

function renderVoiceUi() {
  if (!voicePanel || !voiceStatus || !voiceJoinBtn || !voiceLeaveBtn || !voiceMuteBtn) return
  hydrateStageLayoutMode()
  const participantCount = getParticipantCount()
  const showVoicePanel =
    voiceState.isVoiceChannel &&
    (voiceState.isJoined || voiceState.isConnecting || participantCount > 0)

  setElementHidden(voicePanel, !showVoicePanel)
  if (!voiceState.isVoiceChannel) {
    if (voiceLayoutBtn) {
      voiceLayoutBtn.disabled = true
      voiceLayoutBtn.classList.remove("is-active")
      setControlLabel(voiceLayoutBtn, "Grid")
    }
    updateRosterUi()
    updateVoiceStageUi()
    updateVoiceChannelListUi()
    return
  }

  let statusText = "Not connected"
  if (!voiceState.isConnected) {
    statusText = "Disconnected"
  } else if (voiceState.isConnecting) {
    statusText = "Connecting..."
  } else if (voiceState.isJoined) {
    statusText =
      participantCount > 0
        ? `Connected • ${participantCount} in room`
        : "Connected"
  }

  if (voiceState.isJoined && !voiceState.canSpeak) {
    statusText = `${statusText} • Listener`
  } else if (voiceState.isJoined && voiceState.isMuted) {
    statusText = `${statusText} • Muted`
  }
  if (voiceState.isJoined && voiceState.pushToTalkEnabled) {
    statusText = `${statusText} • Push-to-talk`
  }

  voiceStatus.textContent = statusText

  voiceJoinBtn.disabled =
    !voiceState.isConnected ||
    !voiceState.isReady ||
    !voiceState.isVoiceChannel ||
    voiceState.isJoined ||
    voiceState.isConnecting
  voiceLeaveBtn.disabled = !voiceState.isJoined && !voiceState.isConnecting

  const hasLocalTrack =
    voiceState.localStream && voiceState.localStream.getAudioTracks().length > 0
  const canMute = !voiceState.isJoined || !voiceState.canSpeak || !hasLocalTrack
  voiceMuteBtn.disabled = canMute || voiceState.pushToTalkEnabled
  voiceMuteBtn.classList.toggle("is-muted", voiceState.isMuted)
  voiceMuteBtn.classList.toggle("is-active", voiceState.isJoined && !voiceState.isMuted)
  if (voiceState.pushToTalkEnabled) {
    setControlLabel(voiceMuteBtn, "PTT")
  } else {
    setControlLabel(voiceMuteBtn, voiceState.isMuted ? "Unmute" : "Mute")
  }
  setControlLabel(voiceJoinBtn, voiceState.isJoined ? "Joined" : "Join")

  if (voiceCameraBtn) {
    voiceCameraBtn.disabled = !voiceState.isJoined || voiceState.isCameraBusy
    voiceCameraBtn.classList.toggle("is-active", voiceState.isCameraEnabled)
    voiceCameraBtn.classList.toggle("is-muted", !voiceState.isCameraEnabled && !voiceState.isCameraBusy)
    voiceCameraBtn.classList.toggle("is-busy", voiceState.isCameraBusy)
    setControlLabel(
      voiceCameraBtn,
      voiceState.isCameraBusy ? "Starting" : voiceState.isCameraEnabled ? "Cam On" : "Camera"
    )
  }

  if (voiceScreenBtn) {
    voiceScreenBtn.disabled = !voiceState.isJoined || voiceState.isScreenShareBusy
    voiceScreenBtn.classList.toggle("is-active", voiceState.isScreenSharing)
    voiceScreenBtn.classList.toggle("is-muted", !voiceState.isScreenSharing && !voiceState.isScreenShareBusy)
    voiceScreenBtn.classList.toggle("is-busy", voiceState.isScreenShareBusy)
    setControlLabel(
      voiceScreenBtn,
      voiceState.isScreenShareBusy ? "Sharing" : voiceState.isScreenSharing ? "Stop Share" : "Share"
    )
  }

  if (voiceCameraFlipBtn) {
    const canFlip = Boolean(voiceState.canFlipCamera)
    voiceCameraFlipBtn.disabled = !voiceState.isJoined || voiceState.isCameraBusy || !canFlip
    voiceCameraFlipBtn.classList.toggle("is-active", voiceState.cameraFacingMode === "environment")
    voiceCameraFlipBtn.classList.toggle("is-muted", !canFlip)
    setControlLabel(voiceCameraFlipBtn, voiceState.cameraFacingMode === "environment" ? "Back" : "Front")
  }

  if (voiceLayoutBtn) {
    const canUseFocus = participantCount > 1
    const isFocusLayout = voiceState.stageLayoutMode === STAGE_LAYOUT_FOCUS
    voiceLayoutBtn.disabled = !canUseFocus
    voiceLayoutBtn.classList.toggle("is-active", isFocusLayout && canUseFocus)
    voiceLayoutBtn.classList.toggle("is-muted", !canUseFocus)
    setControlLabel(voiceLayoutBtn, isFocusLayout ? "Focus" : "Grid")
  }

  if (voiceQuality) {
    voiceQuality.textContent = formatQualityText()
  }
  updateNetworkPill()
  updateVoiceSettingsUi()

  updateSelfTileState()
  updateRosterUi()
  updateVoiceStageUi()
  getSortedStageParticipants().forEach((participant) => {
    const tile = voiceState.tileEls.get(participant.id)
    if (!tile) return
    applyTileQualityBadge(tile, participant)
  })
  updateVoiceChannelListUi()
}

function updateVoiceUi(options = {}) {
  const immediate = Boolean(options && options.immediate)
  if (immediate) {
    if (voiceUiRenderToken) {
      cancelAnimationFrame(voiceUiRenderToken)
      voiceUiRenderToken = 0
    }
    renderVoiceUi()
    return
  }

  if (voiceUiRenderToken) return
  voiceUiRenderToken = requestAnimationFrame(() => {
    voiceUiRenderToken = 0
    renderVoiceUi()
  })
}

export {
  updateVoiceUi,
  updateRosterUi,
  updateVoiceStageUi,
  getParticipantCount,
  setVoiceStageLayoutMode,
  toggleVoiceStageLayoutMode
}




