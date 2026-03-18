const msgInput = document.getElementById("msg")
const sendBtn = document.getElementById("send-btn")
const serverSelect = document.getElementById("server-select")
const serverList = document.getElementById("server-list")
const activeServerName = document.getElementById("active-server-name")
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
const channelList = document.getElementById("channel-list")
const activeChannelName = document.getElementById("active-channel-name")
const activeChannelType = document.getElementById("active-channel-type")
const mobileBackBtn = document.getElementById("mobile-back-btn")
const chatRoot = document.querySelector(".chat")
const channelNameInput = document.getElementById("channel-name")
const channelTypeSelect = document.getElementById("channel-type")
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
const memberOnlineSummary = document.getElementById("member-online-summary")
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
const usernamePortal = document.getElementById("username-portal")
const usernamePortalInput = document.getElementById("username-portal-input")
const usernamePortalBtn = document.getElementById("username-portal-btn")
const usernamePortalError = document.getElementById("username-portal-error")
const voicePanel = document.getElementById("voice-panel")
const voiceStatus = document.getElementById("voice-status")
const voiceNetworkPill = document.getElementById("voice-network-pill")
const voiceNetworkLatency = document.getElementById("voice-network-latency")
const voiceJoinBtn = document.getElementById("voice-join-btn")
const voiceLeaveBtn = document.getElementById("voice-leave-btn")
const voiceMuteBtn = document.getElementById("voice-mute-btn")
const voiceStage = document.getElementById("voice-stage")
const voiceStageGrid = document.getElementById("voice-stage-grid")
const voiceStageTitle = document.getElementById("voice-stage-title")
const voiceStageSubtitle = document.getElementById("voice-stage-subtitle")
const voiceJoinHeroBtn = document.getElementById("voice-join-hero")
const voiceRoster = document.getElementById("voice-roster")
const voiceQuality = document.getElementById("voice-quality")
const voiceSettingsToggleBtn = document.getElementById("voice-settings-toggle")
const voiceSettingsPopover = document.getElementById("voice-settings-popover")
const voiceInputDeviceSelect = document.getElementById("voice-input-device")
const voiceOutputDeviceSelect = document.getElementById("voice-output-device")
const voiceOutputRow = document.getElementById("voice-output-row")
const voiceOutputVolumeSlider = document.getElementById("voice-output-volume")
const voiceOutputVolumeValue = document.getElementById("voice-output-volume-value")
const voiceInputGainSlider = document.getElementById("voice-input-gain")
const voiceInputGainValue = document.getElementById("voice-input-gain-value")
const voicePttToggle = document.getElementById("voice-ptt-toggle")
const voicePttKeyLabel = document.getElementById("voice-ptt-key")
const voicePttSetKeyBtn = document.getElementById("voice-ptt-setkey")
const voiceAutoJoinToggle = document.getElementById("voice-auto-join")
const voiceAudio = document.getElementById("voice-audio")

export {
  msgInput,
  sendBtn,
  serverSelect,
  serverList,
  activeServerName,
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
  channelList,
  activeChannelName,
  activeChannelType,
  mobileBackBtn,
  chatRoot,
  channelNameInput,
  channelTypeSelect,
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
  memberOnlineSummary,
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
  noticeOk,
  usernamePortal,
  usernamePortalInput,
  usernamePortalBtn,
  usernamePortalError,
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
  voiceQuality,
  voiceSettingsToggleBtn,
  voiceSettingsPopover,
  voiceInputDeviceSelect,
  voiceOutputDeviceSelect,
  voiceOutputRow,
  voiceOutputVolumeSlider,
  voiceOutputVolumeValue,
  voiceInputGainSlider,
  voiceInputGainValue,
  voicePttToggle,
  voicePttKeyLabel,
  voicePttSetKeyBtn,
  voiceAutoJoinToggle,
  voiceAudio
}
