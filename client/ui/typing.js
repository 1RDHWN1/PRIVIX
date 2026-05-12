import { typingIndicator } from "../dom.js"
import { state } from "../state.js"

function renderTypingIndicator() {
  if (!typingIndicator) return
  const names = [...state.typingUsers]
  if (names.length === 0) {
    typingIndicator.textContent = ""
    typingIndicator.classList.remove("show")
    typingIndicator.removeAttribute("aria-label")
    return
  }

  let text = ""
  if (names.length === 1) {
    text = `${names[0]} lagi ngetik...`
  } else if (names.length === 2) {
    text = `${names[0]} dan ${names[1]} lagi ngetik...`
  } else {
    const othersCount = names.length - 2
    text = `${names[0]}, ${names[1]} + ${othersCount} orang lagi ngetik...`
  }

  typingIndicator.textContent = ""
  const row = document.createElement("div")
  row.className = "typing-indicator-row"

  const dots = document.createElement("span")
  dots.className = "typing-indicator-dots"
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span")
    dot.className = "typing-indicator-dot"
    dots.appendChild(dot)
  }

  const label = document.createElement("span")
  label.className = "typing-indicator-text"
  label.textContent = text

  row.appendChild(dots)
  row.appendChild(label)
  typingIndicator.appendChild(row)
  typingIndicator.setAttribute("aria-label", text)
  typingIndicator.classList.add("show")
}

export { renderTypingIndicator }
