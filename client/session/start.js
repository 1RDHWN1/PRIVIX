import {
  msgInput,
  usernameInput,
  inviteCodeInput,
  channelSelect,
  messages,
  permMemberView,
  permMemberSend
} from "../dom.js"
import { USERNAME_KEY, SERVER_KEY, CHANNEL_KEY } from "../constants.js"
import { state } from "../state.js"
import { setStatus, notify } from "../notice.js"
import {
  setInvitePreview,
  renderNoServerEmptyState,
  setServerOptions,
  renderMessage,
  resetMessageJumpState,
  scrollMessageListToBottom
} from "../ui.js"
import { buildConnectedStatus } from "../permissions.js"
import {
  fetchServersWithTimeout,
  setUsernameWithTimeout,
  joinServerChannelWithTimeout,
  setRichStatusWithTimeout,
  getChannelPermissionWithTimeout,
  fetchMembersForServer
} from "../api.js"
import { setMembers } from "../members.js"
import { setAuditLogs } from "../audit.js"
import { resetTypingState } from "../typing.js"
import { socket } from "../socket.js"
import { getAuthTokenForUsername, storeAuthTokenForUsername } from "../auth.js"
import { clearReplyDraft } from "../reply.js"
import {
  getActiveServer,
  applySelectionFromStorage,
  updateChannelActionState
} from "./selection.js"
import { clearRolePanels } from "./roles.js"

let autoJoinInviteHandler = null

function setAutoJoinInviteHandler(handler) {
  autoJoinInviteHandler = typeof handler === "function" ? handler : null
}

async function loadChannelPermission(serverId, channelName) {
  try {
    const permission = await getChannelPermissionWithTimeout(serverId, channelName)
    permMemberView.checked = Boolean(permission.can_view)
    permMemberSend.checked = Boolean(permission.can_send)
  } catch {
    permMemberView.checked = true
    permMemberSend.checked = true
  }
}

async function startSessionForSelectedChannel(showAlertOnFailure = true, onReady) {
  const requestId = ++state.sessionRequestId
  const nextUsername = String(usernameInput.value || state.username || "").trim()
  if (nextUsername && usernameInput.value !== nextUsername) {
    usernameInput.value = nextUsername
  }
  resetTypingState({ notifyServer: true })
  clearReplyDraft()
  state.seenMentionMessageIds.clear()
  state.readMentionMessageIds.clear()
  resetMessageJumpState()
  setInvitePreview("")
  setStatus("Joining channel...", false)

  if (!socket.connected) {
    state.isSessionReady = false
    setStatus("Disconnected", false)
    const errorMessage = "Server chat belum terhubung. Jalankan server lalu refresh."
    if (showAlertOnFailure) {
      notify(errorMessage)
    }
    return { ok: false, error: errorMessage }
  }

  if (!nextUsername) {
    state.isSessionReady = false
    setStatus("Username required", false)
    const errorMessage = "Masukkan username dulu"
    if (showAlertOnFailure) {
      notify(errorMessage)
    }
    return { ok: false, error: errorMessage }
  }

  try {
    const authToken = getAuthTokenForUsername(nextUsername)
    const userResult = await setUsernameWithTimeout(nextUsername, authToken)
    if (requestId !== state.sessionRequestId) return { ok: false, error: "" }

    state.username = userResult.username
    state.currentUserId = Number(userResult.user_id) || null
    if (userResult.auth_token) {
      storeAuthTokenForUsername(state.username, userResult.auth_token)
    }
    try {
      await setRichStatusWithTimeout({
        status_key: state.richStatus.status_key,
        status_text: state.richStatus.status_text
      })
    } catch {}
    localStorage.setItem(USERNAME_KEY, state.username)

    state.serversCache = await fetchServersWithTimeout()
    if (requestId !== state.sessionRequestId) return { ok: false, error: "" }

    setServerOptions(state.serversCache)
    const hasSelection = applySelectionFromStorage()
    if (!hasSelection) {
      state.isSessionReady = false
      setStatus("Belum join server • masuk pakai invite code", false)
      renderNoServerEmptyState()
      updateChannelActionState()
      window.dispatchEvent(new CustomEvent("privix:no-channel"))
      if (state.pendingInviteCodeFromUrl && !state.inviteAutoJoinAttempted) {
        state.inviteAutoJoinAttempted = true
        inviteCodeInput.value = state.pendingInviteCodeFromUrl
        setTimeout(() => {
          if (socket.connected && typeof autoJoinInviteHandler === "function") {
            autoJoinInviteHandler()
          }
        }, 0)
      }
      return { ok: true }
    }

    const activeServer = getActiveServer()
    const activeChannel = channelSelect.value
    if (!activeServer || !activeChannel) {
      state.isSessionReady = false
      setStatus("No channel available", false)
      messages.innerHTML = ""
      resetMessageJumpState()
      updateChannelActionState()
      window.dispatchEvent(new CustomEvent("privix:no-channel"))
      return { ok: true }
    }

    const joinResult = await joinServerChannelWithTimeout(activeServer.id, activeChannel)
    if (requestId !== state.sessionRequestId) return { ok: false, error: "" }

    await loadChannelPermission(activeServer.id, activeChannel)
    if (requestId !== state.sessionRequestId) return { ok: false, error: "" }

    try {
      const members = await fetchMembersForServer(activeServer.id)
      if (requestId !== state.sessionRequestId) return { ok: false, error: "" }
      setMembers(members)
    } catch {
      setMembers([])
    }

    setAuditLogs([])

    messages.innerHTML = ""
    const historyMessages = Array.isArray(joinResult.history) ? joinResult.history : []
    historyMessages.forEach((row) => {
      renderMessage(row, { animate: false })
    })
    scrollMessageListToBottom("auto")

    state.isSessionReady = true
    localStorage.setItem(SERVER_KEY, String(activeServer.id))
    localStorage.setItem(CHANNEL_KEY, activeChannel)
    setStatus(buildConnectedStatus(activeServer, activeChannel), true)
    updateChannelActionState()
    window.dispatchEvent(new CustomEvent("privix:channel-ready"))
    msgInput.focus()

    if (typeof onReady === "function") {
      onReady()
    }
    return { ok: true }
  } catch (error) {
    if (requestId !== state.sessionRequestId) return { ok: false, error: "" }
    state.isSessionReady = false
    setStatus("Join failed", false)
    const errorMessage = error.message || "Gagal join channel"
    if (showAlertOnFailure) {
      notify(errorMessage)
    }
    clearRolePanels()
    permMemberView.checked = true
    permMemberSend.checked = true
    updateChannelActionState()
    return { ok: false, error: errorMessage }
  }
}

export { setAutoJoinInviteHandler, loadChannelPermission, startSessionForSelectedChannel }
