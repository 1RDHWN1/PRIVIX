import { emitWithTimeout } from "../api.js"
import { socket } from "../socket.js"
import { voiceAudio } from "../dom.js"
import { voiceState } from "./state.js"
import { VOICE_RUNTIME_CONFIG } from "./config.js"
import { attachAnalyser, attemptPlayAudio, removeAnalyser } from "./audio.js"
import { setParticipantCameraEnabled, setParticipantScreenSharing } from "./participants.js"
import { updateVoiceUi } from "./ui.js"
import { voiceDebug, describeTrack } from "./debug.js"

const DEFAULT_LIVEKIT_CLIENT_URL =
  "https://cdn.jsdelivr.net/npm/livekit-client@2.15.5/dist/livekit-client.esm.mjs"

function normalizeSfuSource(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase()
  if (value === "screen" || value === "screenshare" || value === "screen_share") return "screen"
  if (value === "camera" || value === "cam") return "camera"
  if (value === "audio" || value === "microphone" || value === "mic") return "audio"
  return "unknown"
}

function sourceStreamKey(participantId, source) {
  return `${String(participantId || "")}::${String(source || "unknown")}`
}

function ensureCompositeRemoteStream(participantId) {
  const key = String(participantId || "")
  if (!key) return null
  let stream = voiceState.mediaStreams.get(key)
  if (!stream && typeof MediaStream !== "undefined") {
    stream = new MediaStream()
    voiceState.mediaStreams.set(key, stream)
  }
  return stream || null
}

function removeTrackFromStream(stream, mediaTrack) {
  if (!stream || !mediaTrack || typeof stream.getTracks !== "function") return
  stream.getTracks().forEach((track) => {
    if (track && track.id === mediaTrack.id) {
      try {
        stream.removeTrack(track)
      } catch {}
    }
  })
}

function getLivekitSourceFromPublication(sdk, publication) {
  const source = publication && publication.source
  if (!source) return "unknown"
  if (sdk && sdk.Track && sdk.Track.Source) {
    if (source === sdk.Track.Source.ScreenShare) return "screen"
    if (source === sdk.Track.Source.Camera) return "camera"
    if (source === sdk.Track.Source.Microphone) return "audio"
  }
  return normalizeSfuSource(source)
}

function applyAudioOutput(audioEl) {
  if (!audioEl) return
  const volume = Number(voiceState.outputVolume || 0.8)
  audioEl.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8
  if (voiceState.outputDeviceId && audioEl.setSinkId) {
    audioEl.setSinkId(voiceState.outputDeviceId).catch(() => {})
  }
}

function normalizeConnectionQualityLevel(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase()
  if (!value) return "Unknown"
  if (value.includes("excellent") || value === "good" || value === "5" || value === "4") return "Good"
  if (value.includes("poor") || value.includes("lost") || value === "1") return "Poor"
  if (value.includes("medium") || value.includes("fair") || value === "3" || value === "2") return "Fair"
  return "Unknown"
}

function applySfuConnectionQuality(rawQuality, participant) {
  const participantId = String(participant && participant.identity ? participant.identity : socket.id || "")
  if (!participantId) return
  const level = normalizeConnectionQualityLevel(rawQuality)
  const entry = {
    peerId: participantId,
    level,
    rttMs: 0,
    jitterMs: 0,
    lossPct: 0,
    source: "sfu",
    updatedAt: Date.now()
  }
  voiceState.peerStats.set(participantId, entry)
  if (participantId === String(socket.id || voiceState.selfId || "")) {
    voiceState.qualitySummary = {
      level,
      rttMs: 0,
      jitterMs: 0,
      lossPct: 0,
      updatedAt: entry.updatedAt
    }
  }
  updateVoiceUi()
}

function ensureRemoteAudioElement(participantId, stream) {
  if (!voiceAudio || !stream) return null
  let audioEl = voiceState.audioEls.get(participantId)
  if (!audioEl) {
    audioEl = document.createElement("audio")
    audioEl.autoplay = true
    audioEl.playsInline = true
    audioEl.muted = false
    voiceState.audioEls.set(participantId, audioEl)
    voiceAudio.appendChild(audioEl)
  }
  if (audioEl.srcObject !== stream) {
    audioEl.srcObject = stream
  }
  if (audioEl.parentElement !== voiceAudio) {
    voiceAudio.appendChild(audioEl)
  }
  applyAudioOutput(audioEl)
  attemptPlayAudio(audioEl)
  return audioEl
}

function detachRemoteAudioElement(participantId) {
  const audioEl = voiceState.audioEls.get(participantId)
  if (!audioEl) return
  audioEl.srcObject = null
  audioEl.remove()
  voiceState.audioEls.delete(participantId)
}

function hasSourceStream(participantId, source) {
  return voiceState.mediaStreamsBySource.has(sourceStreamKey(participantId, source))
}

function refreshParticipantVideoFlags(participantId) {
  const hasCamera = hasSourceStream(participantId, "camera")
  const hasScreen = hasSourceStream(participantId, "screen")
  setParticipantCameraEnabled(participantId, hasCamera)
  setParticipantScreenSharing(participantId, hasScreen)
}

function clearRemoteParticipantMedia(participantId) {
  const keys = Array.from(voiceState.mediaStreamsBySource.keys())
  keys.forEach((key) => {
    if (!key.startsWith(`${participantId}::`)) return
    voiceState.mediaStreamsBySource.delete(key)
  })
  const composite = voiceState.mediaStreams.get(participantId)
  if (composite) {
    if (typeof composite.getTracks === "function") {
      composite.getTracks().forEach((track) => {
        try {
          composite.removeTrack(track)
        } catch {}
      })
    }
    voiceState.mediaStreams.delete(participantId)
  }
  removeAnalyser(participantId)
  detachRemoteAudioElement(participantId)
  refreshParticipantVideoFlags(participantId)
}

function clearAllRemoteSfuMedia() {
  const selfId = String(voiceState.selfId || socket.id || "")
  Array.from(voiceState.mediaStreams.keys()).forEach((participantId) => {
    if (participantId === selfId) return
    clearRemoteParticipantMedia(participantId)
  })
  Array.from(voiceState.mediaStreamsBySource.keys()).forEach((key) => {
    if (selfId && key.startsWith(`${selfId}::`)) return
    voiceState.mediaStreamsBySource.delete(key)
  })
  Array.from(voiceState.sfuTrackBindings.keys()).forEach((bindingKey) => {
    const binding = voiceState.sfuTrackBindings.get(bindingKey)
    if (!binding || binding.participantId === selfId) return
    voiceState.sfuTrackBindings.delete(bindingKey)
  })
}

function bindRemoteTrack(sdk, track, publication, participant) {
  const participantId = String(participant && participant.identity ? participant.identity : "")
  if (!participantId || participantId === socket.id) return

  const mediaTrack = track && track.mediaStreamTrack ? track.mediaStreamTrack : null
  if (!mediaTrack) return

  const source = getLivekitSourceFromPublication(sdk, publication)
  const trackSid = String((publication && publication.trackSid) || mediaTrack.id || "")
  const bindingKey = `${participantId}:${trackSid}`
  voiceState.sfuTrackBindings.set(bindingKey, {
    participantId,
    source,
    trackSid,
    kind: mediaTrack.kind,
    trackId: mediaTrack.id
  })

  if (mediaTrack.kind === "audio") {
    const stream = ensureCompositeRemoteStream(participantId)
    if (stream && typeof stream.getTracks === "function") {
      const exists = stream.getTracks().some((item) => item && item.id === mediaTrack.id)
      if (!exists && typeof stream.addTrack === "function") {
        try {
          stream.addTrack(mediaTrack)
        } catch {}
      }
      attachAnalyser(participantId, stream)
      ensureRemoteAudioElement(participantId, stream)
    }
    voiceDebug("sfu remote audio bound", {
      participantId,
      track: describeTrack(mediaTrack)
    })
    updateVoiceUi()
    return
  }

  if (mediaTrack.kind === "video") {
    if (typeof MediaStream !== "undefined") {
      const stream = new MediaStream([mediaTrack])
      voiceState.mediaStreamsBySource.set(sourceStreamKey(participantId, source), stream)
      if (!voiceState.mediaStreams.has(participantId)) {
        voiceState.mediaStreams.set(participantId, stream)
      }
      refreshParticipantVideoFlags(participantId)
      voiceDebug("sfu remote video bound", {
        participantId,
        source,
        track: describeTrack(mediaTrack)
      })
      updateVoiceUi()
    }
  }
}

function unbindRemoteTrack(participant, publication) {
  const participantId = String(participant && participant.identity ? participant.identity : "")
  if (!participantId || participantId === socket.id) return

  const trackSid = String((publication && publication.trackSid) || "")
  if (!trackSid) return
  const bindingKey = `${participantId}:${trackSid}`
  const binding = voiceState.sfuTrackBindings.get(bindingKey)
  if (!binding) return
  voiceState.sfuTrackBindings.delete(bindingKey)

  if (binding.kind === "audio") {
    const composite = voiceState.mediaStreams.get(participantId)
    if (composite && typeof composite.getTracks === "function") {
      const target = composite.getTracks().find((track) => track && track.id === binding.trackId)
      if (target) {
        removeTrackFromStream(composite, target)
      }
      if (composite.getTracks().length === 0) {
        voiceState.mediaStreams.delete(participantId)
        removeAnalyser(participantId)
        detachRemoteAudioElement(participantId)
      } else {
        ensureRemoteAudioElement(participantId, composite)
      }
    }
    updateVoiceUi()
    return
  }

  if (binding.kind === "video") {
    voiceState.mediaStreamsBySource.delete(sourceStreamKey(participantId, binding.source))
    refreshParticipantVideoFlags(participantId)
    updateVoiceUi()
  }
}

function bindRoomEvents(sdk, room) {
  const event = sdk.RoomEvent || {}

  if (event.ConnectionQualityChanged) {
    room.on(event.ConnectionQualityChanged, (quality, participant) => {
      applySfuConnectionQuality(quality, participant)
    })
  }

  room.on(event.TrackSubscribed, (track, publication, participant) => {
    bindRemoteTrack(sdk, track, publication, participant)
  })

  room.on(event.TrackUnsubscribed, (track, publication, participant) => {
    unbindRemoteTrack(participant, publication)
  })

  room.on(event.ParticipantDisconnected, (participant) => {
    const participantId = String(participant && participant.identity ? participant.identity : "")
    if (!participantId) return
    clearRemoteParticipantMedia(participantId)
    updateVoiceUi()
  })

  room.on(event.Disconnected, () => {
    clearAllRemoteSfuMedia()
    updateVoiceUi()
  })
}

async function ensureSfuSdkModule() {
  if (voiceState.sfuSdkModule) return voiceState.sfuSdkModule
  if (voiceState.sfuSdkPromise) return voiceState.sfuSdkPromise

  const sdkUrl = VOICE_RUNTIME_CONFIG.clientSdkUrl || DEFAULT_LIVEKIT_CLIENT_URL
  voiceState.sfuSdkPromise = import(sdkUrl)
    .then((module) => {
      voiceState.sfuSdkModule = module
      return module
    })
    .finally(() => {
      voiceState.sfuSdkPromise = null
    })

  return voiceState.sfuSdkPromise
}

function resolveLivekitSourceEnum(sdk, source) {
  if (!sdk || !sdk.Track || !sdk.Track.Source) return undefined
  if (source === "camera") return sdk.Track.Source.Camera
  if (source === "screen") return sdk.Track.Source.ScreenShare
  if (source === "audio") return sdk.Track.Source.Microphone
  return undefined
}

async function ensureSfuRoomConnected() {
  if (voiceState.sfuRoom) return voiceState.sfuRoom
  const sdk = await ensureSfuSdkModule()
  const tokenRes = await emitWithTimeout(
    "voice sfu token",
    { server_id: voiceState.serverId, channel: voiceState.channelName },
    {
      timeoutMessage: "Server tidak merespons saat meminta token SFU",
      failMessage: "Gagal setup SFU voice"
    }
  )

  const wsUrl = String(tokenRes && tokenRes.ws_url ? tokenRes.ws_url : "").trim()
  const token = String(tokenRes && tokenRes.token ? tokenRes.token : "").trim()
  if (!wsUrl || !token) {
    throw new Error("Token SFU tidak valid")
  }

  const room = new sdk.Room({
    adaptiveStream: true,
    dynacast: true,
    stopLocalTrackOnUnpublish: false
  })
  bindRoomEvents(sdk, room)
  await room.connect(wsUrl, token, { autoSubscribe: true })
  voiceState.sfuRoom = room
  voiceState.voiceMode = "sfu"
  voiceDebug("sfu room connected", {
    wsUrl,
    roomName: tokenRes && tokenRes.room_name ? tokenRes.room_name : "",
    identity: tokenRes && tokenRes.identity ? tokenRes.identity : ""
  })
  return room
}

async function unpublishLocalTrack(room, track) {
  if (!room || !room.localParticipant || !track) return
  try {
    await room.localParticipant.unpublishTrack(track)
  } catch {}
}

async function syncSfuOutgoingAudioTrack(track) {
  const room = voiceState.sfuRoom
  if (!room || !room.localParticipant) return
  const nextTrack = track || null
  const currentTrack = voiceState.sfuLocalTracks.audio || null

  if (currentTrack && currentTrack !== nextTrack) {
    await unpublishLocalTrack(room, currentTrack)
    voiceState.sfuLocalTracks.audio = null
  }
  if (!nextTrack) return
  if (currentTrack === nextTrack) return

  const sdk = voiceState.sfuSdkModule
  const source = resolveLivekitSourceEnum(sdk, "audio")
  await room.localParticipant.publishTrack(nextTrack, source ? { source } : {})
  voiceState.sfuLocalTracks.audio = nextTrack
  voiceDebug("sfu publish local audio", { track: describeTrack(nextTrack) })
}

async function syncSfuOutgoingVideoTrack(track, { source = "camera" } = {}) {
  const room = voiceState.sfuRoom
  if (!room || !room.localParticipant) return
  const normalizedSource = normalizeSfuSource(source)
  if (normalizedSource !== "camera" && normalizedSource !== "screen") return

  const nextTrack = track || null
  const currentTrack = voiceState.sfuLocalTracks[normalizedSource] || null

  if (currentTrack && currentTrack !== nextTrack) {
    await unpublishLocalTrack(room, currentTrack)
    voiceState.sfuLocalTracks[normalizedSource] = null
  }
  if (!nextTrack) return
  if (currentTrack === nextTrack) return

  const sdk = voiceState.sfuSdkModule
  const sourceEnum = resolveLivekitSourceEnum(sdk, normalizedSource)
  await room.localParticipant.publishTrack(nextTrack, sourceEnum ? { source: sourceEnum } : {})
  voiceState.sfuLocalTracks[normalizedSource] = nextTrack
  voiceDebug("sfu publish local video", {
    source: normalizedSource,
    track: describeTrack(nextTrack)
  })
}

async function joinSfuVoiceRoom() {
  if (!voiceState.isJoined) return false
  if (!VOICE_RUNTIME_CONFIG.useSfu) return false

  try {
    await ensureSfuRoomConnected()
    const localAudioTrack =
      voiceState.localStream && typeof voiceState.localStream.getAudioTracks === "function"
        ? voiceState.localStream.getAudioTracks()[0] || null
        : null
    await syncSfuOutgoingAudioTrack(localAudioTrack)

    if (voiceState.localCameraTrack) {
      await syncSfuOutgoingVideoTrack(voiceState.localCameraTrack, { source: "camera" })
    }
    if (voiceState.localScreenTrack) {
      await syncSfuOutgoingVideoTrack(voiceState.localScreenTrack, { source: "screen" })
    }
    return true
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    voiceState.lastSfuError = message
    voiceDebug("sfu join failed", {
      message
    })
    return false
  }
}

async function leaveSfuVoiceRoom() {
  const room = voiceState.sfuRoom
  voiceState.sfuLocalTracks.audio = null
  voiceState.sfuLocalTracks.camera = null
  voiceState.sfuLocalTracks.screen = null
  if (room) {
    try {
      room.disconnect()
    } catch {}
  }
  voiceState.sfuRoom = null
  voiceState.lastSfuError = ""
  clearAllRemoteSfuMedia()
}

function applySfuRemoteStreamState(participantId, source, isActive) {
  const peerId = String(participantId || "")
  const normalizedSource = normalizeSfuSource(source)
  if (!peerId || !normalizedSource || normalizedSource === "audio") return
  if (!isActive) {
    voiceState.mediaStreamsBySource.delete(sourceStreamKey(peerId, normalizedSource))
  }
  refreshParticipantVideoFlags(peerId)
  updateVoiceUi()
}

export {
  joinSfuVoiceRoom,
  leaveSfuVoiceRoom,
  syncSfuOutgoingAudioTrack,
  syncSfuOutgoingVideoTrack,
  applySfuRemoteStreamState
}
