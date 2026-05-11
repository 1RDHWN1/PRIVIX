import { replyDraft, replyDraftCancel, replyDraftText, replyDraftUser } from "./dom.js"
import { state } from "./state.js"

function clampReplyText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

function renderReplyDraft() {
  if (!replyDraft || !replyDraftUser || !replyDraftText) return
  const draft = state.replyDraft
  if (!draft || !Number.isInteger(Number(draft.messageId)) || Number(draft.messageId) <= 0) {
    replyDraft.hidden = true
    replyDraftUser.textContent = ""
    replyDraftText.textContent = ""
    return
  }
  replyDraft.hidden = false
  replyDraftUser.textContent = String(draft.username || "unknown")
  replyDraftText.textContent = clampReplyText(draft.message)
}

function setReplyDraft(data) {
  const messageId = Number(data && data.id)
  if (!Number.isInteger(messageId) || messageId <= 0) {
    clearReplyDraft()
    return
  }
  state.replyDraft = {
    messageId,
    username: String(data && data.username || ""),
    message: String(data && data.message || "")
  }
  renderReplyDraft()
}

function clearReplyDraft() {
  state.replyDraft = null
  renderReplyDraft()
}

function getReplyMessageId() {
  const draft = state.replyDraft
  if (!draft) return null
  const messageId = Number(draft.messageId)
  if (!Number.isInteger(messageId) || messageId <= 0) return null
  return messageId
}

function wireReplyDraftEvents() {
  renderReplyDraft()
  if (!replyDraftCancel) return
  replyDraftCancel.addEventListener("click", (event) => {
    event.preventDefault()
    clearReplyDraft()
  })
}

export { setReplyDraft, clearReplyDraft, getReplyMessageId, wireReplyDraftEvents }
