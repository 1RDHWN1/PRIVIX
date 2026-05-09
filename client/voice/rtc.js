import { voiceAudio } from "../dom.js"
import { socket } from "../socket.js"
import { notify } from "../notice.js"
import { voiceState } from "./state.js"
import { ICE_CONFIG } from "./config.js"
import { isVoiceSfuEnabled } from "./config.js"
import { attachAnalyser, attemptPlayAudio, removeAnalyser } from "./audio.js"
import { applyOutputSettings } from "./settings.js"
import { updateVoiceUi } from "./ui.js"
import { voiceDebug, describeStream, describeTrack } from "./debug.js"
import { setParticipantScreenSharing } from "./participants.js"
import { syncSfuOutgoingAudioTrack, syncSfuOutgoingVideoTrack } from "./sfu.js"

const RECONNECT_DELAY_MS = 900
const RECONNECT_COOLDOWN_MS = 8000
const RECONNECT_MAX_ATTEMPTS = 3
const transceiverKindMap = new WeakMap()

function markTransceiverKind(transceiver, kind) {
  if (!transceiver || !kind) return
  transceiverKindMap.set(transceiver, kind)
}

function getMarkedTransceiverKind(transceiver) {
  if (!transceiver) return ""
  return String(transceiverKindMap.get(transceiver) || "")
}

function ensurePeerMeta(peerId, isInitiator) {
  const existing = voiceState.peerMeta.get(peerId)
  if (existing) {
    if (typeof isInitiator === "boolean") {
      existing.isInitiator = isInitiator
    }
    return existing
  }
  const meta = {
    isInitiator: Boolean(isInitiator),
    restartAttempts: 0,
    lastRestartAt: 0,
    lastRestartRequestAt: 0,
    restartTimerId: 0,
    isRestarting: false,
    pendingRenegotiate: false
  }
  voiceState.peerMeta.set(peerId, meta)
  return meta
}

function isSfuMode() {
  return isVoiceSfuEnabled() && voiceState.voiceMode === "sfu"
}

function sendSignal(targetId, data) {
  if (isSfuMode()) return
  if (!socket.connected || (!voiceState.isJoined && !voiceState.isConnecting)) return
  voiceDebug("send signal", {
    targetId,
    type: data && data.type ? data.type : data && data.candidate ? "candidate" : data && data.restart ? "restart" : "unknown"
  })
  socket.emit("voice signal", { target_id: targetId, data })
}

function hasLocalTrack(kind) {
  if (!voiceState.localStream) return false
  const getter = kind === "video" ? "getVideoTracks" : "getAudioTracks"
  return typeof voiceState.localStream[getter] === "function" &&
    voiceState.localStream[getter]().some((track) => track && track.readyState === "live")
}

function findTrackTransceiver(pc, kind) {
  return pc.getTransceivers().find((transceiver) => {
    if (getMarkedTransceiverKind(transceiver) === kind) {
      return true
    }
    const senderTrack = transceiver && transceiver.sender && transceiver.sender.track
    const receiverTrack = transceiver && transceiver.receiver && transceiver.receiver.track
    return (senderTrack && senderTrack.kind === kind) || (receiverTrack && receiverTrack.kind === kind)
  }) || null
}

function ensureReceiveTransceiver(pc, kind) {
  if (!pc || findTrackTransceiver(pc, kind)) return
  const direction = kind === "video" ? "sendrecv" : "recvonly"
  const transceiver = pc.addTransceiver(kind, { direction })
  markTransceiverKind(transceiver, kind)
}

function ensureRemoteMediaReceivers(pc) {
  if (!hasLocalTrack("audio")) {
    ensureReceiveTransceiver(pc, "audio")
  }
  if (!hasLocalTrack("video")) {
    ensureReceiveTransceiver(pc, "video")
  }
}

function bindRemoteStreamEvents(peerId, stream) {
  if (!peerId || !stream) return
  const rerender = () => {
    updateVoiceUi()
  }
  stream.onaddtrack = rerender
  stream.onremovetrack = rerender
  stream.getTracks().forEach((track) => {
    track.onended = rerender
    track.onmute = rerender
    track.onunmute = rerender
  })
}

function storeRemoteStream(peerId, stream) {
  if (!peerId || !stream) return
  const previous = voiceState.mediaStreams.get(peerId)
  if (previous !== stream) {
    voiceState.mediaStreams.set(peerId, stream)
  }
  bindRemoteStreamEvents(peerId, stream)
}

function resolveRemoteStream(peerId, event) {
  const incomingStream = event && event.streams && event.streams[0]
  const existingStream = voiceState.mediaStreams.get(peerId)
  const track = event && event.track

  const buildMergedStream = (baseStream, nextTrack) => {
    if (typeof MediaStream === "undefined") return null
    const merged = []
    const seen = new Set()
    const baseTracks = baseStream && typeof baseStream.getTracks === "function" ? baseStream.getTracks() : []
    baseTracks.forEach((item) => {
      if (!item || !item.id || seen.has(item.id)) return
      seen.add(item.id)
      merged.push(item)
    })
    if (nextTrack && nextTrack.id && !seen.has(nextTrack.id)) {
      seen.add(nextTrack.id)
      merged.push(nextTrack)
    }
    try {
      return new MediaStream(merged)
    } catch {
      return null
    }
  }

  if (existingStream) {
    if (track && typeof existingStream.getTracks === "function") {
      const hasTrack = existingStream.getTracks().some((item) => item && item.id === track.id)
      if (!hasTrack && typeof existingStream.addTrack === "function") {
        let added = false
        try {
          existingStream.addTrack(track)
          added = true
        } catch {}
        if (!added) {
          const fallback = buildMergedStream(existingStream, track)
          if (fallback) {
            return fallback
          }
        }
      }
    }
    return existingStream
  }

  if (incomingStream) {
    if (track && typeof incomingStream.getTracks === "function") {
      const hasTrack = incomingStream.getTracks().some((item) => item && item.id === track.id)
      if (!hasTrack && typeof incomingStream.addTrack === "function") {
        let added = false
        try {
          incomingStream.addTrack(track)
          added = true
        } catch {}
        if (!added) {
          const fallback = buildMergedStream(incomingStream, track)
          if (fallback) {
            return fallback
          }
        }
      }
    }
    return incomingStream
  }

  if (typeof MediaStream !== "undefined" && track) {
    try {
      return new MediaStream([track])
    } catch {
      return null
    }
  }

  return null
}

async function renegotiatePeer(peerId, options = {}) {
  const pc = voiceState.peers.get(peerId)
  if (!pc || !voiceState.isJoined) return
  const meta = ensurePeerMeta(peerId)
  if (pc.signalingState !== "stable") {
    meta.pendingRenegotiate = true
    voiceDebug("renegotiate postponed (not stable)", { peerId, signalingState: pc.signalingState })
    return
  }
  meta.pendingRenegotiate = false
  voiceDebug("renegotiate start", { peerId, options })
  const offer = await pc.createOffer(options)
  await pc.setLocalDescription(offer)
  voiceDebug("renegotiate local offer set", { peerId, sdpType: pc.localDescription && pc.localDescription.type })
  sendSignal(peerId, pc.localDescription)
}

async function syncOutgoingVideoTrack(track, options = {}) {
  const source =
    (options && options.source) ||
    (track && String(track.label || "").toLowerCase().includes("screen") ? "screen" : "camera")
  return syncOutgoingVideoTrackWithSource(track, { source })
}

async function syncOutgoingVideoTrackWithSource(track, { source = "camera" } = {}) {
  if (isSfuMode()) {
    await syncSfuOutgoingVideoTrack(track, { source })
    return
  }
  if (!voiceState.isJoined) return
  voiceDebug("syncOutgoingVideoTrack called", {
    targetTrack: describeTrack(track),
    peers: voiceState.peers.size
  })

  const tasks = []
  voiceState.peers.forEach((pc, peerId) => {
    ensureReceiveTransceiver(pc, "video")
    const transceiver = findTrackTransceiver(pc, "video")
    const sender = transceiver && transceiver.sender
      ? transceiver.sender
      : pc.getSenders().find((item) => item && item.track && item.track.kind === "video")

    if (track) {
      if (transceiver && transceiver.sender) {
        markTransceiverKind(transceiver, "video")
        transceiver.direction = "sendrecv"
        if (transceiver.sender.track !== track) {
          voiceDebug("replace video track on transceiver sender", {
            peerId,
            currentTrack: describeTrack(transceiver.sender.track),
            nextTrack: describeTrack(track),
            signalingState: pc.signalingState
          })
          tasks.push(
            transceiver.sender.replaceTrack(track).catch(() => {
              voiceDebug("replaceTrack failed, fallback addTrack", { peerId })
              try {
                const addedSender = pc.addTrack(track, voiceState.localStream)
                const addedTransceiver = pc.getTransceivers().find((item) => item && item.sender === addedSender)
                markTransceiverKind(addedTransceiver, "video")
                renegotiatePeer(peerId).catch(() => {})
              } catch {}
            })
          )
        }
        tasks.push(
          renegotiatePeer(peerId)
            .then(() => {
              voiceDebug("renegotiate requested after video track replace", { peerId })
            })
            .catch(() => {})
        )
        return
      }
      if (sender && sender.track !== track) {
        voiceDebug("replace video track on sender fallback", {
          peerId,
          currentTrack: describeTrack(sender.track),
          nextTrack: describeTrack(track),
          signalingState: pc.signalingState
        })
        tasks.push(sender.replaceTrack(track).catch(() => {}))
      }
      tasks.push(
        renegotiatePeer(peerId)
          .then(() => {
            voiceDebug("renegotiate requested after video sender fallback", { peerId })
          })
          .catch(() => {})
      )
      return
    }

    if (!sender && !(transceiver && transceiver.sender)) return
    try {
      if (transceiver && transceiver.sender) {
        markTransceiverKind(transceiver, "video")
        transceiver.direction = "sendrecv"
        voiceDebug("replace video track with null", {
          peerId,
          currentTrack: describeTrack(transceiver.sender.track),
          signalingState: pc.signalingState
        })
        tasks.push(transceiver.sender.replaceTrack(null).catch(() => {}))
        tasks.push(
          renegotiatePeer(peerId)
            .then(() => {
              voiceDebug("renegotiate requested after video track cleared", { peerId })
            })
            .catch(() => {})
        )
      } else {
        pc.removeTrack(sender)
        voiceDebug("removeTrack video sender", { peerId, signalingState: pc.signalingState })
        tasks.push(renegotiatePeer(peerId))
      }
    } catch {
      if (sender) {
        tasks.push(sender.replaceTrack(null).catch(() => {}))
      }
    }
  })

  if (tasks.length > 0) {
    await Promise.allSettled(tasks)
    voiceDebug("syncOutgoingVideoTrack settled", { tasks: tasks.length })
  }
}

async function syncOutgoingAudioTrack(track) {
  if (isSfuMode()) {
    await syncSfuOutgoingAudioTrack(track || null)
    return
  }
  if (!voiceState.isJoined) return
  const nextTrack = track || null

  const tasks = []
  voiceState.peers.forEach((pc, peerId) => {
    const sender = pc.getSenders().find((item) => item && item.track && item.track.kind === "audio")
    if (sender) {
      tasks.push(sender.replaceTrack(nextTrack).catch(() => {}))
      return
    }
    if (nextTrack && voiceState.localStream) {
      try {
        pc.addTrack(nextTrack, voiceState.localStream)
      } catch {}
      tasks.push(renegotiatePeer(peerId).catch(() => {}))
    }
  })

  if (tasks.length > 0) {
    await Promise.allSettled(tasks)
  }
}

async function ensurePeerConnection(peerId, { isInitiator }) {
  if (isSfuMode()) return null
  if (voiceState.peers.has(peerId)) {
    ensurePeerMeta(peerId, isInitiator)
    return voiceState.peers.get(peerId)
  }

  const pc = new RTCPeerConnection(ICE_CONFIG)
  voiceState.peers.set(peerId, pc)
  ensurePeerMeta(peerId, isInitiator)
  voiceDebug("peer connection created", {
    peerId,
    isInitiator: Boolean(isInitiator),
    localStream: describeStream(voiceState.localStream)
  })

  if (voiceState.localStream) {
    voiceState.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, voiceState.localStream)
    })
  }
  ensureRemoteMediaReceivers(pc)

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, { candidate: event.candidate })
    }
  }

  pc.ontrack = (event) => {
    voiceDebug("ontrack received", {
      peerId,
      track: describeTrack(event && event.track),
      streams: Array.isArray(event && event.streams) ? event.streams.length : 0
    })
    const stream = resolveRemoteStream(peerId, event)
    if (!stream || !voiceAudio) return
    storeRemoteStream(peerId, stream)
    let audioEl = voiceState.audioEls.get(peerId)
    if (!audioEl) {
      audioEl = document.createElement("audio")
      audioEl.autoplay = true
      audioEl.playsInline = true
      audioEl.muted = false
      audioEl.srcObject = stream
      applyOutputSettings(audioEl)
      voiceAudio.appendChild(audioEl)
      voiceState.audioEls.set(peerId, audioEl)
    } else if (audioEl.srcObject !== stream) {
      audioEl.srcObject = stream
    }
    if (audioEl.parentElement !== voiceAudio) {
      voiceAudio.appendChild(audioEl)
    }
    applyOutputSettings(audioEl)
    attachAnalyser(peerId, stream)
    attemptPlayAudio(audioEl)
    if (event && event.track && event.track.kind === "video") {
      const participant = voiceState.participants.get(peerId)
      if (participant && !participant.isCameraEnabled && !participant.isScreenSharing) {
        setParticipantScreenSharing(peerId, true)
        voiceDebug("ontrack inferred remote screen share", { peerId })
      }
    }
    updateVoiceUi()
  }

  pc.onconnectionstatechange = () => {
    voiceDebug("peer connection state", { peerId, state: pc.connectionState })
    if (pc.connectionState === "connected") {
      const meta = ensurePeerMeta(peerId)
      meta.restartAttempts = 0
      meta.isRestarting = false
      return
    }
    if (["disconnected", "failed"].includes(pc.connectionState)) {
      schedulePeerReconnect(peerId, pc.connectionState)
      return
    }
    if (pc.connectionState === "closed") {
      removePeer(peerId)
    }
  }

  pc.onsignalingstatechange = () => {
    voiceDebug("peer signaling state", { peerId, state: pc.signalingState })
    if (pc.signalingState !== "stable") return
    const meta = ensurePeerMeta(peerId)
    if (!meta.pendingRenegotiate) return
    meta.pendingRenegotiate = false
    renegotiatePeer(peerId).catch(() => {})
  }

  pc.oniceconnectionstatechange = () => {
    voiceDebug("peer ice state", { peerId, state: pc.iceConnectionState })
    if (pc.iceConnectionState === "connected") {
      const meta = ensurePeerMeta(peerId)
      meta.restartAttempts = 0
      meta.isRestarting = false
      return
    }
    if (pc.iceConnectionState === "failed" && !voiceState.iceFailureNotified) {
      voiceState.iceFailureNotified = true
      notify("Koneksi voice gagal. Jika jaringan NAT ketat, siapkan TURN server.")
    }
    if (["failed", "disconnected"].includes(pc.iceConnectionState)) {
      schedulePeerReconnect(peerId, pc.iceConnectionState)
    }
  }

  if (isInitiator) {
    ensureRemoteMediaReceivers(pc)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendSignal(peerId, pc.localDescription)
  }

  return pc
}

async function handleVoiceSignal(payload) {
  if (isSfuMode()) return
  if (!voiceState.isJoined) return
  const fromId = payload && payload.from_id
  const data = payload && payload.data
  if (!fromId || !data) return

  const pc = await ensurePeerConnection(fromId, { isInitiator: false })
  voiceDebug("receive signal", {
    fromId,
    type: data && data.type ? data.type : data && data.candidate ? "candidate" : data && data.restart ? "restart" : "unknown",
    signalingState: pc.signalingState
  })

  if (data.restart) {
    attemptIceRestart(fromId, "remote-request").catch(() => {})
    return
  }

  if (data.type === "offer") {
    if (pc.signalingState !== "stable") {
      try {
        await pc.setLocalDescription({ type: "rollback" })
      } catch {}
    }
    await pc.setRemoteDescription(new RTCSessionDescription(data))
    voiceDebug("remote offer set", { fromId, signalingState: pc.signalingState })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    voiceDebug("local answer set", { fromId })
    sendSignal(fromId, pc.localDescription)
    return
  }

  if (data.type === "answer") {
    if (pc.signalingState !== "have-local-offer") {
      return
    }
    await pc.setRemoteDescription(new RTCSessionDescription(data))
    voiceDebug("remote answer set", { fromId, signalingState: pc.signalingState })
    return
  }

  if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
    } catch {}
  }
}

function stopLocalStream() {
  const currentCameraStream = voiceState.localCameraStream
  const currentScreenStream = voiceState.localScreenStream
  voiceState.localCameraTrack = null
  voiceState.localCameraStream = null
  voiceState.isCameraEnabled = false
  voiceState.isCameraBusy = false
  voiceState.localScreenTrack = null
  voiceState.localScreenStream = null
  voiceState.isScreenSharing = false
  voiceState.isScreenShareBusy = false

  if (voiceState.localStream) {
    voiceState.localStream.getTracks().forEach((track) => track.stop())
  }
  if (voiceState.rawStream && voiceState.rawStream !== voiceState.localStream) {
    voiceState.rawStream.getTracks().forEach((track) => track.stop())
  }
  if (currentCameraStream && currentCameraStream !== voiceState.localStream) {
    currentCameraStream.getTracks().forEach((track) => track.stop())
  }
  if (currentScreenStream && currentScreenStream !== voiceState.localStream) {
    currentScreenStream.getTracks().forEach((track) => track.stop())
  }
  voiceState.localStream = null
  voiceState.rawStream = null
}

function removePeer(peerId) {
  const peer = voiceState.peers.get(peerId)
  if (peer) {
    peer.close()
    voiceState.peers.delete(peerId)
  }
  const meta = voiceState.peerMeta.get(peerId)
  if (meta && meta.restartTimerId) {
    clearTimeout(meta.restartTimerId)
  }
  voiceState.peerMeta.delete(peerId)
  voiceState.peerStats.delete(peerId)
  removeAnalyser(peerId)
  voiceState.mediaStreams.delete(peerId)
  Array.from(voiceState.mediaStreamsBySource.keys()).forEach((key) => {
    if (key.startsWith(`${peerId}::`)) {
      voiceState.mediaStreamsBySource.delete(key)
    }
  })
  Array.from(voiceState.sfuTrackBindings.keys()).forEach((key) => {
    const binding = voiceState.sfuTrackBindings.get(key)
    if (binding && binding.participantId === peerId) {
      voiceState.sfuTrackBindings.delete(key)
    }
  })
  const audioEl = voiceState.audioEls.get(peerId)
  if (audioEl) {
    audioEl.srcObject = null
    audioEl.remove()
    voiceState.audioEls.delete(peerId)
  }
}

function resetPeers() {
  for (const peerId of voiceState.peers.keys()) {
    removePeer(peerId)
  }
}

async function attemptIceRestart(peerId, reason) {
  const pc = voiceState.peers.get(peerId)
  if (!pc || !voiceState.isJoined) return
  const meta = ensurePeerMeta(peerId)
  if (!meta.isInitiator) {
    if (reason !== "remote-request") {
      const now = Date.now()
      if (now - meta.lastRestartRequestAt > RECONNECT_COOLDOWN_MS) {
        meta.lastRestartRequestAt = now
        sendSignal(peerId, { restart: true })
      }
    }
    return
  }

  if (meta.isRestarting) return
  if (meta.restartAttempts >= RECONNECT_MAX_ATTEMPTS) {
    removePeer(peerId)
    return
  }
  if (pc.signalingState !== "stable") return

  meta.isRestarting = true
  meta.restartAttempts += 1
  meta.lastRestartAt = Date.now()

  try {
    const offer = await pc.createOffer({ iceRestart: true })
    await pc.setLocalDescription(offer)
    sendSignal(peerId, pc.localDescription)
  } catch {
    // ignore
  } finally {
    meta.isRestarting = false
  }
}

function schedulePeerReconnect(peerId, reason) {
  if (isSfuMode()) return
  if (!voiceState.isJoined) return
  const meta = ensurePeerMeta(peerId)
  const now = Date.now()

  if (!meta.isInitiator) {
    if (now - meta.lastRestartRequestAt > RECONNECT_COOLDOWN_MS) {
      meta.lastRestartRequestAt = now
      sendSignal(peerId, { restart: true, reason })
    }
    return
  }

  if (meta.restartTimerId) return
  if (meta.restartAttempts >= RECONNECT_MAX_ATTEMPTS) return

  meta.restartTimerId = setTimeout(() => {
    meta.restartTimerId = 0
    attemptIceRestart(peerId, reason).catch(() => {})
  }, RECONNECT_DELAY_MS)
}

export {
  sendSignal,
  ensurePeerConnection,
  handleVoiceSignal,
  schedulePeerReconnect,
  syncOutgoingVideoTrack,
  syncOutgoingVideoTrackWithSource,
  syncOutgoingAudioTrack,
  stopLocalStream,
  removePeer,
  resetPeers
}
