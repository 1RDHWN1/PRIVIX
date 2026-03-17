import { messages } from "../dom.js"
import { state } from "../state.js"
import { formatTime } from "../utils.js"
import { setStatus } from "../notice.js"
import { focusInviteInput } from "./invite.js"

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
  const user = document.createElement("b")
  user.textContent = `${data.username}: `
  const text = document.createElement("span")
  text.textContent = data.message
  const time = document.createElement("small")
  const friendlyTime = formatTime(data.created_at)
  time.textContent = friendlyTime ? ` (${friendlyTime})` : ""

  div.appendChild(user)
  div.appendChild(text)
  div.appendChild(time)
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
  title.textContent = "Belum Ada Server Aktif"

  const subtitle = document.createElement("p")
  subtitle.className = "messages-empty-subtitle"
  subtitle.textContent = "Join server pakai invite code, atau buat server baru dari panel kiri."

  const action = document.createElement("button")
  action.type = "button"
  action.className = "messages-empty-btn"
  action.textContent = "Join via Invite"
  action.addEventListener("click", () => {
    focusInviteInput()
    setStatus("Belum join server • masuk pakai invite code", false)
  })

  card.appendChild(title)
  card.appendChild(subtitle)
  card.appendChild(action)
  wrapper.appendChild(card)
  messages.appendChild(wrapper)
}

export { renderMessage, renderNoServerEmptyState }
