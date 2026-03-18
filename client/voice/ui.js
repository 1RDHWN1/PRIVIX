import {
  voicePanel,
  voiceStatus,
  voiceNetworkPill,
  voiceNetworkLatency,
  voiceJoinBtn,
  voiceLeaveBtn,
  voiceMuteBtn,
  voiceStage,
  voiceStageGrid,
  voiceStageTitle,
  voiceStageSubtitle,
  voiceJoinHeroBtn,
  voiceRoster,
  voiceQuality
} from "../dom.js"
import { setElementHidden, updateVoiceChannelListUi } from "../ui.js"
import { voiceState } from "./state.js"
import { updateSelfTileState } from "./participants.js"

let voiceUiRenderToken = 0

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

  return { text: `${rtt} ms`, levelClass: "is-good" }
}

function updateNetworkPill() {
  if (!voiceNetworkPill || !voiceNetworkLatency) return
  const state = resolveNetworkPillState()
  voiceNetworkLatency.textContent = state.text
  voiceNetworkPill.classList.remove("is-good", "is-fair", "is-poor", "is-idle")
  voiceNetworkPill.classList.add(state.levelClass)
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

function updateRosterUi() {
  if (!voiceRoster) return

  if (!voiceState.isVoiceChannel) {
    voiceRoster.textContent = "Tidak ada peserta"
    return
  }

  if (voiceState.isConnecting) {
    voiceRoster.textContent = "Menghubungkan..."
    return
  }

  const entries = Array.from(voiceState.participants.values())
  if (entries.length === 0) {
    voiceRoster.textContent = voiceState.isJoined ? "Tidak ada peserta" : "Belum ada yang join"
    return
  }

  const sorted = entries.sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1
    if (!a.isSelf && b.isSelf) return 1
    return String(a.username || "").localeCompare(String(b.username || ""))
  })

  voiceRoster.innerHTML = ""
  sorted.forEach((participant) => {
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

  if (participant.isSelf) {
    tile.classList.add("is-self")
    if (!voiceState.canSpeak || voiceState.isMuted) {
      tile.classList.add("is-muted")
    }
  } else if (participant.isMuted) {
    tile.classList.add("is-muted")
  }

  const avatar = document.createElement("div")
  avatar.className = "voice-avatar"
  avatar.textContent = getInitials(participant.username)
  avatar.style.background = getAvatarGradient(participant.username)

  const name = document.createElement("div")
  name.className = "voice-name"
  name.textContent = participant.username || "Unknown"

  const mic = document.createElement("div")
  mic.className = "voice-mic"
  mic.appendChild(buildStageMicIcon())

  tile.appendChild(avatar)
  tile.appendChild(name)
  tile.appendChild(mic)
  voiceState.tileEls.set(participant.id, tile)

  if (voiceState.speakingState.get(participant.id)) {
    tile.classList.add("is-speaking")
  }

  return tile
}

function updateVoiceStageUi() {
  if (!voiceStage) return
  setElementHidden(voiceStage, !voiceState.isVoiceChannel)
  if (!voiceState.isVoiceChannel) return

  if (voiceStageTitle) {
    voiceStageTitle.textContent = voiceState.channelName || "voice"
  }

  if (voiceStageSubtitle) {
    const count = getParticipantCount()
    if (count === 0) {
      voiceStageSubtitle.textContent = "Belum ada yang join voice"
    } else if (count === 1) {
      const only = Array.from(voiceState.participants.values())[0]
      voiceStageSubtitle.textContent = `${only.username || "Seseorang"} sedang di voice`
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
  }

  if (voiceStageGrid) {
    voiceStageGrid.innerHTML = ""
    voiceState.tileEls.clear()
    const participants = Array.from(voiceState.participants.values())
    const tiles = participants.length > 0 ? participants.slice(0, 5) : []

    setElementHidden(voiceStageGrid, tiles.length === 0)

    tiles.forEach((participant) => {
      voiceStageGrid.appendChild(createStageTile(participant))
    })
  }
}

function renderVoiceUi() {
  if (!voicePanel || !voiceStatus || !voiceJoinBtn || !voiceLeaveBtn || !voiceMuteBtn) return
  const participantCount = getParticipantCount()
  const showVoicePanel =
    voiceState.isVoiceChannel &&
    (voiceState.isJoined || voiceState.isConnecting || participantCount > 0)

  setElementHidden(voicePanel, !showVoicePanel)
  if (!voiceState.isVoiceChannel) {
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

  if (voiceQuality) {
    voiceQuality.textContent = formatQualityText()
  }
  updateNetworkPill()

  updateSelfTileState()
  updateRosterUi()
  updateVoiceStageUi()
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

export { updateVoiceUi, updateRosterUi, updateVoiceStageUi, getParticipantCount }




