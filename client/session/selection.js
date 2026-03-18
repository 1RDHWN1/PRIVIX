import {
  msgInput,
  sendBtn,
  serverSelect,
  channelSelect,
  activeServerName,
  activeChannelName,
  activeChannelType,
  chatRoot,
  sectionChannels,
  sectionMembers,
  sectionAudit,
  rowServerLeave,
  rowTransferOwner,
  rowInviteActions,
  rowChannelCreate,
  rowChannelManage,
  rowChannelPermView,
  rowChannelPermSend,
  rowMemberTarget,
  rowMemberRoleMain,
  rowMemberRoleDemote,
  rowMemberKick,
  rowMemberMuteConfig,
  rowMemberMute,
  renameServerBtn,
  transferOwnerBtn,
  regenInviteBtn,
  copyInviteBtn,
  createChannelBtn,
  createServerBtn,
  renameChannelBtn,
  deleteChannelBtn,
  promoteBtn,
  modBtn,
  demoteBtn,
  kickBtn,
  muteBtn,
  unmuteBtn,
  joinInviteBtn,
  getInviteBtn,
  leaveServerBtn,
  ownerUsernameInput,
  savePermBtn,
  memberFilterInput,
  auditFilterSelect,
  auditSearchInput,
  memberUsernameInput,
  muteDurationSelect,
  muteReasonInput,
  permMemberView,
  permMemberSend,
  noServerHint,
  invitePreview
} from "../dom.js"
import { SERVER_KEY, CHANNEL_KEY, CHANNEL_TYPE_VOICE } from "../constants.js"
import { state } from "../state.js"
import { setChannelOptions, setElementHidden, setSoftButtonHidden } from "../ui.js"
import { hasServerPermission, canLeaveServer, isServerOwner } from "../permissions.js"
import { getCurrentUserMuteInfo, refreshMuteButtonLabel } from "../members.js"
import { formatMuteRemaining } from "../utils.js"
import { socket } from "../socket.js"
import { setVoiceContext } from "../voice.js"

function getActiveServer() {
  const selected = Number(serverSelect.value)
  if (!Number.isInteger(selected) || selected <= 0) return null
  return state.serversCache.find((item) => item.id === selected) || null
}

function applySelectionFromStorage() {
  const savedServerId = Number(localStorage.getItem(SERVER_KEY))
  const hasSavedServer = Number.isInteger(savedServerId) && savedServerId > 0
  const selectedServer =
    (hasSavedServer && state.serversCache.find((item) => item.id === savedServerId)) ||
    state.serversCache[0] ||
    null

  if (!selectedServer) {
    serverSelect.innerHTML = ""
    channelSelect.innerHTML = ""
    updateChannelActionState()
    return false
  }

  serverSelect.value = String(selectedServer.id)
  const channels = Array.isArray(selectedServer.channels) ? selectedServer.channels : []
  setChannelOptions(channels)

  const savedChannel = localStorage.getItem(CHANNEL_KEY)
  const channelExists = channels.some((item) => item.name === savedChannel)
  if (channelExists) {
    channelSelect.value = savedChannel
  } else if (channelSelect.options.length > 0) {
    channelSelect.selectedIndex = 0
  }

  localStorage.setItem(SERVER_KEY, String(selectedServer.id))
  if (channelSelect.value) {
    localStorage.setItem(CHANNEL_KEY, channelSelect.value)
  }
  updateChannelActionState()
  return true
}

function getActiveChannelInfo() {
  const activeServer = getActiveServer()
  if (!activeServer) return null
  const channelName = channelSelect.value
  if (!channelName) return null
  const channels = Array.isArray(activeServer.channels) ? activeServer.channels : []
  return channels.find((item) => item.name === channelName) || null
}

function updateChannelActionState() {
  const activeChannel = channelSelect.value
  const hasChannel = Boolean(activeChannel)
  const activeServer = getActiveServer()
  const hasServer = Boolean(activeServer)
  const activeChannelInfo = getActiveChannelInfo()
  const isVoiceChannel = activeChannelInfo && activeChannelInfo.type === CHANNEL_TYPE_VOICE
  const canManageRoles = hasServer && hasServerPermission("member.role.set", activeServer)
  const canMuteMembers = hasServer && hasServerPermission("member.mute", activeServer)
  const canKickMembers = hasServer && hasServerPermission("member.kick", activeServer)
  const canRenameServer = hasServer && hasServerPermission("server.rename", activeServer)
  const canTransferOwner =
    hasServer &&
    hasServerPermission("server.owner.transfer", activeServer) &&
    isServerOwner(activeServer)
  const canCreateChannel = hasServer && hasServerPermission("channel.create", activeServer)
  const canRenameChannel = hasServer && hasServerPermission("channel.rename", activeServer)
  const canDeleteChannel = hasServer && hasServerPermission("channel.delete", activeServer)
  const canSetChannelPerm = hasServer && hasServerPermission("channel.permission.set", activeServer)
  const canGetInvite = hasServer && hasServerPermission("invite.get", activeServer)
  const canRegenInvite = hasServer && hasServerPermission("invite.regenerate", activeServer)
  const canLeaveActiveServer = hasServer && canLeaveServer(activeServer)

  setElementHidden(sectionChannels, !hasServer)
  setElementHidden(sectionMembers, !hasServer)
  setElementHidden(sectionAudit, !hasServer)
  setElementHidden(rowServerLeave, !hasServer)
  setElementHidden(rowTransferOwner, !hasServer || !canTransferOwner)
  setElementHidden(rowInviteActions, !hasServer || !canGetInvite)
  setElementHidden(invitePreview, !hasServer || !canGetInvite)
  setElementHidden(rowChannelCreate, !hasServer || !canCreateChannel)
  setElementHidden(rowChannelManage, !hasServer || (!canRenameChannel && !canDeleteChannel))
  setElementHidden(rowChannelPermView, !hasServer || !canSetChannelPerm)
  setElementHidden(rowChannelPermSend, !hasServer || !canSetChannelPerm)
  setElementHidden(rowMemberTarget, !hasServer || (!canManageRoles && !canMuteMembers && !canKickMembers))
  setElementHidden(rowMemberRoleMain, !hasServer || !canManageRoles)
  setElementHidden(rowMemberRoleDemote, !hasServer || !canManageRoles)
  setElementHidden(rowMemberKick, !hasServer || !canKickMembers)
  setElementHidden(rowMemberMuteConfig, !hasServer || !canMuteMembers)
  setElementHidden(rowMemberMute, !hasServer || !canMuteMembers)

  setSoftButtonHidden(renameServerBtn, !hasServer || !canRenameServer)
  setSoftButtonHidden(transferOwnerBtn, !hasServer || !canTransferOwner)
  setSoftButtonHidden(regenInviteBtn, !hasServer || !canRegenInvite)
  setSoftButtonHidden(createChannelBtn, !hasServer || !canCreateChannel)
  setSoftButtonHidden(renameChannelBtn, !hasServer || !canRenameChannel)
  setSoftButtonHidden(deleteChannelBtn, !hasServer || !canDeleteChannel)
  setSoftButtonHidden(promoteBtn, !hasServer || !canManageRoles)
  setSoftButtonHidden(modBtn, !hasServer || !canManageRoles)
  setSoftButtonHidden(demoteBtn, !hasServer || !canManageRoles)
  setSoftButtonHidden(kickBtn, !hasServer || !canKickMembers)
  setSoftButtonHidden(muteBtn, !hasServer || !canMuteMembers)
  setSoftButtonHidden(unmuteBtn, !hasServer || !canMuteMembers)

  createServerBtn.disabled = !socket.connected
  createChannelBtn.disabled = !socket.connected || !canCreateChannel
  renameChannelBtn.disabled =
    !socket.connected || !canRenameChannel || !hasChannel || activeChannel === "general"
  deleteChannelBtn.disabled =
    !socket.connected || !canDeleteChannel || !hasChannel || activeChannel === "general"
  joinInviteBtn.disabled = !socket.connected
  getInviteBtn.disabled = !socket.connected || !canGetInvite
  regenInviteBtn.disabled = !socket.connected || !canRegenInvite
  copyInviteBtn.disabled = !socket.connected || !canGetInvite || !state.inviteShareUrl
  renameServerBtn.disabled = !socket.connected || !canRenameServer
  leaveServerBtn.disabled = !socket.connected || !canLeaveActiveServer
  transferOwnerBtn.disabled = !socket.connected || !canTransferOwner
  ownerUsernameInput.disabled = !socket.connected || !canTransferOwner
  promoteBtn.disabled = !socket.connected || !canManageRoles
  modBtn.disabled = !socket.connected || !canManageRoles
  demoteBtn.disabled = !socket.connected || !canManageRoles
  kickBtn.disabled = !socket.connected || !canKickMembers
  muteBtn.disabled = !socket.connected || !canMuteMembers
  unmuteBtn.disabled = !socket.connected || !canMuteMembers
  savePermBtn.disabled = !socket.connected || !canSetChannelPerm || !hasChannel
  memberFilterInput.disabled = !hasServer
  auditFilterSelect.disabled = !hasServer
  auditSearchInput.disabled = !hasServer
  memberUsernameInput.disabled = !socket.connected || (!canManageRoles && !canMuteMembers && !canKickMembers)
  muteDurationSelect.disabled = !socket.connected || !canMuteMembers
  muteReasonInput.disabled = !socket.connected || !canMuteMembers
  refreshMuteButtonLabel()
  permMemberView.disabled = !socket.connected || !canSetChannelPerm
  permMemberSend.disabled = !socket.connected || !canSetChannelPerm
  const muteInfo = hasServer ? getCurrentUserMuteInfo() : { isMuted: false, mutedUntilTs: 0, muteReason: "" }
  if (isVoiceChannel) {
    msgInput.disabled = true
    sendBtn.disabled = true
    msgInput.placeholder = "Voice channel"
  } else if (muteInfo.isMuted) {
    const reasonText = muteInfo.muteReason ? ` (${muteInfo.muteReason})` : ""
    msgInput.disabled = true
    sendBtn.disabled = true
    msgInput.placeholder = `Muted ${formatMuteRemaining(muteInfo.mutedUntilTs)}${reasonText}`
  } else {
    msgInput.disabled = !socket.connected || !hasServer || !state.isSessionReady
    sendBtn.disabled = !socket.connected || !hasServer || !state.isSessionReady
    msgInput.placeholder = "message"
  }
  if (noServerHint) {
    noServerHint.hidden = hasServer
  }

  if (activeServerName) {
    activeServerName.textContent = activeServer ? activeServer.name : "No Server"
  }
  if (activeChannelName) {
    if (activeChannel) {
      activeChannelName.textContent = isVoiceChannel ? `voice ${activeChannel}` : `# ${activeChannel}`
    } else {
      activeChannelName.textContent = "# channel"
    }
  }
  if (activeChannelType) {
    activeChannelType.textContent = isVoiceChannel ? "voice" : "text"
  }
  if (chatRoot) {
    chatRoot.classList.toggle("is-voice", Boolean(isVoiceChannel))
  }

  const canSpeak =
    hasServer &&
    !muteInfo.isMuted &&
    (hasServerPermission("channel.permission.set", activeServer) || permMemberSend.checked)

  setVoiceContext({
    isVoiceChannel,
    serverId: activeServer ? activeServer.id : null,
    channelName: activeChannel,
    canSpeak,
    isReady: state.isSessionReady,
    isConnected: socket.connected
  })
}

export { getActiveServer, applySelectionFromStorage, getActiveChannelInfo, updateChannelActionState }
