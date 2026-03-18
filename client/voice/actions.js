import { state } from "../state.js"
import { socket } from "../socket.js"
import { emitWithTimeout } from "../api.js"
import { notify } from "../notice.js"
import { voiceAutoJoinToggle } from "../dom.js"
import { AUTO_JOIN_KEY, voiceState } from "./state.js"
import { attachAnalyser, removeAnalyser, stopSpeakingLoop } from "./audio.js"
import { updateVoiceUi } from "./ui.js"
import {
  resetParticipants,
  upsertParticipant,
  updateSelfTileState
} from "./participants.js"
import {
  stopPresencePolling,
  startPresencePolling,
  resetPresenceTracking,
  clearVoicePresenceForServer,
  clearAllVoicePresence
} from "./presence.js"
import { ensurePeerConnection, resetPeers, stopLocalStream } from "./rtc.js"
import { createLocalAudioStream, refreshDeviceOptions, stopExistingInputPipeline } from "./settings.js"
import { startQualityMonitoring, stopQualityMonitoring } from "./quality.js"
import { applyPushToTalkState } from "./ptt.js"

function emitMuteState() {
  if (!socket.connected || !voiceState.isJoined) return
  const isMuted = !voiceState.canSpeak || voiceState.isMuted
  socket.emit("voice mute state", { is_muted: isMuted })
}

function shouldAutoJoin() {
  return (
    voiceState.autoJoinEnabled &&
    voiceState.isVoiceChannel &&
    voiceState.isConnected &&
    voiceState.isReady &&
    !voiceState.isJoined &&
    !voiceState.isConnecting &&
    !voiceState.manualLeave
  )
}

function attemptAutoJoin() {
  if (!shouldAutoJoin()) return
  joinVoiceChannel({ silent: true })
}

function initAutoJoinPreference() {
  let enabled = false
  try {
    const stored = localStorage.getItem(AUTO_JOIN_KEY)
    enabled = stored === "1" || stored === "true"
  } catch {}
  voiceState.autoJoinEnabled = enabled
  if (voiceAutoJoinToggle) {
    voiceAutoJoinToggle.checked = enabled
  }
}

function setAutoJoinPreference(enabled, { triggerJoin = true } = {}) {
  voiceState.autoJoinEnabled = Boolean(enabled)
  try {
    localStorage.setItem(AUTO_JOIN_KEY, voiceState.autoJoinEnabled ? "1" : "0")
  } catch {}
  if (voiceAutoJoinToggle) {
    voiceAutoJoinToggle.checked = voiceState.autoJoinEnabled
  }
  if (voiceState.autoJoinEnabled) {
    voiceState.manualLeave = false
    if (triggerJoin) {
      attemptAutoJoin()
    }
  }
}

async function joinVoiceChannel({ silent = false } = {}) {
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

  try {
    if (voiceState.canSpeak) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        voiceState.canSpeak = false
        voiceState.localStream = null
        voiceState.rawStream = null
        voiceState.isMuted = true
        if (!silent) {
          notify("Browser tidak mendukung input suara. Bergabung sebagai pendengar.")
        }
      } else {
        const result = await createLocalAudioStream()
        if (!result) {
          voiceState.canSpeak = false
          voiceState.localStream = null
          voiceState.rawStream = null
          voiceState.isMuted = true
          if (!silent) {
            notify("Browser tidak mendukung input suara. Bergabung sebagai pendengar.")
          }
        } else {
          voiceState.localStream = result.stream
          voiceState.rawStream = result.rawStream
          voiceState.inputGainNode = result.gainNode
          voiceState.inputSourceNode = result.sourceNode
          voiceState.isMuted = false
        }
        voiceState.selfId = socket.id
        if (voiceState.localStream) {
          attachAnalyser(socket.id, voiceState.localStream)
        }
      }
    } else {
      voiceState.localStream = null
      voiceState.rawStream = null
      voiceState.isMuted = true
    }
  } catch (error) {
    voiceState.canSpeak = false
    voiceState.localStream = null
    voiceState.rawStream = null
    voiceState.isMuted = true
    if (!silent) {
      notify("Mic tidak bisa diakses. Bergabung sebagai pendengar.")
    }
  }

  try {
    const result = await emitWithTimeout(
      "voice join",
      {
        server_id: voiceState.serverId,
        channel: voiceState.channelName,
        is_muted: !voiceState.canSpeak || voiceState.isMuted
      },
      {
        timeoutMessage: "Server tidak merespons saat join voice",
        failMessage: "Gagal join voice channel"
      }
    )

    voiceState.canSpeak = Boolean(result.can_speak)
    if (!voiceState.canSpeak) {
      if (voiceState.localStream) {
        stopLocalStream()
        stopExistingInputPipeline()
        removeAnalyser(socket.id)
      }
      voiceState.isMuted = true
    }

    resetParticipants()
    upsertParticipant(socket.id, state.username || "You", {
      isSelf: true,
      isMuted: !voiceState.canSpeak || voiceState.isMuted
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
    for (const peer of peers) {
      if (!peer || !peer.id || peer.id === socket.id) continue
      upsertParticipant(peer.id, peer.username || "Unknown", {
        isSelf: false,
        isMuted: Boolean(peer.is_muted)
      })
      await ensurePeerConnection(peer.id, { isInitiator: true })
    }

    voiceState.isConnecting = false
    voiceState.manualLeave = false
    updateSelfTileState()
    emitMuteState()
    stopPresencePolling()
    refreshDeviceOptions().catch(() => {})
    startQualityMonitoring()
    applyPushToTalkState()
    updateVoiceUi()
  } catch (error) {
    voiceState.isConnecting = false
    voiceState.joinedAtTs = 0
    stopLocalStream()
    stopExistingInputPipeline()
    resetPeers()
    resetParticipants()
    voiceState.iceFailureNotified = false
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

  resetPeers()
  resetParticipants()
  stopLocalStream()
  stopExistingInputPipeline()
  removeAnalyser(socket.id)
  voiceState.isMuted = false
  voiceState.iceFailureNotified = false
  voiceState.selfId = ""
  voiceState.pushToTalkActive = false
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

function setVoiceContext({
  isVoiceChannel,
  serverId,
  channelName,
  canSpeak,
  isReady,
  isConnected
}) {
  const nextKey = isVoiceChannel && serverId && channelName ? `${serverId}:${channelName}` : ""

  voiceState.isVoiceChannel = Boolean(isVoiceChannel)
  voiceState.serverId = serverId || null
  voiceState.channelName = channelName || ""
  voiceState.canSpeak = Boolean(canSpeak)
  voiceState.isReady = Boolean(isReady)
  voiceState.isConnected = Boolean(isConnected)

  const contextChanged = voiceState.contextKey && voiceState.contextKey !== nextKey
  const previousServerId = Number(voiceState.serverId || 0)
  if (contextChanged) {
    leaveVoiceChannel({ notifyServer: true })
  }
  voiceState.contextKey = nextKey
  if (contextChanged) {
    voiceState.manualLeave = false
    stopPresencePolling()
    resetParticipants()
    resetPresenceTracking()
    if (Number.isInteger(previousServerId) && previousServerId > 0 && previousServerId !== Number(serverId || 0)) {
      clearVoicePresenceForServer(previousServerId)
    }
  }

  if (!voiceState.isVoiceChannel) {
    leaveVoiceChannel({ notifyServer: true })
    stopPresencePolling()
    resetParticipants()
    resetPresenceTracking()
  }

  updateVoiceUi()
  attemptAutoJoin()
  if (voiceState.isVoiceChannel && !voiceState.isJoined) {
    startPresencePolling()
  }
}

function resetVoiceState() {
  voiceState.isConnected = false
  voiceState.isReady = false
  voiceState.joinedAtTs = 0
  voiceState.serverClockOffsetMs = 0
  leaveVoiceChannel({ notifyServer: false })
  stopPresencePolling()
  resetParticipants()
  resetPresenceTracking()
  clearAllVoicePresence()
  stopQualityMonitoring()
}

export {
  initAutoJoinPreference,
  setAutoJoinPreference,
  joinVoiceChannel,
  leaveVoiceChannel,
  toggleVoiceMute,
  setVoiceContext,
  resetVoiceState
}


