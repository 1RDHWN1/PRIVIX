import { serverSelect, channelSelect } from "../dom.js"
import { getRoleBadge, getServerRoleName } from "../permissions.js"

function setServerOptions(servers) {
  serverSelect.innerHTML = ""
  servers.forEach((item) => {
    const option = document.createElement("option")
    option.value = String(item.id)
    const roleLabel = getRoleBadge(getServerRoleName(item))
    option.textContent = `${item.name} • ${roleLabel}`
    serverSelect.appendChild(option)
  })
}

function setChannelOptions(channels) {
  channelSelect.innerHTML = ""
  const sortedChannels = [...channels].sort((a, b) => {
    if (a.name === "general" && b.name !== "general") return -1
    if (a.name !== "general" && b.name === "general") return 1
    return a.name.localeCompare(b.name)
  })

  sortedChannels.forEach((item) => {
    const option = document.createElement("option")
    option.value = item.name
    option.textContent = `# ${item.name}`
    channelSelect.appendChild(option)
  })
}

export { setServerOptions, setChannelOptions }
