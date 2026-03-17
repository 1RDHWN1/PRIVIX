const USERNAME_KEY = "privix_username"
const SERVER_KEY = "privix_server_id"
const CHANNEL_KEY = "privix_channel"
const MAX_MESSAGE_LENGTH = 2000
const CHANNEL_NAME_PATTERN = /^[a-z0-9-]+$/
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
  SERVER_KEY,
  CHANNEL_KEY,
  MAX_MESSAGE_LENGTH,
  CHANNEL_NAME_PATTERN,
  ROLE_PERMISSIONS
}
