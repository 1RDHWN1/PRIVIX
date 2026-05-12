const state = {
  username: "",
  currentUserId: null,
  isSessionReady: false,
  sessionRequestId: 0,
  serversCache: [],
  membersCache: [],
  onlineUsersByServer: new Map(),
  onlinePresenceByServer: new Map(),
  auditLogsCache: [],
  inviteShareUrl: "",
  pendingInviteCodeFromUrl: "",
  inviteAutoJoinAttempted: false,
  typingStopTimer: null,
  isTypingSent: false,
  typingUsers: new Set(),
  replyDraft: null,
  richStatus: {
    status_key: "online",
    status_text: ""
  },
  seenMentionMessageIds: new Set(),
  readMentionMessageIds: new Set()
}

export { state }
