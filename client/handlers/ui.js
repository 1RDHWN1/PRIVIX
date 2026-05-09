import {
  serverSelect,
  serverList,
  channelSelect,
  channelList,
  createChannelBtn,
  renameChannelBtn,
  deleteChannelBtn,
  joinInviteBtn,
  getInviteBtn,
  regenInviteBtn,
  renameServerBtn,
  createServerBtn,
  leaveServerBtn,
  transferOwnerBtn,
  promoteBtn,
  modBtn,
  demoteBtn,
  kickBtn,
  muteBtn,
  unmuteBtn,
  copyInviteBtn,
  savePermBtn,
  sendBtn,
  msgInput,
  channelNameInput,
  inviteCodeInput,
  serverNameInput,
  ownerUsernameInput,
  memberFilterInput,
  auditFilterSelect,
  auditSearchInput,
  muteDurationSelect,
  muteReasonInput,
  memberUsernameInput,
  usernameInput,
  messages,
  createServerModal,
  createServerDialogTitle,
  createServerDialogSubtitle,
  createServerModalInput,
  createServerModalCancelBtn,
  createServerModalSubmitBtn,
  serverContextMenu,
  serverContextMenuTitle,
  serverContextMenuSubtitle,
  serverContextMenuItems,
  voiceLeaveBtn,
  voiceMuteBtn,
  voiceCameraBtn,
  voiceScreenBtn,
  voiceCameraFlipBtn,
  voiceLayoutBtn
} from "../dom.js"
import { state } from "../state.js"
import { SERVER_KEY, CHANNEL_KEY, CHANNEL_TYPE_VOICE } from "../constants.js"
import { notify } from "../notice.js"
import {
  setInvitePreview,
  setChannelOptions,
  syncServerListSelection,
  syncChannelListSelection
} from "../ui.js"
import { hasServerPermission, canLeaveServer, isServerOwner } from "../permissions.js"
import {
  getActiveServer,
  startSessionForSelectedChannel,
  updateChannelActionState
} from "../session.js"
import { getFilteredMembers, renderMembers, refreshMuteButtonLabel } from "../members.js"
import { getFilteredAuditLogs, renderAuditLogs } from "../audit.js"
import {
  handleCreateChannel,
  handleDeleteChannel,
  handleJoinInvite,
  handleCreateServer,
  handleDeleteServer,
  handleGetInvite,
  handleRegenInvite,
  handleRenameServer,
  handleTransferOwner,
  handleLeaveServer,
  handleRenameChannel,
  handleSetMemberRole,
  handleKickMember,
  handleMuteMember,
  handleUnmuteMember,
  handleSaveChannelPermission,
  send
} from "../actions.js"
import {
  sendTypingState,
  stopTypingStateTimer,
  queueTypingStop,
  resetTypingState
} from "../typing.js"
import {
  joinVoiceChannel,
  leaveVoiceChannel,
  toggleVoiceMute,
  toggleVoiceCamera,
  toggleVoiceScreenShare,
  toggleVoiceCameraFacing,
  toggleVoiceStageLayoutMode
} from "../voice.js"

let serverPromptConfirmLabel = "Create Server"
let serverPromptEmptyMessage = "Masukkan nama server dulu"
let serverPromptSubmitHandler = null
let serverPromptRestoreFocusTarget = null

function isCreateServerModalOpen() {
  return Boolean(createServerModal && createServerModal.classList.contains("show"))
}

function isServerContextMenuOpen() {
  return Boolean(serverContextMenu && serverContextMenu.classList.contains("show"))
}

function setCreateServerModalBusy(isBusy) {
  if (createServerModalInput) {
    createServerModalInput.disabled = Boolean(isBusy)
  }
  if (createServerModalCancelBtn) {
    createServerModalCancelBtn.disabled = Boolean(isBusy)
  }
  if (createServerModalSubmitBtn) {
    createServerModalSubmitBtn.disabled = Boolean(isBusy)
    createServerModalSubmitBtn.textContent = isBusy ? "Processing..." : serverPromptConfirmLabel
  }
}

function closeCreateServerModal({ restoreFocus = true } = {}) {
  if (!createServerModal) return
  createServerModal.classList.remove("show")
  createServerModal.setAttribute("aria-hidden", "true")
  setCreateServerModalBusy(false)
  if (createServerModalInput) {
    createServerModalInput.value = ""
  }
  serverPromptSubmitHandler = null
  if (restoreFocus) {
    const target = serverPromptRestoreFocusTarget || createServerBtn
    if (target && typeof target.focus === "function") {
      target.focus()
    }
  }
  serverPromptRestoreFocusTarget = null
}

function closeServerContextMenu() {
  if (!serverContextMenu) return
  serverContextMenu.classList.remove("show")
  serverContextMenu.setAttribute("aria-hidden", "true")
  serverContextMenu.style.left = "-9999px"
  serverContextMenu.style.top = "-9999px"
  delete serverContextMenu.dataset.serverId
}

function openServerPromptModal({
  title,
  subtitle,
  placeholder,
  confirmLabel,
  initialValue = "",
  emptyMessage = "Masukkan input dulu",
  onSubmit,
  restoreFocusEl = null
}) {
  if (!createServerModal || !createServerModalInput || typeof onSubmit !== "function") {
    return
  }

  closeServerContextMenu()
  serverPromptConfirmLabel = String(confirmLabel || "Confirm")
  serverPromptEmptyMessage = String(emptyMessage || "Masukkan input dulu")
  serverPromptSubmitHandler = onSubmit
  serverPromptRestoreFocusTarget = restoreFocusEl
  if (createServerDialogTitle) {
    createServerDialogTitle.textContent = String(title || "Server Action")
  }
  if (createServerDialogSubtitle) {
    createServerDialogSubtitle.textContent = String(subtitle || "")
  }
  createServerModalInput.placeholder = String(placeholder || "input")
  createServerModalInput.value = String(initialValue || "")
  setCreateServerModalBusy(false)
  createServerModal.classList.add("show")
  createServerModal.setAttribute("aria-hidden", "false")
  window.requestAnimationFrame(() => {
    createServerModalInput.focus()
    createServerModalInput.select()
  })
}

function openCreateServerModal() {
  openServerPromptModal({
    title: "Create Server",
    subtitle: "Masukkan nama server baru. Channel awal general tetap akan dibuat otomatis.",
    placeholder: "server name",
    confirmLabel: "Create Server",
    emptyMessage: "Masukkan nama server dulu",
    onSubmit: (value) => handleCreateServer(value),
    restoreFocusEl: createServerBtn
  })
}

function openRenameServerModal() {
  const activeServer = getActiveServer()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!hasServerPermission("server.rename", activeServer)) {
    notify("Kamu tidak punya izin rename server", "error")
    return
  }

  openServerPromptModal({
    title: "Rename Server",
    subtitle: `Ubah nama server ${activeServer.name}.`,
    placeholder: "new server name",
    confirmLabel: "Save Rename",
    initialValue: activeServer.name,
    emptyMessage: "Masukkan nama server baru dulu",
    onSubmit: (value) => handleRenameServer(value)
  })
}

function openTransferOwnerModal() {
  const activeServer = getActiveServer()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  const canTransferOwner =
    hasServerPermission("server.owner.transfer", activeServer) && isServerOwner(activeServer)
  if (!canTransferOwner) {
    notify("Kamu tidak punya izin transfer owner", "error")
    return
  }

  openServerPromptModal({
    title: "Transfer Owner",
    subtitle: `Pindahkan owner server ${activeServer.name} ke username lain.`,
    placeholder: "new owner username",
    confirmLabel: "Transfer Owner",
    emptyMessage: "Masukkan username owner baru dulu",
    onSubmit: (value) => handleTransferOwner(value)
  })
}

async function submitCreateServerModal() {
  if (!createServerModalInput || typeof serverPromptSubmitHandler !== "function") return

  const value = createServerModalInput.value.trim()
  if (!value) {
    notify(serverPromptEmptyMessage)
    createServerModalInput.focus()
    return
  }

  setCreateServerModalBusy(true)
  const completed = await serverPromptSubmitHandler(value)
  if (completed) {
    closeCreateServerModal()
    return
  }
  setCreateServerModalBusy(false)
  createServerModalInput.focus()
}

function getServerById(serverId) {
  const targetId = Number(serverId)
  if (!Number.isInteger(targetId) || targetId <= 0) return null
  return state.serversCache.find((item) => item.id === targetId) || null
}

function selectServerById(serverId) {
  const nextId = String(serverId || "")
  if (!nextId) return
  if (serverSelect.value === nextId) return
  serverSelect.value = nextId
  serverSelect.dispatchEvent(new Event("change", { bubbles: true }))
}

function setServerContextMenuItemHidden(actionName, isHidden) {
  if (!Array.isArray(serverContextMenuItems)) return
  const target = serverContextMenuItems.find((item) => item.dataset.serverMenuAction === actionName)
  if (!target) return
  target.hidden = Boolean(isHidden)
}

function openServerContextMenu(serverId, x, y) {
  if (!serverContextMenu) return
  selectServerById(serverId)
  const activeServer = getServerById(serverId) || getActiveServer()
  if (!activeServer) return

  const canRenameServer = hasServerPermission("server.rename", activeServer)
  const canTransferOwner =
    hasServerPermission("server.owner.transfer", activeServer) && isServerOwner(activeServer)
  const canGetInvite = hasServerPermission("invite.get", activeServer)
  const canRegenInvite = hasServerPermission("invite.regenerate", activeServer)
  const canLeaveActiveServer = canLeaveServer(activeServer)
  const canDeleteServer = isServerOwner(activeServer)

  if (serverContextMenuTitle) {
    serverContextMenuTitle.textContent = activeServer.name
  }
  if (serverContextMenuSubtitle) {
    serverContextMenuSubtitle.textContent = `Role: ${String(activeServer.current_role_name || "member")}`
  }

  setServerContextMenuItemHidden("rename", !canRenameServer)
  setServerContextMenuItemHidden("copy-invite", !canGetInvite)
  setServerContextMenuItemHidden("regen-invite", !canRegenInvite)
  setServerContextMenuItemHidden("transfer-owner", !canTransferOwner)
  setServerContextMenuItemHidden("delete", !canDeleteServer)
  setServerContextMenuItemHidden("leave", !canLeaveActiveServer)
  const menuDivider = serverContextMenu.querySelector(".context-menu-divider")
  if (menuDivider) {
    menuDivider.hidden =
      (!canDeleteServer && !canLeaveActiveServer) ||
      (!canRenameServer && !canGetInvite && !canRegenInvite && !canTransferOwner)
  }

  serverContextMenu.dataset.serverId = String(activeServer.id)
  serverContextMenu.classList.add("show")
  serverContextMenu.setAttribute("aria-hidden", "false")
  serverContextMenu.style.left = "0px"
  serverContextMenu.style.top = "0px"

  const card = serverContextMenu.querySelector(".context-menu-card")
  const cardRect = card ? card.getBoundingClientRect() : { width: 280, height: 260 }
  const left = Math.max(12, Math.min(x, window.innerWidth - cardRect.width - 12))
  const top = Math.max(12, Math.min(y, window.innerHeight - cardRect.height - 12))
  serverContextMenu.style.left = `${left}px`
  serverContextMenu.style.top = `${top}px`
}

async function copyActiveServerInviteLink() {
  await handleGetInvite()
  if (!state.inviteShareUrl) {
    notify("Invite link belum tersedia", "error")
    return
  }
  try {
    await navigator.clipboard.writeText(state.inviteShareUrl)
    notify("Invite link berhasil disalin", "success")
  } catch {
    notify("Gagal menyalin invite link", "error")
  }
}

function bindUiHandlers() {
  serverSelect.addEventListener("change", () => {
    const activeServer = getActiveServer()
    if (!activeServer) return

    localStorage.setItem(SERVER_KEY, String(activeServer.id))
    syncServerListSelection()
    setInvitePreview("")
    updateChannelActionState()
    setChannelOptions(activeServer.channels || [])
    if (channelSelect.value) {
      localStorage.setItem(CHANNEL_KEY, channelSelect.value)
    }
    resetTypingState({ notifyServer: true })
    messages.innerHTML = ""
    startSessionForSelectedChannel(true)
  })

  channelSelect.addEventListener("change", () => {
    localStorage.setItem(CHANNEL_KEY, channelSelect.value)
    syncChannelListSelection()
    resetTypingState({ notifyServer: true })
    messages.innerHTML = ""
    updateChannelActionState()
    startSessionForSelectedChannel(true)
  })

  if (serverList) {
    serverList.addEventListener("click", (e) => {
      closeServerContextMenu()
      const target = e.target.closest(".server-item")
      if (!target) return
      const serverId = target.dataset.serverId
      if (!serverId || serverSelect.value === serverId) return
      serverSelect.value = serverId
      serverSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    serverList.addEventListener("contextmenu", (e) => {
      const target = e.target.closest(".server-item")
      if (!target) return
      e.preventDefault()
      const serverId = target.dataset.serverId
      if (!serverId) return
      openServerContextMenu(serverId, e.clientX, e.clientY)
    })
  }

  if (channelList) {
    channelList.addEventListener("click", (e) => {
      const target = e.target.closest(".channel-item")
      if (!target) return
      const channelName = target.dataset.channelName
      const isVoiceChannel = String(target.dataset.channelType || "").toLowerCase() === CHANNEL_TYPE_VOICE
      if (!channelName) return
      if (channelSelect.value === channelName) {
        if (isVoiceChannel) {
          joinVoiceChannel({ silent: true })
        }
        return
      }
      channelSelect.value = channelName
      channelSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
  }

  createChannelBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleCreateChannel()
  })

  renameChannelBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleRenameChannel()
  })

  deleteChannelBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleDeleteChannel()
  })

  joinInviteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleJoinInvite()
  })

  getInviteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleGetInvite()
  })

  regenInviteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleRegenInvite()
  })

  renameServerBtn.addEventListener("click", (e) => {
    e.preventDefault()
    openRenameServerModal()
  })

  createServerBtn.addEventListener("click", (e) => {
    e.preventDefault()
    openCreateServerModal()
  })

  leaveServerBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleLeaveServer()
  })

  transferOwnerBtn.addEventListener("click", (e) => {
    e.preventDefault()
    openTransferOwnerModal()
  })

  promoteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleSetMemberRole("admin")
  })

  modBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleSetMemberRole("moderator")
  })

  demoteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleSetMemberRole("member")
  })

  kickBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleKickMember()
  })

  muteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleMuteMember()
  })

  unmuteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleUnmuteMember()
  })

  copyInviteBtn.addEventListener("click", async (e) => {
    e.preventDefault()
    if (!state.inviteShareUrl) {
      notify("Ambil invite dulu")
      return
    }
    try {
      await navigator.clipboard.writeText(state.inviteShareUrl)
      notify("Invite link berhasil disalin", "success")
    } catch {
      notify("Gagal menyalin invite link", "error")
    }
  })

  savePermBtn.addEventListener("click", (e) => {
    e.preventDefault()
    handleSaveChannelPermission()
  })

  sendBtn.addEventListener("click", (e) => {
    e.preventDefault()
    send()
  })

  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      send()
    }
  })

  msgInput.addEventListener("input", () => {
    if (!state.isSessionReady) {
      resetTypingState()
      return
    }

    const hasText = msgInput.value.trim().length > 0
    if (!hasText) {
      sendTypingState(false)
      stopTypingStateTimer()
      return
    }

    sendTypingState(true)
    queueTypingStop()
  })

  msgInput.addEventListener("blur", () => {
    sendTypingState(false)
    stopTypingStateTimer()
  })

  channelNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleCreateChannel()
    }
  })

  inviteCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleJoinInvite()
    }
  })

  serverNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const activeServer = getActiveServer()
      if (activeServer && hasServerPermission("server.rename", activeServer)) {
        openRenameServerModal()
        return
      }
      if (activeServer) {
        notify("Kamu tidak punya izin rename server", "error")
        return
      }
      openCreateServerModal()
    }
  })

  if (createServerModalSubmitBtn) {
    createServerModalSubmitBtn.addEventListener("click", (e) => {
      e.preventDefault()
      submitCreateServerModal()
    })
  }

  if (createServerModalCancelBtn) {
    createServerModalCancelBtn.addEventListener("click", (e) => {
      e.preventDefault()
      closeCreateServerModal()
    })
  }

  if (createServerModal) {
    createServerModal.addEventListener("click", (e) => {
      if (e.target === createServerModal) {
        closeCreateServerModal()
      }
    })
  }

  if (createServerModalInput) {
    createServerModalInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        submitCreateServerModal()
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        closeCreateServerModal()
      }
    })
  }

  if (serverContextMenu && Array.isArray(serverContextMenuItems)) {
    serverContextMenuItems.forEach((item) => {
      item.addEventListener("click", async (e) => {
        e.preventDefault()
        const actionName = item.dataset.serverMenuAction
        closeServerContextMenu()
        if (actionName === "rename") {
          openRenameServerModal()
          return
        }
        if (actionName === "copy-invite") {
          await copyActiveServerInviteLink()
          return
        }
        if (actionName === "regen-invite") {
          await handleRegenInvite()
          return
        }
        if (actionName === "transfer-owner") {
          openTransferOwnerModal()
          return
        }
        if (actionName === "leave") {
          await handleLeaveServer()
          return
        }
        if (actionName === "delete") {
          await handleDeleteServer()
        }
      })
    })
  }

  ownerUsernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      openTransferOwnerModal()
    }
  })

  memberFilterInput.addEventListener("input", () => {
    renderMembers(getFilteredMembers())
  })

  auditFilterSelect.addEventListener("change", () => {
    renderAuditLogs(getFilteredAuditLogs())
  })

  auditSearchInput.addEventListener("input", () => {
    renderAuditLogs(getFilteredAuditLogs())
  })

  muteDurationSelect.addEventListener("change", () => {
    refreshMuteButtonLabel()
  })

  muteReasonInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleMuteMember()
    }
  })

  memberUsernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const activeServer = getActiveServer()
      const canManageRoles = activeServer && hasServerPermission("member.role.set", activeServer)
      const canMuteMembers = activeServer && hasServerPermission("member.mute", activeServer)
      const canKickMembers = activeServer && hasServerPermission("member.kick", activeServer)
      if (canManageRoles) {
        handleSetMemberRole("admin")
        return
      }
      if (canMuteMembers) {
        handleMuteMember()
        return
      }
      if (canKickMembers) {
        handleKickMember()
      }
    }
  })

  usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      startSessionForSelectedChannel(true)
    }
  })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isCreateServerModalOpen()) {
      e.preventDefault()
      closeCreateServerModal()
      return
    }
    if (e.key === "Escape" && isServerContextMenuOpen()) {
      e.preventDefault()
      closeServerContextMenu()
    }
  })

  document.addEventListener("click", (e) => {
    if (!isServerContextMenuOpen()) return
    if (serverContextMenu && serverContextMenu.contains(e.target)) return
    if (e.target.closest(".server-item")) return
    closeServerContextMenu()
  })

  document.addEventListener(
    "scroll",
    () => {
      if (isServerContextMenuOpen()) {
        closeServerContextMenu()
      }
    },
    true
  )

  window.addEventListener("resize", () => {
    if (isServerContextMenuOpen()) {
      closeServerContextMenu()
    }
  })

  voiceLeaveBtn.addEventListener("click", (e) => {
    e.preventDefault()
    leaveVoiceChannel({ notifyServer: true, markManual: true })
  })

  voiceMuteBtn.addEventListener("click", (e) => {
    e.preventDefault()
    toggleVoiceMute()
  })

  if (voiceCameraBtn) {
    voiceCameraBtn.addEventListener("click", (e) => {
      e.preventDefault()
      toggleVoiceCamera()
    })
  }

  if (voiceScreenBtn) {
    voiceScreenBtn.addEventListener("click", (e) => {
      e.preventDefault()
      toggleVoiceScreenShare()
    })
  }

  if (voiceCameraFlipBtn) {
    voiceCameraFlipBtn.addEventListener("click", (e) => {
      e.preventDefault()
      toggleVoiceCameraFacing()
    })
  }

  if (voiceLayoutBtn) {
    voiceLayoutBtn.addEventListener("click", (e) => {
      e.preventDefault()
      toggleVoiceStageLayoutMode()
    })
  }
}

export { bindUiHandlers }
