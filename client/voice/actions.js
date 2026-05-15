import { state } from "../state.js"
import { socket } from "../socket.js"
import { emitWithTimeout } from "../api.js"
import { notify } from "../notice.js"
import { voiceState, resetVoiceMediaCollections, resetVoiceTransientFlags } from "./state.js"
import { attachAnalyser, removeAnalyser, stopSpeakingLoop } from "./audio.js"
import { updateVoiceUi } from "./ui.js"
import {
  resetParticipants,
  upsertParticipant,
  updateSelfTileState,
  setParticipantCameraEnabled,
  setParticipantScreenSharing
} from "./participants.js"
import {
  stopPresencePolling,
  startPresencePolling,
  resetPresenceTracking,
  clearVoicePresenceForServer,
  clearAllVoicePresence
} from "./presence.js"
import { ensurePeerConnection, resetPeers, stopLocalStream, syncOutgoingVideoTrack } from "./rtc.js"
import { VOICE_RUNTIME_CONFIG, isVoiceSfuEnabled } from "./config.js"
import { joinSfuVoiceRoom, leaveSfuVoiceRoom } from "./sfu.js"
import {
  createLocalAudioStream,
  createLocalCameraStream,
  handleLocalCameraTrackEnded,
  refreshDeviceOptions,
  toggleCameraFacingMode,
  stopExistingInputPipeline
} from "./settings.js"
import { startQualityMonitoring, stopQualityMonitoring } from "./quality.js"
import { applyPushToTalkState } from "./ptt.js"
import { voiceDebug, describeStream, describeTrack } from "./debug.js"

function emitMuteState() {
  if (!socket.connected || !voiceState.isJoined) return
  const isMuted = !voiceState.canSpeak || voiceState.isMuted
  socket.emit("voice mute state", { is_muted: isMuted })
}

function emitCameraState() {
  if (!socket.connected || !voiceState.isJoined) return
  const payload = {
    is_camera_enabled: Boolean(voiceState.isCameraEnabled && voiceState.localCameraTrack)
  }
  socket.emit("voice camera state", payload)
  socket.emit("voice stream state", { source: "camera", is_active: payload.is_camera_enabled })
  voiceDebug("emit camera state", payload)
}

function emitScreenState() {
  if (!socket.connected || !voiceState.isJoined) return
  const payload = {
    is_screen_sharing: Boolean(voiceState.isScreenSharing && voiceState.localScreenTrack)
  }
  socket.emit("voice screen state", payload)
  socket.emit("voice stream state", { source: "screen", is_active: payload.is_screen_sharing })
  voiceDebug("emit screen state", payload)
}

async function prepareLocalAudioAfterJoin({ silent = false } = {}) {
  if (!voiceState.canSpeak) {
    voiceState.localStream = null
    voiceState.rawStream = null
    voiceState.isMuted = true
    return false
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    voiceState.canSpeak = false
    voiceState.localStream = null
    voiceState.rawStream = null
    voiceState.isMuted = true
    if (!silent) {
      notify("Browser tidak mendukung input suara. Bergabung sebagai pendengar.")
    }
    return false
  }

  try {
    const result = await createLocalAudioStream()
    if (!result) {
      voiceState.canSpeak = false
      voiceState.localStream = null
      voiceState.rawStream = null
      voiceState.isMuted = true
      if (!silent) {
        notify("Browser tidak mendukung input suara. Bergabung sebagai pendengar.")
      }
      return false
    }

    voiceState.localStream = result.stream
    voiceState.rawStream = result.rawStream
    voiceState.inputGainNode = result.gainNode
    voiceState.inputSourceNode = result.sourceNode
    voiceState.isMuted = false
    voiceState.selfId = socket.id
    attachAnalyser(socket.id, voiceState.localStream)
    return true
  } catch (error) {
    voiceState.canSpeak = false
    voiceState.localStream = null
    voiceState.rawStream = null
    voiceState.isMuted = true
    if (!silent) {
      notify("Mic tidak bisa diakses. Bergabung sebagai pendengar.")
    }
    return false
  }
}

function maybeNotifyMeshReadiness(peerCount) {
  if (voiceState.voiceMode !== "mesh") return
  if (!VOICE_RUNTIME_CONFIG.hasTurn && !voiceState.meshTurnWarningShown) {
    voiceState.meshTurnWarningShown = true
    notify("Voice mesh berjalan tanpa TURN. Beberapa jaringan NAT ketat mungkin gagal tersambung.")
  }
  const softLimit = Number(VOICE_RUNTIME_CONFIG.meshPeerSoftLimit || 4)
  if (peerCount >= softLimit && !voiceState.meshScaleWarningShown) {
    voiceState.meshScaleWarningShown = true
    notify("Room voice mulai ramai. Aktifkan SFU untuk koneksi yang lebih ringan dan stabil.")
  }
}

async function joinVoiceChannel({ silent = false } = {}) {
  voiceDebug("join voice requested", {
    isVoiceChannel: voiceState.isVoiceChannel,
    isConnected: voiceState.isConnected,
    isReady: voiceState.isReady,
    channel: voiceState.channelName,
    serverId: voiceState.serverId
  })
  if (!voiceState.isVoiceChannel) {
    if (!silent) {
      notify("Pilih voice channel dulu")
    }
    return
  }
  if (!voiceState.isConnected || !voiceState.isReady) {
    if (!silent) {
      notify("Server belum terhubung")
    }
    return
  }
  if (voiceState.isJoined || voiceState.isConnecting) return

  voiceState.selfId = socket.id
  voiceState.isConnecting = true
  updateVoiceUi()

  let joinedServerRoom = false
  try {
    const result = await emitWithTimeout(
      "voice join",
      {
        server_id: voiceState.serverId,
        channel: voiceState.channelName,
        is_muted: true,
        is_camera_enabled: Boolean(voiceState.isCameraEnabled && voiceState.localCameraTrack),
        is_screen_sharing: Boolean(voiceState.isScreenSharing && voiceState.localScreenTrack)
      },
      {
        timeoutMessage: "Server tidak merespons saat join voice",
        failMessage: "Gagal join voice channel"
      }
    )
    joinedServerRoom = true

    voiceState.canSpeak = Boolean(result.can_speak)
    await prepareLocalAudioAfterJoin({ silent })
    if (!voiceState.isConnecting) {
      stopLocalStream()
      stopExistingInputPipeline()
      removeAnalyser(socket.id)
      return
    }

    resetParticipants()
    upsertParticipant(socket.id, state.username || "You", {
      isSelf: true,
      isMuted: !voiceState.canSpeak || voiceState.isMuted,
      isCameraEnabled: Boolean(voiceState.isCameraEnabled && voiceState.localCameraTrack),
      isScreenSharing: Boolean(voiceState.isScreenSharing && voiceState.localScreenTrack)
    })
    voiceState.selfId = socket.id
    voiceState.isJoined = true
    {
      const serverNowTs = Number(result.server_now_ts || 0)
      if (Number.isFinite(serverNowTs) && serverNowTs > 0) {
        voiceState.serverClockOffsetMs = serverNowTs - Date.now()
      }
      const roomStartedAtTs = Number(result.room_started_at_ts || 0)
      voiceState.joinedAtTs =
        Number.isFinite(roomStartedAtTs) && roomStartedAtTs > 0
          ? roomStartedAtTs
          : Date.now() + Number(voiceState.serverClockOffsetMs || 0)
    }
    const peers = Array.isArray(result.peers) ? result.peers : []
    const serverVoiceMode = String(result && result.voice_mode ? result.voice_mode : "").toLowerCase()
    voiceState.voiceMode =
      serverVoiceMode === "sfu" || (isVoiceSfuEnabled() && serverVoiceMode !== "mesh") ? "sfu" : "mesh"
    voiceDebug("join voice success", {
      peers: peers.length,
      canSpeak: voiceState.canSpeak,
      joinedAtTs: voiceState.joinedAtTs,
      voiceMode: voiceState.voiceMode
    })

    for (const peer of peers) {
      if (!peer || !peer.id || peer.id === socket.id) continue
      upsertParticipant(peer.id, peer.username || "Unknown", {
        isSelf: false,
        isMuted: Boolean(peer.is_muted),
        isCameraEnabled: Boolean(peer.is_camera_enabled),
        isScreenSharing: Boolean(peer.is_screen_sharing)
      })
    }
    applyPushToTalkState()
    maybeNotifyMeshReadiness(peers.length + 1)

    if (voiceState.voiceMode === "sfu") {
      const connected = await joinSfuVoiceRoom()
      if (!connected) {
        voiceState.voiceMode = "mesh"
        const reason = voiceState.lastSfuError ? ` (${voiceState.lastSfuError})` : ""
        if (!silent) {
          notify(`LiveKit belum bisa tersambung, fallback ke mesh.${reason}`)
        }
      }
    }

    const useMeshForMedia = voiceState.voiceMode !== "sfu"
    for (const peer of peers) {
      if (!peer || !peer.id || peer.id === socket.id) continue
      if (useMeshForMedia) {
        await ensurePeerConnection(peer.id, { isInitiator: true })
      }
    }

    voiceState.isConnecting = false
    voiceState.manualLeave = false
    const shouldRestoreCamera =
      voiceState.restoreCameraAfterJoin &&
      !voiceState.isCameraEnabled &&
      !voiceState.localCameraTrack
    voiceState.restoreCameraAfterJoin = false
    updateSelfTileState()
    emitMuteState()
    emitCameraState()
    emitScreenState()
    stopPresencePolling()
    refreshDeviceOptions().catch(() => {})
    startQualityMonitoring()
    updateVoiceUi()
    if (shouldRestoreCamera) {
      enableVoiceCamera({ silent: true }).catch(() => {})
    }
  } catch (error) {
    voiceDebug("join voice failed", { message: error && error.message ? error.message : String(error) })
    voiceState.isConnecting = false
    voiceState.joinedAtTs = 0
    stopLocalStream()
    stopExistingInputPipeline()
    if (joinedServerRoom && socket.connected) {
      try {
        await emitWithTimeout("voice leave", {}, { timeoutMs: 1500, expectsOk: false })
      } catch {}
    }
    await leaveSfuVoiceRoom()
    resetPeers()
    resetVoiceMediaCollections()
    resetParticipants()
    voiceState.iceFailureNotified = false
    voiceState.audioPlaybackPromptShown = false
    voiceState.voiceMode = "mesh"
    voiceState.lastSfuError = ""
    stopQualityMonitoring()
    updateVoiceUi()
    if (!silent) {
      notify(error.message || "Gagal join voice channel")
    }
  }
}

async function leaveVoiceChannel({ notifyServer = true, markManual = false } = {}) {
  if (!voiceState.isJoined && !voiceState.isConnecting) {
    voiceState.isConnecting = false
    updateVoiceUi()
    return
  }

  voiceState.isConnecting = false
  voiceState.isJoined = false
  voiceState.joinedAtTs = 0
  if (notifyServer && socket.connected) {
    try {
      await emitWithTimeout("voice leave", {}, { timeoutMs: 1500, expectsOk: false })
    } catch {}
  }

  await leaveSfuVoiceRoom()
  resetPeers()
  resetVoiceMediaCollections()
  resetParticipants()
  stopLocalStream()
  stopExistingInputPipeline()
  removeAnalyser(socket.id)
  voiceState.isMuted = false
  voiceState.iceFailureNotified = false
  voiceState.audioPlaybackPromptShown = false
  voiceState.selfId = ""
  voiceState.pushToTalkActive = false
  voiceState.isScreenSharing = false
  voiceState.isScreenShareBusy = false
  voiceState.restoreCameraAfterScreenShare = false
  voiceState.voiceMode = "mesh"
  if (voiceState.localScreenStream) {
    voiceState.localScreenStream.getTracks().forEach((item) => item.stop())
  }
  voiceState.localScreenStream = null
  voiceState.localScreenTrack = null
  resetVoiceTransientFlags()
  applyPushToTalkState()
  stopPresencePolling()
  resetPresenceTracking()
  stopSpeakingLoop()
  stopQualityMonitoring()
  if (voiceState.audioContext) {
    voiceState.audioContext.close().catch(() => {})
    voiceState.audioContext = null
  }
  if (markManual) {
    voiceState.manualLeave = true
    voiceState.restoreCameraAfterJoin = false
  }
  updateVoiceUi()
}

function toggleVoiceMute() {
  if (voiceState.pushToTalkEnabled) {
    notify("Push-to-talk aktif. Tahan tombol untuk bicara.")
    return
  }
  if (!voiceState.localStream || !voiceState.canSpeak) return
  const tracks = voiceState.localStream.getAudioTracks()
  if (tracks.length === 0) return
  const nextMuted = !voiceState.isMuted
  tracks.forEach((track) => {
    track.enabled = !nextMuted
  })
  voiceState.isMuted = nextMuted
  updateSelfTileState()
  emitMuteState()
  updateVoiceUi()
}

async function enableVoiceCamera({ silent = false } = {}) {
  if (!voiceState.isJoined) {
    if (!silent) {
      notify("Join voice dulu sebelum menyalakan kamera")
    }
    return false
  }
  if (voiceState.isCameraBusy) return false
  if (voiceState.isCameraEnabled && voiceState.localCameraTrack) return true
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (!silent) {
      notify("Browser tidak mendukung kamera")
    }
    return false
  }

  voiceState.isCameraBusy = true
  updateVoiceUi()

  try {
    const cameraStream = await createLocalCameraStream()
    if (!cameraStream) {
      throw new Error("Kamera tidak tersedia")
    }
    const track = cameraStream.getVideoTracks()[0]
    if (!track) {
      cameraStream.getTracks().forEach((item) => item.stop())
      throw new Error("Track kamera tidak tersedia")
    }

    track.onended = () => {
      handleLocalCameraTrackEnded(track).catch(() => {})
    }

    if (!voiceState.localStream) {
      voiceState.localStream = new MediaStream()
    }

    voiceState.localStream.getVideoTracks().forEach((item) => {
      voiceState.localStream.removeTrack(item)
    })

    if (voiceState.localCameraStream) {
      voiceState.localCameraStream.getTracks().forEach((item) => item.stop())
    }

    voiceState.localCameraStream = cameraStream
    voiceState.localCameraTrack = track
    voiceState.localStream.addTrack(track)

    await syncOutgoingVideoTrack(track, { source: "camera" })

    voiceState.isCameraEnabled = true
    voiceState.restoreCameraAfterJoin = true
    const selfEntry = voiceState.participants.get(socket.id)
    if (selfEntry) {
      selfEntry.isCameraEnabled = true
      voiceState.participants.set(socket.id, selfEntry)
    }
    emitCameraState()
    refreshDeviceOptions().catch(() => {})
    return true
  } catch (error) {
    if (!silent) {
      notify("Kamera tidak bisa diakses. Cek izin browser atau device.")
    }
    return false
  } finally {
    voiceState.isCameraBusy = false
    updateVoiceUi()
  }
}

async function disableVoiceCamera({ silent = false, syncTrack = true, emitState = true } = {}) {
  if (voiceState.isCameraBusy) return false
  if (!voiceState.isCameraEnabled && !voiceState.localCameraTrack) return true

  voiceState.isCameraBusy = true
  updateVoiceUi()

  try {
    const currentTrack = voiceState.localCameraTrack
    if (voiceState.localStream) {
      voiceState.localStream.getVideoTracks().forEach((item) => {
        voiceState.localStream.removeTrack(item)
      })
    }

    if (voiceState.localCameraStream) {
      voiceState.localCameraStream.getTracks().forEach((item) => item.stop())
    } else if (currentTrack) {
      currentTrack.stop()
    }

    voiceState.localCameraStream = null
    voiceState.localCameraTrack = null
    voiceState.isCameraEnabled = false
    voiceState.restoreCameraAfterJoin = false

    if (syncTrack) {
      await syncOutgoingVideoTrack(null, { source: "camera" })
    }
    setParticipantCameraEnabled(socket.id, false)
    if (emitState) {
      emitCameraState()
    }
    return true
  } catch (error) {
    if (!silent) {
      notify("Gagal mematikan kamera")
    }
    return false
  } finally {
    voiceState.isCameraBusy = false
    updateVoiceUi()
  }
}

async function disableVoiceScreenShare({ silent = false, restoreCamera = true } = {}) {
  voiceDebug("disable screen share requested", {
    isScreenSharing: voiceState.isScreenSharing,
    hasTrack: Boolean(voiceState.localScreenTrack),
    restoreCamera
  })
  if (voiceState.isScreenShareBusy) return false
  if (!voiceState.isScreenSharing && !voiceState.localScreenTrack) return true

  voiceState.isScreenShareBusy = true
  updateVoiceUi()

  try {
    const currentTrack = voiceState.localScreenTrack
    if (voiceState.localStream) {
      voiceState.localStream.getVideoTracks().forEach((item) => {
        voiceState.localStream.removeTrack(item)
      })
    }

    if (voiceState.localScreenStream) {
      voiceState.localScreenStream.getTracks().forEach((item) => item.stop())
    } else if (currentTrack) {
      currentTrack.stop()
    }

    voiceState.localScreenStream = null
    voiceState.localScreenTrack = null
    voiceState.isScreenSharing = false
    voiceDebug("screen share stopped locally")
    setParticipantScreenSharing(socket.id, false)
    emitScreenState()
    await syncOutgoingVideoTrack(null, { source: "screen" })

    if (restoreCamera && voiceState.restoreCameraAfterScreenShare) {
      voiceState.restoreCameraAfterScreenShare = false
      await enableVoiceCamera({ silent: true })
    } else {
      voiceState.restoreCameraAfterScreenShare = false
    }
    return true
  } catch (error) {
    voiceDebug("disable screen share failed", { message: error && error.message ? error.message : String(error) })
    if (!silent) {
      notify("Gagal menghentikan share screen")
    }
    return false
  } finally {
    voiceState.isScreenShareBusy = false
    updateVoiceUi()
  }
}

async function enableVoiceScreenShare({ silent = false } = {}) {
  voiceDebug("enable screen share requested", {
    isJoined: voiceState.isJoined,
    isBusy: voiceState.isScreenShareBusy,
    alreadySharing: voiceState.isScreenSharing
  })
  if (!voiceState.isJoined) {
    if (!silent) {
      notify("Join voice dulu sebelum share screen")
    }
    return false
  }
  if (voiceState.isScreenShareBusy) return false
  if (voiceState.isScreenSharing && voiceState.localScreenTrack) return true
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    if (!silent) {
      notify("Browser tidak mendukung share screen")
    }
    return false
  }

  voiceState.isScreenShareBusy = true
  updateVoiceUi()

  try {
    const shouldRestoreCamera = Boolean(voiceState.isCameraEnabled && voiceState.localCameraTrack)
    if (shouldRestoreCamera) {
      voiceState.restoreCameraAfterScreenShare = true
      await disableVoiceCamera({ silent: true, syncTrack: false, emitState: false })
    } else {
      voiceState.restoreCameraAfterScreenShare = false
    }

    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    })
    voiceDebug("getDisplayMedia success", describeStream(screenStream))
    if (!screenStream) {
      throw new Error("Screen stream tidak tersedia")
    }
    const track = screenStream.getVideoTracks()[0]
    if (!track) {
      screenStream.getTracks().forEach((item) => item.stop())
      throw new Error("Track share screen tidak tersedia")
    }

    track.onended = () => {
      voiceDebug("screen track ended by browser/user", describeTrack(track))
      disableVoiceScreenShare({ silent: true, restoreCamera: true }).catch(() => {})
    }

    if (!voiceState.localStream) {
      voiceState.localStream = new MediaStream()
    }
    voiceState.localStream.getVideoTracks().forEach((item) => {
      voiceState.localStream.removeTrack(item)
    })

    if (voiceState.localScreenStream) {
      voiceState.localScreenStream.getTracks().forEach((item) => item.stop())
    }
    voiceState.localScreenStream = screenStream
    voiceState.localScreenTrack = track
    voiceState.localStream.addTrack(track)
    voiceDebug("local screen track attached", {
      track: describeTrack(track),
      localStream: describeStream(voiceState.localStream)
    })

    await syncOutgoingVideoTrack(track, { source: "screen" })
    voiceDebug("sync outgoing screen track completed", { trackId: track.id || "" })
    setTimeout(() => {
      if (!voiceState.isScreenSharing || voiceState.localScreenTrack !== track) return
      voiceDebug("sync outgoing screen track retry", { trackId: track.id || "" })
      syncOutgoingVideoTrack(track, { source: "screen" }).catch(() => {})
    }, 700)

    voiceState.isScreenSharing = true
    setParticipantScreenSharing(socket.id, true)
    setParticipantCameraEnabled(socket.id, false)
    emitCameraState()
    emitScreenState()
    voiceDebug("enable screen share finished", {
      isScreenSharing: voiceState.isScreenSharing,
      restoreCameraAfterScreenShare: voiceState.restoreCameraAfterScreenShare
    })
    return true
  } catch (error) {
    voiceDebug("enable screen share failed", {
      message: error && error.message ? error.message : String(error)
    })
    voiceState.restoreCameraAfterScreenShare = false
    if (!silent) {
      notify("Share screen gagal. Cek izin browser lalu coba lagi.")
    }
    return false
  } finally {
    voiceState.isScreenShareBusy = false
    updateVoiceUi()
  }
}

function toggleVoiceScreenShare() {
  if (voiceState.isScreenSharing) {
    disableVoiceScreenShare().catch(() => {})
    return
  }
  enableVoiceScreenShare().catch(() => {})
}

function toggleVoiceCamera() {
  if (voiceState.isScreenSharing) {
    notify("Matikan share screen dulu untuk menyalakan kamera.")
    return
  }
  if (voiceState.isCameraEnabled) {
    disableVoiceCamera().catch(() => {})
    return
  }
  enableVoiceCamera().catch(() => {})
}

function toggleVoiceCameraFacing() {
  toggleCameraFacingMode({ silent: false })
    .catch(() => {})
    .finally(() => {
      updateVoiceUi()
    })
}

function resetActiveVoiceContextState() {
  voiceState.joinedAtTs = 0
  voiceState.serverClockOffsetMs = 0
  voiceState.lastPresenceKey = ""
  stopPresencePolling()
  resetParticipants()
  resetPresenceTracking()
}

function setVoiceContext({
  isVoiceChannel,
  serverId,
  channelName,
  canSpeak,
  isReady,
  isConnected
}) {
  const previousContextKey = String(voiceState.contextKey || "")
  const previousServerId = Number(voiceState.serverId || 0)
  const nextKey = isVoiceChannel && serverId && channelName ? `${serverId}:${channelName}` : ""
  const contextChanged = Boolean(previousContextKey) && previousContextKey !== nextKey

  voiceState.isVoiceChannel = Boolean(isVoiceChannel)
  voiceState.serverId = serverId || null
  voiceState.channelName = channelName || ""
  voiceState.canSpeak = Boolean(canSpeak)
  voiceState.isReady = Boolean(isReady)
  voiceState.isConnected = Boolean(isConnected)

  if (contextChanged) {
    leaveVoiceChannel({ notifyServer: true })
  }
  voiceState.contextKey = nextKey
  if (contextChanged) {
    voiceState.manualLeave = false
    voiceState.restoreCameraAfterJoin = false
    resetActiveVoiceContextState()
    if (Number.isInteger(previousServerId) && previousServerId > 0 && previousServerId !== Number(serverId || 0)) {
      clearVoicePresenceForServer(previousServerId)
    }
  }

  if (!voiceState.isVoiceChannel) {
    leaveVoiceChannel({ notifyServer: true })
    voiceState.restoreCameraAfterJoin = false
    resetActiveVoiceContextState()
  }

  updateVoiceUi()
  if (voiceState.isVoiceChannel && !voiceState.isJoined) {
    startPresencePolling()
  }
}

function resetVoiceState() {
  const shouldRestoreCamera =
    !voiceState.manualLeave &&
    voiceState.isVoiceChannel &&
    (voiceState.isJoined || voiceState.isConnecting) &&
    Boolean(voiceState.isCameraEnabled && voiceState.localCameraTrack)
  voiceState.isConnected = false
  voiceState.isReady = false
  leaveVoiceChannel({ notifyServer: false })
  voiceState.restoreCameraAfterJoin = shouldRestoreCamera
  stopPresencePolling()
  resetParticipants()
  resetPresenceTracking()
  clearAllVoicePresence()
  stopQualityMonitoring()
  voiceState.voiceMode = "mesh"
}

export {
  joinVoiceChannel,
  leaveVoiceChannel,
  toggleVoiceMute,
  toggleVoiceCamera,
  toggleVoiceScreenShare,
  toggleVoiceCameraFacing,
  setVoiceContext,
  resetVoiceState
}


