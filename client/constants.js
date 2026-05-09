const USERNAME_KEY = "privix_username"
const USER_AUTH_TOKENS_KEY = "privix_user_auth_tokens"
const SERVER_KEY = "privix_server_id"
const CHANNEL_KEY = "privix_channel"
const MAX_MESSAGE_LENGTH = 2000
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
  SERVER_KEY,
  CHANNEL_KEY,
  MAX_MESSAGE_LENGTH,
  CHANNEL_NAME_PATTERN,
  CHANNEL_TYPE_TEXT,
  CHANNEL_TYPE_VOICE,
  CHANNEL_TYPES,
  ROLE_PERMISSIONS
}
