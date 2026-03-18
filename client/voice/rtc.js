import { voiceAudio } from "../dom.js"
import { socket } from "../socket.js"
import { notify } from "../notice.js"
import { voiceState } from "./state.js"
import { ICE_CONFIG } from "./config.js"
import { attachAnalyser, attemptPlayAudio, removeAnalyser } from "./audio.js"
import { applyOutputSettings } from "./settings.js"

const RECONNECT_DELAY_MS = 900
const RECONNECT_COOLDOWN_MS = 8000
const RECONNECT_MAX_ATTEMPTS = 3

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
    isRestarting: false
  }
  voiceState.peerMeta.set(peerId, meta)
  return meta
}

function sendSignal(targetId, data) {
  if (!socket.connected || (!voiceState.isJoined && !voiceState.isConnecting)) return
  socket.emit("voice signal", { target_id: targetId, data })
}

async function ensurePeerConnection(peerId, { isInitiator }) {
  if (voiceState.peers.has(peerId)) {
    ensurePeerMeta(peerId, isInitiator)
    return voiceState.peers.get(peerId)
  }

  const pc = new RTCPeerConnection(ICE_CONFIG)
  voiceState.peers.set(peerId, pc)
  ensurePeerMeta(peerId, isInitiator)

  if (voiceState.localStream) {
    voiceState.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, voiceState.localStream)
    })
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, { candidate: event.candidate })
    }
  }

  pc.ontrack = (event) => {
    const stream = event.streams && event.streams[0]
    if (!stream || !voiceAudio) return
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
  }

  pc.onconnectionstatechange = () => {
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

  pc.oniceconnectionstatechange = () => {
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
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendSignal(peerId, pc.localDescription)
  }

  return pc
}

async function handleVoiceSignal(payload) {
  if (!voiceState.isJoined) return
  const fromId = payload && payload.from_id
  const data = payload && payload.data
  if (!fromId || !data) return

  const pc = await ensurePeerConnection(fromId, { isInitiator: false })

  if (data.restart) {
    attemptIceRestart(fromId, "remote-request").catch(() => {})
    return
  }

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    sendSignal(fromId, pc.localDescription)
    return
  }

  if (data.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data))
    return
  }

  if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
    } catch {}
  }
}

function stopLocalStream() {
  if (voiceState.localStream) {
    voiceState.localStream.getTracks().forEach((track) => track.stop())
  }
  if (voiceState.rawStream && voiceState.rawStream !== voiceState.localStream) {
    voiceState.rawStream.getTracks().forEach((track) => track.stop())
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
  stopLocalStream,
  removePeer,
  resetPeers
}
