const msgInput = document.getElementById("msg")
const sendBtn = document.getElementById("send-btn")
const serverSelect = document.getElementById("server-select")
const serverNameInput = document.getElementById("server-name")
const createServerBtn = document.getElementById("create-server-btn")
const renameServerBtn = document.getElementById("rename-server-btn")
const leaveServerBtn = document.getElementById("leave-server-btn")
const ownerUsernameInput = document.getElementById("owner-username")
const transferOwnerBtn = document.getElementById("transfer-owner-btn")
const noServerHint = document.getElementById("no-server-hint")
const sectionChannels = document.getElementById("section-channels")
const sectionMembers = document.getElementById("section-members")
const sectionAudit = document.getElementById("section-audit")
const rowServerLeave = document.getElementById("row-server-leave")
const rowTransferOwner = document.getElementById("row-transfer-owner")
const rowInviteActions = document.getElementById("row-invite-actions")
const rowChannelCreate = document.getElementById("row-channel-create")
const rowChannelManage = document.getElementById("row-channel-manage")
const rowChannelPermView = document.getElementById("row-channel-perm-view")
const rowChannelPermSend = document.getElementById("row-channel-perm-send")
const rowMemberTarget = document.getElementById("row-member-target")
const rowMemberRoleMain = document.getElementById("row-member-role-main")
const rowMemberRoleDemote = document.getElementById("row-member-role-demote")
const rowMemberKick = document.getElementById("row-member-kick")
const rowMemberMuteConfig = document.getElementById("row-member-mute-config")
const rowMemberMute = document.getElementById("row-member-mute")
const inviteCodeInput = document.getElementById("invite-code")
const joinInviteBtn = document.getElementById("join-invite-btn")
const getInviteBtn = document.getElementById("get-invite-btn")
const regenInviteBtn = document.getElementById("regen-invite-btn")
const copyInviteBtn = document.getElementById("copy-invite-btn")
const invitePreview = document.getElementById("invite-preview")
const channelSelect = document.getElementById("channel")
const channelNameInput = document.getElementById("channel-name")
const createChannelBtn = document.getElementById("create-channel-btn")
const renameChannelBtn = document.getElementById("rename-channel-btn")
const deleteChannelBtn = document.getElementById("delete-channel-btn")
const permMemberView = document.getElementById("perm-member-view")
const permMemberSend = document.getElementById("perm-member-send")
const savePermBtn = document.getElementById("save-perm-btn")
const messages = document.getElementById("messages")
const typingIndicator = document.getElementById("typing-indicator")
const usernameInput = document.getElementById("username")
const connectionStatus = document.getElementById("connection-status")
const memberList = document.getElementById("member-list")
const auditList = document.getElementById("audit-list")
const auditFilterSelect = document.getElementById("audit-filter")
const auditSearchInput = document.getElementById("audit-search")
const memberFilterInput = document.getElementById("member-filter")
const memberUsernameInput = document.getElementById("member-username")
const muteDurationSelect = document.getElementById("mute-duration")
const muteReasonInput = document.getElementById("mute-reason")
const promoteBtn = document.getElementById("promote-btn")
const modBtn = document.getElementById("mod-btn")
const demoteBtn = document.getElementById("demote-btn")
const kickBtn = document.getElementById("kick-btn")
const muteBtn = document.getElementById("mute-btn")
const unmuteBtn = document.getElementById("unmute-btn")
const noticeBackdrop = document.getElementById("notice-backdrop")
const noticeCard = document.getElementById("notice-card")
const noticeTitle = document.getElementById("notice-title")
const noticeMessage = document.getElementById("notice-message")
const noticeAction = document.getElementById("notice-action")
const noticeOk = document.getElementById("notice-ok")

export {
  msgInput,
  sendBtn,
  serverSelect,
  serverNameInput,
  createServerBtn,
  renameServerBtn,
  leaveServerBtn,
  ownerUsernameInput,
  transferOwnerBtn,
  noServerHint,
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
  inviteCodeInput,
  joinInviteBtn,
  getInviteBtn,
  regenInviteBtn,
  copyInviteBtn,
  invitePreview,
  channelSelect,
  channelNameInput,
  createChannelBtn,
  renameChannelBtn,
  deleteChannelBtn,
  permMemberView,
  permMemberSend,
  savePermBtn,
  messages,
  typingIndicator,
  usernameInput,
  connectionStatus,
  memberList,
  auditList,
  auditFilterSelect,
  auditSearchInput,
  memberFilterInput,
  memberUsernameInput,
  muteDurationSelect,
  muteReasonInput,
  promoteBtn,
  modBtn,
  demoteBtn,
  kickBtn,
  muteBtn,
  unmuteBtn,
  noticeBackdrop,
  noticeCard,
  noticeTitle,
  noticeMessage,
  noticeAction,
  noticeOk
}
