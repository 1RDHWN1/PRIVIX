import {
  inviteCodeInput,
  messages,
  msgInput,
  serverNameInput,
  chatJumpControls,
  chatJumpToMentionBtn,
  chatJumpMentionCount,
  chatJumpToBottomBtn
} from "../dom.js"
import { state } from "../state.js"
import { socket } from "../socket.js"
import { formatChatDateLabel, formatTime, getChatDateKey } from "../utils.js"
import { confirmNotice, notify, setStatus } from "../notice.js"
import { focusInviteInput } from "./invite.js"
import { clearReplyDraft, getReplyMessageId, setReplyDraft } from "../reply.js"

const MESSAGE_REACTION_EMOJIS = ["👍", "❤️", "😂", "🔥", "👏", "🎉"]
const CHAT_MENTION_PATTERN = /@([A-Za-z0-9_.-]{1,32})/g
const CHAT_BOTTOM_LOCK_THRESHOLD = 56
const CHAT_BOTTOM_CONTROL_THRESHOLD = 76
const MOBILE_ACTIONS_QUERY = "(max-width: 760px)"
let messageActionDismissBound = false
let chatJumpBound = false
const unreadMentionIds = new Set()
let unreadMentionOrder = []

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

function normalizeUserKey(value) {
  return String(value || "").trim().toLowerCase()
}

function isMobileActionLayout() {
  return Boolean(window.matchMedia && window.matchMedia(MOBILE_ACTIONS_QUERY).matches)
}

function messageMentionsUser(message, username) {
  const text = String(message || "")
  const target = normalizeUserKey(username)
  if (!text || !target) return false
  const mentionPattern = new RegExp(CHAT_MENTION_PATTERN.source, "g")
  let match
  while ((match = mentionPattern.exec(text))) {
    if (normalizeUserKey(match[1]) === target) {
      return true
    }
  }
  return false
}

function getMessageLineById(messageId) {
  const targetId = Number(messageId)
  if (!Number.isInteger(targetId) || targetId <= 0 || !messages) return null
  return messages.querySelector(`.chat-line[data-message-id="${targetId}"]`)
}

function getMessageBottomDistance() {
  if (!messages) return 0
  return Math.max(0, messages.scrollHeight - (messages.scrollTop + messages.clientHeight))
}

function isMessageListNearBottom(threshold = CHAT_BOTTOM_LOCK_THRESHOLD) {
  if (!messages) return true
  return getMessageBottomDistance() <= threshold
}

function scrollMessageListToBottom(behavior = "smooth") {
  if (!messages) return
  messages.scrollTo({
    top: messages.scrollHeight,
    behavior
  })
}

function isMessageLineVisible(line) {
  if (!line || !messages) return false
  const viewTop = messages.scrollTop
  const viewBottom = viewTop + messages.clientHeight
  const lineTop = line.offsetTop
  const lineBottom = lineTop + line.offsetHeight
  return lineBottom >= viewTop + 8 && lineTop <= viewBottom - 8
}

function trimUnreadMentionQueue() {
  unreadMentionOrder = unreadMentionOrder.filter((id) => unreadMentionIds.has(id))
}

function removeUnreadMention(messageId) {
  const targetId = Number(messageId)
  if (!Number.isInteger(targetId) || targetId <= 0) return
  state.readMentionMessageIds.add(targetId)
  unreadMentionIds.delete(targetId)
  unreadMentionOrder = unreadMentionOrder.filter((id) => id !== targetId)
}

function clearUnreadMentions() {
  unreadMentionOrder.forEach((messageId) => {
    const targetId = Number(messageId)
    if (Number.isInteger(targetId) && targetId > 0) {
      state.readMentionMessageIds.add(targetId)
    }
  })
  unreadMentionIds.clear()
  unreadMentionOrder = []
}

function consumeVisibleUnreadMentions() {
  if (!messages || unreadMentionOrder.length === 0) return
  const consumed = []
  unreadMentionOrder.forEach((messageId) => {
    const line = getMessageLineById(messageId)
    if (!line) {
      consumed.push(messageId)
      return
    }
    if (isMessageLineVisible(line)) {
      consumed.push(messageId)
    }
  })
  consumed.forEach((messageId) => removeUnreadMention(messageId))
}

function syncChatJumpControls() {
  if (!messages || !chatJumpControls || !chatJumpToBottomBtn || !chatJumpToMentionBtn || !chatJumpMentionCount) {
    return
  }
  trimUnreadMentionQueue()
  consumeVisibleUnreadMentions()
  if (isMessageListNearBottom()) {
    clearUnreadMentions()
  }

  const hasChatLines = Boolean(messages.querySelector(".chat-line"))
  const showBottom = hasChatLines && !isMessageListNearBottom(CHAT_BOTTOM_CONTROL_THRESHOLD)
  const unreadCount = unreadMentionOrder.length
  const showMention = unreadCount > 0

  chatJumpToBottomBtn.hidden = !showBottom
  chatJumpToMentionBtn.hidden = !showMention
  chatJumpMentionCount.hidden = !showMention
  chatJumpMentionCount.textContent = showMention ? String(unreadCount > 99 ? "99+" : unreadCount) : "0"
  chatJumpControls.hidden = !showBottom && !showMention
}

function flashMessageTarget(line, className) {
  if (!line || !className) return
  line.classList.add(className)
  setTimeout(() => {
    line.classList.remove(className)
  }, 1100)
}

function jumpToLatestUnreadMention() {
  if (!messages || unreadMentionOrder.length === 0) {
    scrollMessageListToBottom("smooth")
    return
  }
  const nextMessageId = [...unreadMentionOrder].reverse().find((messageId) => Boolean(getMessageLineById(messageId)))
  if (!nextMessageId) {
    clearUnreadMentions()
    syncChatJumpControls()
    return
  }
  const targetLine = getMessageLineById(nextMessageId)
  if (!targetLine) return
  clearUnreadMentions()
  syncChatJumpControls()
  targetLine.scrollIntoView({ behavior: "smooth", block: "center" })
  flashMessageTarget(targetLine, "is-mention-target")
}

function ensureChatJumpBindings() {
  if (chatJumpBound) return
  chatJumpBound = true

  if (messages) {
    messages.addEventListener(
      "scroll",
      () => {
        syncChatJumpControls()
      },
      { passive: true }
    )
  }

  if (chatJumpToBottomBtn) {
    chatJumpToBottomBtn.addEventListener("click", (event) => {
      event.preventDefault()
      scrollMessageListToBottom("smooth")
      syncChatJumpControls()
    })
  }

  if (chatJumpToMentionBtn) {
    chatJumpToMentionBtn.addEventListener("click", (event) => {
      event.preventDefault()
      jumpToLatestUnreadMention()
    })
  }

  window.addEventListener("resize", () => {
    syncChatJumpControls()
  })
}

function initMessageJumpControls() {
  ensureChatJumpBindings()
  syncChatJumpControls()
}

function resetMessageJumpState() {
  clearUnreadMentions()
  syncChatJumpControls()
}

function trackUnreadMentionMessage(messageId) {
  const targetId = Number(messageId)
  if (!Number.isInteger(targetId) || targetId <= 0) return
  if (state.readMentionMessageIds.has(targetId)) return
  if (!unreadMentionIds.has(targetId)) {
    unreadMentionIds.add(targetId)
    unreadMentionOrder.push(targetId)
  }
  syncChatJumpControls()
}

function renderMessageBodyWithMentions(container, message) {
  if (!container) return
  container.textContent = ""
  const text = String(message || "")
  if (!text) return
  const mentionPattern = new RegExp(CHAT_MENTION_PATTERN.source, "g")
  let lastIndex = 0
  let match
  while ((match = mentionPattern.exec(text))) {
    const start = match.index
    const end = mentionPattern.lastIndex
    if (start > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, start)))
    }
    const mentionText = match[0]
    const mentionName = match[1]
    const mentionNode = document.createElement("span")
    mentionNode.className = "chat-mention"
    if (normalizeUserKey(mentionName) === normalizeUserKey(state.username)) {
      mentionNode.classList.add("is-target")
    }
    mentionNode.textContent = mentionText
    container.appendChild(mentionNode)
    lastIndex = end
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)))
  }
}

function createReplyPreviewNode(replyData) {
  const replyId = Number(replyData && replyData.id)
  if (!Number.isInteger(replyId) || replyId <= 0) return null

  const wrap = document.createElement("button")
  wrap.type = "button"
  wrap.className = "chat-reply-preview"
  wrap.dataset.replyToMessageId = String(replyId)
  wrap.setAttribute("aria-label", "Jump to replied message")

  const user = document.createElement("span")
  user.className = "chat-reply-preview-user"
  user.textContent = String(replyData && replyData.username || "unknown")

  const text = document.createElement("span")
  text.className = "chat-reply-preview-text"
  text.textContent = String(replyData && replyData.message || "")

  wrap.appendChild(user)
  wrap.appendChild(text)
  return wrap
}

function appendDateSeparatorIfNeeded(createdAt) {
  const dateKey = getChatDateKey(createdAt)
  if (!dateKey || !messages) return

  if (!messages.children.length) {
    delete messages.dataset.lastChatDateKey
  }
  if (messages.dataset.lastChatDateKey === dateKey) return

  const label = formatChatDateLabel(createdAt)
  if (!label) return

  const separator = document.createElement("div")
  separator.className = "chat-date-separator"
  separator.dataset.dateKey = dateKey
  separator.setAttribute("role", "separator")
  separator.setAttribute("aria-label", `Tanggal chat ${label}`)

  const text = document.createElement("span")
  text.textContent = label
  separator.appendChild(text)

  messages.appendChild(separator)
  messages.dataset.lastChatDateKey = dateKey
}

function normalizeReactionList(reactions) {
  return Array.isArray(reactions) ? reactions : []
}

function userReacted(reaction) {
  const users = Array.isArray(reaction && reaction.users) ? reaction.users : []
  return users.some((username) => String(username) === String(state.username))
}

function renderReactionBar(container, messageId, reactions = []) {
  if (!container || !messageId) return
  const oldBar = container.querySelector(".chat-reactions")
  if (oldBar) oldBar.remove()

  const normalized = normalizeReactionList(reactions)
  const bar = document.createElement("div")
  bar.className = "chat-reactions"

  normalized.forEach((reaction) => {
    const emoji = String(reaction && reaction.emoji || "")
    const count = Number(reaction && reaction.count || 0)
    if (!emoji || count <= 0) return

    const chip = document.createElement("button")
    chip.type = "button"
    chip.className = "chat-reaction-chip"
    chip.classList.toggle("is-reacted", userReacted(reaction))
    chip.dataset.messageId = String(messageId)
    chip.dataset.emoji = emoji
    chip.setAttribute("aria-label", `React ${emoji}`)
    chip.textContent = `${emoji} ${count}`
    bar.appendChild(chip)
  })

  if (!bar.children.length) return

  bar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-emoji]")
    if (!button) return
    event.preventDefault()
    const targetMessageId = Number(button.dataset.messageId)
    const emoji = String(button.dataset.emoji || "")
    if (!Number.isInteger(targetMessageId) || !emoji) return
    socket.emit("message reaction", {
      message_id: targetMessageId,
      emoji
    })
    closeMessageActionPanelForNode(button)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })

  container.appendChild(bar)
}

function appendMentionToComposer(username) {
  if (!msgInput) return
  const mention = `@${String(username || "").trim()} `.trim()
  if (!mention || mention === "@") return

  const current = String(msgInput.value || "")
  msgInput.value = current ? `${current.trimEnd()} ${mention} ` : `${mention} `
  msgInput.focus()
}

async function copyMessageToClipboard(text) {
  const value = String(text || "")
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    try {
      const fallback = document.createElement("textarea")
      fallback.value = value
      fallback.setAttribute("readonly", "")
      fallback.style.position = "absolute"
      fallback.style.left = "-9999px"
      document.body.appendChild(fallback)
      fallback.select()
      document.execCommand("copy")
      fallback.remove()
    } catch {}
  }
}

function closeAllMessageActionPanels() {
  if (!messages) return
  messages.querySelectorAll(".chat-line.is-action-open, .chat-line.is-more-open").forEach((line) => {
    line.classList.remove("is-action-open")
    line.classList.remove("is-more-open")
  })
}

function closeMessageActionPanelForNode(node) {
  if (!(node instanceof Element)) return
  const line = node.closest(".chat-line")
  if (!line) return
  line.classList.remove("is-action-open")
  line.classList.remove("is-more-open")
}

function isDateSeparatorNode(node) {
  return Boolean(node && node.classList && node.classList.contains("chat-date-separator"))
}

function normalizeDateSeparators() {
  if (!messages) return
  const items = Array.from(messages.children)
  items.forEach((node) => {
    if (!isDateSeparatorNode(node)) return
    const next = node.nextElementSibling
    if (!next || isDateSeparatorNode(next)) {
      node.remove()
    }
  })

  const remainingItems = Array.from(messages.children)
  const lastSeparator = [...remainingItems].reverse().find((node) => isDateSeparatorNode(node))
  if (lastSeparator && lastSeparator.dataset.dateKey) {
    messages.dataset.lastChatDateKey = String(lastSeparator.dataset.dateKey)
  } else {
    delete messages.dataset.lastChatDateKey
  }
}

function ensureMessageActionDismissBehavior() {
  if (messageActionDismissBound) return
  messageActionDismissBound = true

  document.addEventListener("click", (event) => {
    if (!messages) return
    const target = event.target
    if (target instanceof Element && target.closest(".chat-line")) return
    closeAllMessageActionPanels()
  })

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    closeAllMessageActionPanels()
  })
}

function openMessageMoreMenu(line, menu, pointerEvent = null) {
  if (!line || !menu) return
  line.classList.add("is-action-open")
  line.classList.add("is-more-open")
  menu.style.removeProperty("left")
  menu.style.removeProperty("right")
  menu.style.removeProperty("top")

  if (!pointerEvent) return
  const lineRect = line.getBoundingClientRect()
  const menuWidth = menu.offsetWidth || 170
  const menuHeight = menu.offsetHeight || 108
  const padding = 10
  const xInLine = pointerEvent.clientX - lineRect.left
  const yInLine = pointerEvent.clientY - lineRect.top
  const clampedLeft = Math.max(
    padding,
    Math.min(xInLine, Math.max(padding, lineRect.width - menuWidth - padding))
  )
  const clampedTop = Math.max(
    padding,
    Math.min(yInLine, Math.max(padding, lineRect.height - menuHeight - padding))
  )

  menu.style.left = `${Math.round(clampedLeft)}px`
  menu.style.top = `${Math.round(clampedTop)}px`
  menu.style.right = "auto"
}

function renderMessageActions(line, data) {
  if (!line || !data) return
  ensureMessageActionDismissBehavior()
  const actionBar = document.createElement("div")
  actionBar.className = "chat-message-actions"
  actionBar.setAttribute("aria-label", "Message actions")

  const messageId = Number(data.id)
  if (Number.isInteger(messageId) && messageId > 0) {
    const quickReacts = document.createElement("div")
    quickReacts.className = "chat-message-quick-reacts"
    MESSAGE_REACTION_EMOJIS.forEach((emoji) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "chat-message-quick-react-btn"
      button.dataset.action = "quick-react"
      button.dataset.emoji = emoji
      button.setAttribute("aria-label", `React ${emoji}`)
      button.textContent = emoji
      quickReacts.appendChild(button)
    })
    actionBar.appendChild(quickReacts)
  }

  const actions = [
    { id: "reply", label: "↩", ariaLabel: "Reply to message" },
    { id: "mention", label: "@", ariaLabel: "Mention user" },
    { id: "more", label: "⋯", ariaLabel: "More options" }
  ]
  const isSelfMessage = String(data && data.username || "") === String(state.username || "")

  actions.forEach((action) => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "chat-message-action-btn"
    if (action.danger) {
      button.classList.add("is-danger")
    }
    button.dataset.action = action.id
    button.textContent = action.label
    button.setAttribute("aria-label", action.ariaLabel || action.id)
    actionBar.appendChild(button)
  })

  const moreMenu = document.createElement("div")
  moreMenu.className = "chat-message-more-menu"
  moreMenu.setAttribute("role", "menu")

  const copyMenuItem = document.createElement("button")
  copyMenuItem.type = "button"
  copyMenuItem.className = "chat-message-more-item"
  copyMenuItem.dataset.action = "copy"
  copyMenuItem.textContent = "Copy"
  moreMenu.appendChild(copyMenuItem)

  if (isSelfMessage) {
    const deleteMenuItem = document.createElement("button")
    deleteMenuItem.type = "button"
    deleteMenuItem.className = "chat-message-more-item is-danger"
    deleteMenuItem.dataset.action = "delete"
    deleteMenuItem.textContent = "🗑 Delete"
    moreMenu.appendChild(deleteMenuItem)
  }

  actionBar.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]")
    if (!button) return
    event.preventDefault()
    event.stopPropagation()
    const action = String(button.dataset.action || "")
    if (action === "quick-react") {
      const emoji = String(button.dataset.emoji || "")
      if (!Number.isInteger(messageId) || !emoji) return
      socket.emit("message reaction", {
        message_id: messageId,
        emoji
      })
      closeMessageActionPanelForNode(button)
      return
    }
    if (action === "mention") {
      appendMentionToComposer(data.username)
      closeMessageActionPanelForNode(button)
      return
    }
    if (action === "reply") {
      setReplyDraft(data)
      msgInput.focus()
      closeMessageActionPanelForNode(button)
      return
    }
    if (action === "copy") {
      await copyMessageToClipboard(data.message)
      closeMessageActionPanelForNode(button)
      return
    }
    if (action === "delete") {
      if (!Number.isInteger(messageId) || messageId <= 0) return
      const confirmed = await confirmNotice("Hapus chat ini?", {
        title: "Delete Message",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        type: "error"
      })
      if (!confirmed) return
      socket.emit("delete message", { message_id: messageId }, (response) => {
        if (response && response.ok) return
        if (response && response.error) {
          notify(response.error, "error")
        }
      })
      closeMessageActionPanelForNode(button)
      return
    }
    if (action === "more") {
      const wasOpen = line.classList.contains("is-more-open")
      closeAllMessageActionPanels()
      if (wasOpen) return
      openMessageMoreMenu(line, moreMenu)
    }
  })

  moreMenu.addEventListener("click", async (event) => {
    const button = event.target.closest(".chat-message-more-item")
    if (!button) return
    event.preventDefault()
    event.stopPropagation()
    const action = String(button.dataset.action || "")
    if (action === "copy") {
      await copyMessageToClipboard(data.message)
      closeMessageActionPanelForNode(button)
      return
    }
    if (action === "delete") {
      if (!Number.isInteger(messageId) || messageId <= 0) return
      const confirmed = await confirmNotice("Hapus chat ini?", {
        title: "Delete Message",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        type: "error"
      })
      if (!confirmed) return
      socket.emit("delete message", { message_id: messageId }, (response) => {
        if (response && response.ok) return
        if (response && response.error) {
          notify(response.error, "error")
        }
      })
      closeMessageActionPanelForNode(button)
    }
  })

  line.addEventListener("mouseleave", () => {
    if (!line.classList.contains("is-action-open") && !line.classList.contains("is-more-open")) return
    line.classList.remove("is-action-open")
    line.classList.remove("is-more-open")
  })

  line.addEventListener("contextmenu", (event) => {
    event.preventDefault()
    closeAllMessageActionPanels()
    openMessageMoreMenu(line, moreMenu, event)
  })

  line.addEventListener("click", (event) => {
    const interactive = event.target.closest(".chat-message-actions, .chat-message-more-menu, .chat-reply-preview")
    if (interactive) return
    if (isMobileActionLayout()) {
      const wasOpen = line.classList.contains("is-action-open")
      closeAllMessageActionPanels()
      if (!wasOpen) {
        line.classList.add("is-action-open")
      }
      return
    }
    if (!line.classList.contains("is-more-open")) return
    line.classList.remove("is-more-open")
  })

  line.appendChild(actionBar)
  line.appendChild(moreMenu)
}

function updateMessageReactions(messageId, reactions) {
  const targetId = Number(messageId)
  if (!messages || !Number.isInteger(targetId) || targetId <= 0) return
  const line = messages.querySelector(`.chat-line[data-message-id="${targetId}"]`)
  if (!line) return
  const content = line.querySelector(".chat-content")
  renderReactionBar(content, targetId, reactions)
}

function deleteMessageFromView(messageId) {
  const targetId = Number(messageId)
  if (!messages || !Number.isInteger(targetId) || targetId <= 0) return
  const line = messages.querySelector(`.chat-line[data-message-id="${targetId}"]`)
  if (!line) return
  line.remove()
  removeUnreadMention(targetId)
  if (Number(getReplyMessageId()) === targetId) {
    clearReplyDraft()
  }
  normalizeDateSeparators()
  syncChatJumpControls()
}

function renderMessage(data, options = {}) {
  const animate = options.animate !== false
  appendDateSeparatorIfNeeded(data && data.created_at)

  const div = document.createElement("div")
  div.className = "chat-line"
  const messageId = Number(data && data.id)
  if (Number.isInteger(messageId) && messageId > 0) {
    div.dataset.messageId = String(messageId)
  }
  const isSelfMessage = String(data && data.username) === String(state.username)
  const isMentionForSelf =
    !isSelfMessage && messageMentionsUser(data && data.message, state.username)
  if (isSelfMessage) {
    div.classList.add("is-self")
  }
  if (isMentionForSelf) {
    div.classList.add("is-target-mention")
  }
  if (animate) {
    div.classList.add("is-new")
    if (isSelfMessage) {
      div.classList.add("is-self-pulse")
    }
  }

  renderMessageActions(div, data)

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
  const replyPreview = createReplyPreviewNode(data && data.reply_to)
  if (replyPreview) {
    text.appendChild(replyPreview)
  }

  const textBody = document.createElement("div")
  textBody.className = "chat-bubble-text"
  renderMessageBodyWithMentions(textBody, data && data.message)
  text.appendChild(textBody)

  meta.appendChild(user)
  meta.appendChild(time)
  content.appendChild(meta)
  content.appendChild(text)
  if (Number.isInteger(messageId) && messageId > 0) {
    renderReactionBar(content, messageId, data && data.reactions)
  }

  div.addEventListener("click", (event) => {
    const trigger = event.target.closest(".chat-reply-preview")
    if (!trigger || !messages) return
    const targetId = Number(trigger.dataset.replyToMessageId)
    if (!Number.isInteger(targetId) || targetId <= 0) return
    const targetLine = messages.querySelector(`.chat-line[data-message-id="${targetId}"]`)
    if (!targetLine) return
    targetLine.scrollIntoView({ behavior: "smooth", block: "center" })
    flashMessageTarget(targetLine, "is-reply-target")
  })

  div.appendChild(avatar)
  div.appendChild(content)
  messages.appendChild(div)
  syncChatJumpControls()
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
  resetMessageJumpState()
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

export {
  renderMessage,
  renderNoServerEmptyState,
  updateMessageReactions,
  deleteMessageFromView,
  messageMentionsUser,
  initMessageJumpControls,
  resetMessageJumpState,
  isMessageListNearBottom,
  scrollMessageListToBottom,
  trackUnreadMentionMessage,
  syncChatJumpControls
}
