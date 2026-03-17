import { typingIndicator } from "../dom.js"
import { state } from "../state.js"

function renderTypingIndicator() {
  if (!typingIndicator) return
  const names = [...state.typingUsers]
  if (names.length === 0) {
    typingIndicator.textContent = ""
    typingIndicator.classList.remove("show")
    return
  }

  let text = ""
  if (names.length === 1) {
    text = `${names[0]} is typing...`
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing...`
  } else {
    const othersCount = names.length - 2
    text = `${names[0]}, ${names[1]} and ${othersCount} others are typing...`
  }
  typingIndicator.textContent = text
  typingIndicator.classList.add("show")
}

export { renderTypingIndicator }
