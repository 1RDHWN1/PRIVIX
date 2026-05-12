import {
  channelSelect,
  serverSelect,
  memberUsernameInput,
  messages,
  permMemberView,
  permMemberSend
} from "../dom.js"
import { state } from "../state.js"
import { socket } from "../socket.js"
import { SERVER_KEY, CHANNEL_KEY } from "../constants.js"
import { notify, setStatus } from "../notice.js"
import {
  deleteMessageFromView,
  focusInviteInput,
  isMessageListNearBottom,
  messageMentionsUser,
  renderTypingIndicator,
  renderMessage,
  resetMessageJumpState,
  scrollMessageListToBottom,
  syncChatJumpControls,
  trackUnreadMentionMessage,
  updateMessageReactions,
  setInvitePreview,
  setServerOptions,
  setChannelOptions,
  syncServerListSelection,
  syncChannelListSelection
} from "../ui.js"
import { formatMuteRemaining } from "../utils.js"
import { fetchMembersForServer } from "../api.js"
import {
  getActiveServer,
  startSessionForSelectedChannel,
  updateChannelActionState,
  clearRolePanels
} from "../session.js"
import { setMembers, setOnlineUsersForServer, clearOnlineUsersForServer, clearAllOnlineUsers } from "../members.js"
import { sendTypingState, stopTypingStateTimer, resetTypingState } from "../typing.js"
import { resetVoiceState } from "../voice.js"
import {
  handleGameLobbyState,
  handleDrawGuessState,
  handleDrawGuessStroke,
  handleDrawGuessClear,
  handleDrawGuessRoundEnded,
  handleWordRushState,
  handleWordRushRoundEnded,
  resetDrawGuessUi
} from "../drawguess.js"

function notifyRemovedFromServer(serverName, reason = "") {
  const safeServerName = String(serverName || "server")
  const normalizedReason = String(reason || "").toLowerCase()
  const isDeleted = normalizedReason === "deleted"
  const message = isDeleted
    ? `Server "${safeServerName}" telah dihapus oleh owner.`
    : `Kamu dikeluarkan dari server "${safeServerName}"`
  notify(message, isDeleted ? "info" : "error", {
    title: isDeleted ? "Server Deleted" : "Removed From Server",
    actionLabel: "Join Another Server",
    onAction: () => {
      focusInviteInput()
      setStatus("Belum join server • masuk pakai invite code", false)
    }
  })
}

function bindSocketHandlers() {
  socket.on("chat message", (data) => {
    if (!data || data.channel !== channelSelect.value) return
    const wasNearBottom = isMessageListNearBottom()
    if (data.username && data.username !== state.username) {
      state.typingUsers.delete(String(data.username))
      renderTypingIndicator()
    }
    const messageId = Number(data.id)
    const isSelfMessage = String(data.username || "") === String(state.username || "")
    const isMentionForSelf = !isSelfMessage && messageMentionsUser(data.message, state.username)
    let isKnownMentionMessage = false
    if (isMentionForSelf) {
      isKnownMentionMessage =
        Number.isInteger(messageId) &&
        messageId > 0 &&
        state.seenMentionMessageIds.has(messageId)
      if (!isKnownMentionMessage) {
        notify(`Kamu di-mention oleh ${data.username}`, "info", {
          title: "Mention",
          okLabel: "Lihat"
        })
        if (Number.isInteger(messageId) && messageId > 0) {
          state.seenMentionMessageIds.add(messageId)
        }
      }
    }
    renderMessage(data)
    if (isSelfMessage || wasNearBottom) {
      if (isMentionForSelf && Number.isInteger(messageId) && messageId > 0) {
        state.readMentionMessageIds.add(messageId)
      }
      scrollMessageListToBottom("auto")
      return
    }
    if (isMentionForSelf && !isKnownMentionMessage && Number.isInteger(messageId) && messageId > 0) {
      trackUnreadMentionMessage(messageId)
      return
    }
    syncChatJumpControls()
  })

  socket.on("message reaction update", (payload) => {
    if (!payload) return
    updateMessageReactions(payload.message_id, payload.reactions)
  })

  socket.on("message deleted", (payload) => {
    if (!payload) return
    deleteMessageFromView(payload.message_id)
  })

  socket.on("drawguess state", (payload) => {
    handleDrawGuessState(payload)
  })

  socket.on("game lobby state", (payload) => {
    handleGameLobbyState(payload)
  })

  socket.on("drawguess stroke", (payload) => {
    handleDrawGuessStroke(payload)
  })

  socket.on("drawguess clear", () => {
    handleDrawGuessClear()
  })

  socket.on("drawguess round ended", (payload) => {
    handleDrawGuessRoundEnded(payload)
  })

  socket.on("wordrush state", (payload) => {
    handleWordRushState(payload)
  })

  socket.on("wordrush round ended", (payload) => {
    handleWordRushRoundEnded(payload)
  })

  socket.on("typing indicator", (payload) => {
    if (!payload || !payload.username) return

    const activeServer = getActiveServer()
    const activeServerId = activeServer ? Number(activeServer.id) : 0
    const payloadServerId = Number(payload.server_id || 0)
    const payloadChannel = String(payload.channel || "")
    const activeChannel = String(channelSelect.value || "")
    const actor = String(payload.username)

    if (actor === state.username) return
    if (payloadServerId !== activeServerId) return
    if (payloadChannel !== activeChannel) return

    if (payload.is_typing) {
      state.typingUsers.add(actor)
    } else {
      state.typingUsers.delete(actor)
    }
    renderTypingIndicator()
  })

  socket.on("member mute state", (payload) => {
    if (!payload) return
    const serverId = Number(payload.server_id)
    if (!Number.isInteger(serverId) || serverId <= 0) return

    const activeServer = getActiveServer()
    const activeServerId = activeServer ? Number(activeServer.id) : 0
    const isMuted = Boolean(payload.is_muted)
    const reasonText = String(payload.mute_reason || "").trim()

    if (isMuted) {
      const remainingText = formatMuteRemaining(Number(payload.muted_until_ts || 0))
      const reasonSuffix = reasonText ? ` Alasan: ${reasonText}` : ""
      notify(`Kamu di-mute di server ini (${remainingText} lagi).${reasonSuffix}`, "error", {
        title: "Muted"
      })
      if (activeServerId === serverId) {
        sendTypingState(false)
        stopTypingStateTimer()
      }
    } else {
      notify("Mute kamu telah dicabut.", "success", { title: "Unmuted" })
    }

    if (activeServerId === serverId) {
      fetchMembersForServer(serverId)
        .then((members) => setMembers(members))
        .catch(() => {})
      updateChannelActionState()
    }
  })

  socket.on("removed from server", (payload) => {
    if (!payload) return
    const serverId = Number(payload.server_id)
    if (!Number.isInteger(serverId) || serverId <= 0) return
    clearOnlineUsersForServer(serverId)

    const removedServer = state.serversCache.find((item) => item.id === serverId)
    const removedServerName =
      String(payload.server_name || (removedServer && removedServer.name) || "server")
    const removedReason = String(payload.reason || "")

    state.serversCache = state.serversCache.filter((item) => item.id !== serverId)

    const selectedServerId = Number(serverSelect.value)
    const isSelectedServer = Number.isInteger(selectedServerId) && selectedServerId === serverId
    const storedServerId = Number(localStorage.getItem(SERVER_KEY))
    const wasStoredAsActive = Number.isInteger(storedServerId) && storedServerId === serverId

    setServerOptions(state.serversCache)
    if (!isSelectedServer && Number.isInteger(selectedServerId) && selectedServerId > 0) {
      const stillMember = state.serversCache.some((item) => item.id === selectedServerId)
      if (stillMember) {
        serverSelect.value = String(selectedServerId)
        syncServerListSelection()
      }
    }

    if (wasStoredAsActive || isSelectedServer) {
      localStorage.removeItem(SERVER_KEY)
      localStorage.removeItem(CHANNEL_KEY)

      resetTypingState({ notifyServer: true })
      setInvitePreview("")
      messages.innerHTML = ""
      resetMessageJumpState()
      memberUsernameInput.value = ""
      notifyRemovedFromServer(removedServerName, removedReason)
      startSessionForSelectedChannel(false)
      return
    }

    updateChannelActionState()
    notifyRemovedFromServer(removedServerName, removedReason)
  })

  socket.on("system error", (payload) => {
    if (!payload || !payload.message) return
    notify(payload.message, "error")
  })

  socket.on("server online users", (payload) => {
    if (!payload) return
    const serverId = Number(payload.server_id)
    if (!Number.isInteger(serverId) || serverId <= 0) return
    const users = Array.isArray(payload.users) ? payload.users : []
    setOnlineUsersForServer(serverId, users)
  })

  socket.on("channel renamed", (payload) => {
    if (!payload) return
    const serverId = Number(payload.server_id)
    const oldChannel = payload.old_channel
    const newChannel = payload.new_channel
    if (!serverId || !oldChannel || !newChannel) return

    const server = state.serversCache.find((item) => item.id === serverId)
    if (server && Array.isArray(server.channels)) {
      server.channels = server.channels.map((ch) =>
        ch.name === oldChannel ? { ...ch, name: newChannel } : ch
      )
    }

    const activeServer = getActiveServer()
    if (activeServer && activeServer.id === serverId) {
      const wasActive = channelSelect.value === oldChannel
      setChannelOptions(activeServer.channels || [])
      updateChannelActionState()
      if (wasActive) {
        channelSelect.value = newChannel
        syncChannelListSelection()
        localStorage.setItem(CHANNEL_KEY, newChannel)
        startSessionForSelectedChannel(false)
      }
    }
  })

  socket.on("connect", () => {
    resetTypingState()
    resetDrawGuessUi()
    setStatus("Connected", false)
    updateChannelActionState()
    startSessionForSelectedChannel(false)
  })

  socket.on("disconnect", (reason) => {
    state.sessionRequestId += 1
    state.isSessionReady = false
    resetTypingState()
    resetDrawGuessUi()
    resetVoiceState()
    clearAllOnlineUsers()
    const label = reason ? `Disconnected (${reason})` : "Disconnected"
    setStatus(label, false)
    clearRolePanels()
    permMemberView.checked = true
    permMemberSend.checked = true
    updateChannelActionState()
  })

  socket.on("connect_error", (error) => {
    state.sessionRequestId += 1
    state.isSessionReady = false
    resetTypingState()
    resetDrawGuessUi()
    resetVoiceState()
    clearAllOnlineUsers()
    const reason = error && (error.message || error.description || error.type)
    const label = reason ? `Connection error (${reason})` : "Connection error"
    setStatus(label, false)
    clearRolePanels()
    permMemberView.checked = true
    permMemberSend.checked = true
    updateChannelActionState()
  })
}

export { bindSocketHandlers }
