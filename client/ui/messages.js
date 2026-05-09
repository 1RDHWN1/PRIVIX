import { inviteCodeInput, messages, serverNameInput } from "../dom.js"
import { state } from "../state.js"
import { formatTime } from "../utils.js"
import { setStatus } from "../notice.js"
import { focusInviteInput } from "./invite.js"

function focusServerNameInput() {
  try {
    serverNameInput.scrollIntoView({ behavior: "smooth", block: "center" })
  } catch {}
  serverNameInput.focus()
  serverNameInput.select()
}

function getAvatarInitials(username) {
  const raw = String(username || "").trim()
  if (!raw) return "?"
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase()
}

function getAvatarTone(username) {
  const palettes = [
    ["#5f8cff", "#79d7ff"],
    ["#5fd3a1", "#7ce9c4"],
    ["#f08cb9", "#ffbc8d"],
    ["#9b7cff", "#6fbfff"],
    ["#ff8b7d", "#ffd16f"],
    ["#58c7d5", "#8df2ff"]
  ]
  const seed = Array.from(String(username || "")).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return palettes[seed % palettes.length]
}

function renderMessage(data, options = {}) {
  const animate = options.animate !== false
  const div = document.createElement("div")
  div.className = "chat-line"
  const isSelfMessage = String(data && data.username) === String(state.username)
  if (isSelfMessage) {
    div.classList.add("is-self")
  }
  if (animate) {
    div.classList.add("is-new")
    if (isSelfMessage) {
      div.classList.add("is-self-pulse")
    }
  }

  const [toneA, toneB] = getAvatarTone(data && data.username)
  const avatar = document.createElement("div")
  avatar.className = "chat-avatar"
  avatar.style.setProperty("--chat-avatar-a", toneA)
  avatar.style.setProperty("--chat-avatar-b", toneB)
  avatar.textContent = getAvatarInitials(data && data.username)

  const content = document.createElement("div")
  content.className = "chat-content"

  const meta = document.createElement("div")
  meta.className = "chat-meta"

  const user = document.createElement("b")
  user.className = "chat-author"
  user.textContent = data.username || "unknown"

  const time = document.createElement("small")
  time.className = "chat-timestamp"
  const friendlyTime = formatTime(data.created_at)
  time.textContent = friendlyTime || ""

  const text = document.createElement("div")
  text.className = "chat-bubble"
  text.textContent = data.message

  meta.appendChild(user)
  meta.appendChild(time)
  content.appendChild(meta)
  content.appendChild(text)
  div.appendChild(avatar)
  div.appendChild(content)
  messages.appendChild(div)
  if (animate) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        div.classList.remove("is-new")
      })
    })
    if (isSelfMessage) {
      setTimeout(() => {
        div.classList.remove("is-self-pulse")
      }, 700)
    }
  }
}

function renderNoServerEmptyState() {
  messages.innerHTML = ""
  const wrapper = document.createElement("div")
  wrapper.className = "messages-empty"

  const card = document.createElement("div")
  card.className = "messages-empty-card"

  const title = document.createElement("h3")
  title.className = "messages-empty-title"
  title.textContent = "Mulai dengan Server"

  const subtitle = document.createElement("p")
  subtitle.className = "messages-empty-subtitle"
  subtitle.textContent = "Buat server baru untuk ruang chat sendiri, atau tempel invite code kalau kamu sudah diundang."

  const actions = document.createElement("div")
  actions.className = "messages-empty-actions"

  const createAction = document.createElement("button")
  createAction.type = "button"
  createAction.className = "messages-empty-btn"
  createAction.textContent = "Buat Server"
  createAction.addEventListener("click", () => {
    focusServerNameInput()
    setStatus("Isi nama server lalu klik Create", false)
  })

  const inviteAction = document.createElement("button")
  inviteAction.type = "button"
  inviteAction.className = "messages-empty-btn is-secondary"
  inviteAction.textContent = "Pakai Invite"
  inviteAction.addEventListener("click", () => {
    focusInviteInput()
    if (!inviteCodeInput.value.trim()) {
      setStatus("Tempel invite code lalu klik Join", false)
    }
  })

  actions.appendChild(createAction)
  actions.appendChild(inviteAction)

  card.appendChild(title)
  card.appendChild(subtitle)
  card.appendChild(actions)
  wrapper.appendChild(card)
  messages.appendChild(wrapper)
}

export { renderMessage, renderNoServerEmptyState }
