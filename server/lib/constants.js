const MAX_USERNAME_LENGTH = 32
const MAX_CHANNEL_LENGTH = 32
const MAX_MESSAGE_LENGTH = 2000
const MAX_SERVER_NAME_LENGTH = 60
const CHANNEL_NAME_PATTERN = /^[a-z0-9-]+$/

const ROLE_PRIORITY = {
  admin: 100,
  moderator: 50,
  member: 1
}

const ROLE_PERMISSIONS = {
  admin: [
    "server.members.list",
    "audit.list",
    "member.role.set",
    "member.mute",
    "member.kick",
    "server.rename",
    "server.owner.transfer",
    "channel.create",
    "channel.rename",
    "channel.delete",
    "channel.permission.view",
    "channel.permission.set",
    "invite.get",
    "invite.regenerate"
  ],
  moderator: [
    "server.members.list",
    "audit.list",
    "member.mute",
    "member.kick",
    "channel.create",
    "channel.rename",
    "channel.delete",
    "channel.permission.view",
    "channel.permission.set",
    "invite.get"
  ],
  member: [
    "server.members.list",
    "audit.list",
    "channel.permission.view",
    "invite.get"
  ]
}

const PERMISSION_LABELS = {
  "server.members.list": "melihat daftar member server",
  "audit.list": "melihat audit log",
  "member.role.set": "mengubah role member",
  "member.mute": "mute member",
  "member.kick": "mengeluarkan member",
  "server.rename": "rename server",
  "server.owner.transfer": "transfer owner server",
  "channel.create": "membuat channel",
  "channel.rename": "rename channel",
  "channel.delete": "menghapus channel",
  "channel.permission.view": "melihat permission channel",
  "channel.permission.set": "mengubah permission channel",
  "invite.get": "mengambil invite code",
  "invite.regenerate": "regenerate invite code"
}

module.exports = {
  MAX_USERNAME_LENGTH,
  MAX_CHANNEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SERVER_NAME_LENGTH,
  CHANNEL_NAME_PATTERN,
  ROLE_PRIORITY,
  ROLE_PERMISSIONS,
  PERMISSION_LABELS
}
