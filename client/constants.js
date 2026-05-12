const USERNAME_KEY = "privix_username"
const USER_AUTH_TOKENS_KEY = "privix_user_auth_tokens"
const USER_RICH_STATUS_KEY = "privix_rich_status"
const SERVER_KEY = "privix_server_id"
const CHANNEL_KEY = "privix_channel"
const MAX_MESSAGE_LENGTH = 2000
const MAX_RICH_STATUS_TEXT_LENGTH = 60
const DEFAULT_RICH_STATUS_KEY = "online"
const RICH_STATUS_PRESETS = [
  { key: "online", label: "Online" },
  { key: "coding", label: "Lagi ngoding" },
  { key: "afk", label: "AFK" },
  { key: "gaming", label: "Main game" },
  { key: "busy", label: "Busy" }
]
const CHANNEL_NAME_PATTERN = /^[a-z0-9-]+$/
const CHANNEL_TYPE_TEXT = "text"
const CHANNEL_TYPE_VOICE = "voice"
const CHANNEL_TYPES = [CHANNEL_TYPE_TEXT, CHANNEL_TYPE_VOICE]
const ROLE_PERMISSIONS = {
  admin: [
    "member.role.set",
    "member.mute",
    "member.kick",
    "server.rename",
    "server.owner.transfer",
    "channel.create",
    "channel.rename",
    "channel.delete",
    "channel.permission.set",
    "invite.get",
    "invite.regenerate"
  ],
  moderator: [
    "member.mute",
    "member.kick",
    "channel.create",
    "channel.rename",
    "channel.delete",
    "channel.permission.set",
    "invite.get"
  ],
  member: ["invite.get"]
}

export {
  USERNAME_KEY,
  USER_AUTH_TOKENS_KEY,
  USER_RICH_STATUS_KEY,
  SERVER_KEY,
  CHANNEL_KEY,
  MAX_MESSAGE_LENGTH,
  MAX_RICH_STATUS_TEXT_LENGTH,
  DEFAULT_RICH_STATUS_KEY,
  RICH_STATUS_PRESETS,
  CHANNEL_NAME_PATTERN,
  CHANNEL_TYPE_TEXT,
  CHANNEL_TYPE_VOICE,
  CHANNEL_TYPES,
  ROLE_PERMISSIONS
}
