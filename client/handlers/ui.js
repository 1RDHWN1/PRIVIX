import {
  serverSelect,
  channelSelect,
  createChannelBtn,
  renameChannelBtn,
  deleteChannelBtn,
  joinInviteBtn,
  getInviteBtn,
  regenInviteBtn,
  renameServerBtn,
  createServerBtn,
  leaveServerBtn,
  transferOwnerBtn,
  promoteBtn,
  modBtn,
  demoteBtn,
  kickBtn,
  muteBtn,
  unmuteBtn,
  copyInviteBtn,
  savePermBtn,
  sendBtn,
  msgInput,
  channelNameInput,
  inviteCodeInput,
  serverNameInput,
  ownerUsernameInput,
  memberFilterInput,
  auditFilterSelect,
  auditSearchInput,
  muteDurationSelect,
  muteReasonInput,
  memberUsernameInput,
  usernameInput,
  messages
} from "../dom.js"
import { state } from "../state.js"
import { SERVER_KEY, CHANNEL_KEY } from "../constants.js"
import { notify } from "../notice.js"
import { setInvitePreview, setChannelOptions } from "../ui.js"
import { hasServerPermission } from "../permissions.js"
import {
  getActiveServer,
  startSessionForSelectedChannel,
  updateChannelActionState
} from "../session.js"
import { getFilteredMembers, renderMembers, refreshMuteButtonLabel } from "../members.js"
import { getFilteredAuditLogs, renderAuditLogs } from "../audit.js"
import {
  handleCreateChannel,
  handleDeleteChannel,
  handleJoinInvite,
  handleCreateServer,
  handleGetInvite,
  handleRegenInvite,
  handleRenameServer,
  handleTransferOwner,
  handleLeaveServer,
  handleRenameChannel,
  handleSetMemberRole,
  handleKickMember,
  handleMuteMember,
  handleUnmuteMember,
  handleSaveChannelPermission,
  send
} from "../actions.js"
import {
  sendTypingState,
  stopTypingStateTimer,
  queueTypingStop,
  resetTypingState
} from "../typing.js"

function bindUiHandlers() {
  serverSelect.addEventListener("change", () => {
    const activeServer = getActiveServer()
    if (!activeServer) return

    localStorage.setItem(SERVER_KEY, String(activeServer.id))
    setInvitePreview("")
    updateChannelActionState()
    setChannelOptions(activeServer.channels || [])
    if (channelSelect.value) {
      localStorage.setItem(CHANNEL_KEY, channelSelect.value)
    }
    resetTypingState({ notifyServer: true })
    messages.innerHTML = ""
    startSessionForSelectedChannel(true)
  })

  channelSelect.addEventListener("change", () => {
    localStorage.setItem(CHANNEL_KEY, channelSelect.value)
    resetTypingState({ notifyServer: true })
    messages.innerHTML = ""
    updateChannelActionState()
    startSessionForSelectedChannel(true)
  })

  createChannelBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleCreateChannel()
  })

  renameChannelBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleRenameChannel()
  })

  deleteChannelBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleDeleteChannel()
  })

  joinInviteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleJoinInvite()
  })

  getInviteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleGetInvite()
  })

  regenInviteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleRegenInvite()
  })

  renameServerBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleRenameServer()
  })

  createServerBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleCreateServer()
  })

  leaveServerBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleLeaveServer()
  })

  transferOwnerBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleTransferOwner()
  })

  promoteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleSetMemberRole("admin")
  })

  modBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleSetMemberRole("moderator")
  })

  demoteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleSetMemberRole("member")
  })

  kickBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleKickMember()
  })

  muteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleMuteMember()
  })

  unmuteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleUnmuteMember()
  })

  copyInviteBtn.addEventListener("click", async (e) => {
    e.preventDefault()
    if (!state.inviteShareUrl) {
      notify("Ambil invite dulu")
      return
    }
    try {
      await navigator.clipboard.writeText(state.inviteShareUrl)
      notify("Invite link berhasil disalin", "success")
    } catch {
      notify("Gagal menyalin invite link", "error")
    }
  })

  savePermBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleSaveChannelPermission()
  })

  sendBtn.addEventListener("click", (e) => {
    e.preventDefault()
    send()
  })

  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      send()
    }
  })

  msgInput.addEventListener("input", () => {
    if (!state.isSessionReady) {
      resetTypingState()
      return
    }

    const hasText = msgInput.value.trim().length > 0
    if (!hasText) {
      sendTypingState(false)
      stopTypingStateTimer()
      return
    }

    sendTypingState(true)
    queueTypingStop()
  })

  msgInput.addEventListener("blur", () => {
    sendTypingState(false)
    stopTypingStateTimer()
  })

  channelNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleCreateChannel()
    }
  })

  inviteCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleJoinInvite()
    }
  })

  serverNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const activeServer = getActiveServer()
      if (activeServer && hasServerPermission("server.rename", activeServer)) {
        handleRenameServer()
        return
      }
      handleCreateServer()
    }
  })

  ownerUsernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleTransferOwner()
    }
  })

  memberFilterInput.addEventListener("input", () => {
    renderMembers(getFilteredMembers())
  })

  auditFilterSelect.addEventListener("change", () => {
    renderAuditLogs(getFilteredAuditLogs())
  })

  auditSearchInput.addEventListener("input", () => {
    renderAuditLogs(getFilteredAuditLogs())
  })

  muteDurationSelect.addEventListener("change", () => {
    refreshMuteButtonLabel()
  })

  muteReasonInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleMuteMember()
    }
  })

  memberUsernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const activeServer = getActiveServer()
      const canManageRoles = activeServer && hasServerPermission("member.role.set", activeServer)
      const canMuteMembers = activeServer && hasServerPermission("member.mute", activeServer)
      const canKickMembers = activeServer && hasServerPermission("member.kick", activeServer)
      if (canManageRoles) {
        handleSetMemberRole("admin")
        return
      }
      if (canMuteMembers) {
        handleMuteMember()
        return
      }
      if (canKickMembers) {
        handleKickMember()
      }
    }
  })

  usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      startSessionForSelectedChannel(true)
    }
  })
}

export { bindUiHandlers }
