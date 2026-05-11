import { mentionSuggest, msgInput } from "./dom.js"
import { state } from "./state.js"

const MAX_MENTION_SUGGESTIONS = 6

let mentionRange = null
let mentionItems = []
let activeIndex = 0
let isBound = false

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase()
}

function closeMentionSuggestions() {
  mentionRange = null
  mentionItems = []
  activeIndex = 0
  if (!mentionSuggest) return
  mentionSuggest.hidden = true
  mentionSuggest.textContent = ""
}

function findMentionRange(value, caret) {
  const text = String(value || "")
  const cursor = Number(caret)
  if (!Number.isInteger(cursor) || cursor < 0) return null
  const beforeCaret = text.slice(0, cursor)
  const match = beforeCaret.match(/(^|\s)@([A-Za-z0-9_.-]{0,32})$/)
  if (!match) return null
  const query = String(match[2] || "")
  const start = cursor - query.length - 1
  if (start < 0) return null
  return { start, end: cursor, query }
}

function getMentionCandidates(queryText) {
  const query = normalizeKey(queryText)
  const source = Array.isArray(state.membersCache) ? state.membersCache : []
  const seen = new Set()
  const filtered = []

  source.forEach((item) => {
    const username = String(item && item.username || "").trim()
    const usernameKey = normalizeKey(username)
    if (!username || !usernameKey || seen.has(usernameKey)) return
    if (query && !usernameKey.includes(query)) return
    seen.add(usernameKey)
    filtered.push({
      username,
      usernameKey,
      isOnline: Boolean(item && item.is_online)
    })
  })

  filtered.sort((a, b) => {
    const aStarts = query ? a.usernameKey.startsWith(query) : false
    const bStarts = query ? b.usernameKey.startsWith(query) : false
    if (aStarts !== bStarts) return aStarts ? -1 : 1
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1
    return a.username.localeCompare(b.username)
  })

  return filtered.slice(0, MAX_MENTION_SUGGESTIONS)
}

function renderMentionSuggestions() {
  if (!mentionSuggest) return
  if (!mentionItems.length) {
    closeMentionSuggestions()
    return
  }

  mentionSuggest.textContent = ""
  mentionSuggest.hidden = false
  mentionItems.forEach((item, index) => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "mention-suggest-item"
    if (index === activeIndex) {
      button.classList.add("is-active")
    }
    button.dataset.index = String(index)
    button.setAttribute("aria-label", `Mention ${item.username}`)

    const name = document.createElement("span")
    name.className = "mention-suggest-name"
    name.textContent = item.username

    const status = document.createElement("span")
    status.className = "mention-suggest-status"
    status.classList.add(item.isOnline ? "is-online" : "is-offline")
    status.setAttribute("aria-label", item.isOnline ? "Online" : "Offline")
    status.title = item.isOnline ? "Online" : "Offline"

    button.appendChild(name)
    button.appendChild(status)
    mentionSuggest.appendChild(button)
  })
}

function applyMentionByIndex(index) {
  if (!msgInput || !mentionRange || !mentionItems.length) return false
  const safeIndex = Math.max(0, Math.min(index, mentionItems.length - 1))
  const picked = mentionItems[safeIndex]
  if (!picked) return false

  const value = String(msgInput.value || "")
  const before = value.slice(0, mentionRange.start)
  const after = value.slice(mentionRange.end)
  msgInput.value = `${before}@${picked.username} ${after}`
  const nextCaret = before.length + picked.username.length + 2
  msgInput.setSelectionRange(nextCaret, nextCaret)
  closeMentionSuggestions()
  msgInput.focus()
  return true
}

function updateMentionSuggestions() {
  if (!msgInput || !mentionSuggest) return
  const range = findMentionRange(msgInput.value, msgInput.selectionStart)
  if (!range) {
    closeMentionSuggestions()
    return
  }

  const items = getMentionCandidates(range.query)
  if (!items.length) {
    closeMentionSuggestions()
    return
  }

  mentionRange = range
  mentionItems = items
  activeIndex = 0
  renderMentionSuggestions()
}

function handleMentionKeydown(event) {
  if (!mentionSuggest || mentionSuggest.hidden || !mentionItems.length) return false
  const key = String(event && event.key || "")

  if (key === "ArrowDown") {
    event.preventDefault()
    activeIndex = (activeIndex + 1) % mentionItems.length
    renderMentionSuggestions()
    return true
  }
  if (key === "ArrowUp") {
    event.preventDefault()
    activeIndex = (activeIndex - 1 + mentionItems.length) % mentionItems.length
    renderMentionSuggestions()
    return true
  }
  if (key === "Enter" || key === "Tab") {
    event.preventDefault()
    return applyMentionByIndex(activeIndex)
  }
  if (key === "Escape") {
    event.preventDefault()
    closeMentionSuggestions()
    return true
  }
  return false
}

function bindMentionSuggestionEvents() {
  if (isBound || !mentionSuggest) return
  isBound = true

  mentionSuggest.addEventListener("mousedown", (event) => {
    event.preventDefault()
  })

  mentionSuggest.addEventListener("click", (event) => {
    const button = event.target.closest(".mention-suggest-item")
    if (!button) return
    const index = Number(button.dataset.index)
    if (!Number.isInteger(index)) return
    applyMentionByIndex(index)
  })

  document.addEventListener("click", (event) => {
    const target = event.target
    if (target instanceof Element && (target === mentionSuggest || mentionSuggest.contains(target))) return
    if (target instanceof Element && target === msgInput) return
    closeMentionSuggestions()
  })

  if (msgInput) {
    msgInput.addEventListener("blur", () => {
      setTimeout(() => {
        closeMentionSuggestions()
      }, 120)
    })
  }
}

function initMentionSuggestions() {
  bindMentionSuggestionEvents()
  closeMentionSuggestions()
}

export {
  initMentionSuggestions,
  updateMentionSuggestions,
  handleMentionKeydown,
  closeMentionSuggestions
}
