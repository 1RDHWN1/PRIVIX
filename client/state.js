const state = {
  username: "",
  currentUserId: null,
  isSessionReady: false,
  sessionRequestId: 0,
  serversCache: [],
  membersCache: [],
  onlineUsersByServer: new Map(),
  auditLogsCache: [],
  inviteShareUrl: "",
  pendingInviteCodeFromUrl: "",
  inviteAutoJoinAttempted: false,
  typingStopTimer: null,
  isTypingSent: false,
  typingUsers: new Set(),
  replyDraft: null,
  seenMentionMessageIds: new Set(),
  readMentionMessageIds: new Set()
}

export { state }
