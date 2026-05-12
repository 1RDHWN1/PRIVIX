import {
  channelSelect,
  chatRoot,
  drawguessToggleBtn,
  mobileGameBtn,
  drawguessPanel,
  gameRoomHint,
  gameItemDrawguess,
  gameItemWordrush,
  gameItemDrawguessPlayers,
  gameItemWordrushPlayers,
  gameRoomScreenHead,
  gameRoomScreenBackBtn,
  gameRoomScreenTitle,
  gameRoomScreenPlayers,
  drawguessRoomPanel,
  wordrushRoomPanel,
  drawguessStatus,
  drawguessStartBtn,
  drawguessClearBtn,
  drawguessWord,
  drawguessTimer,
  drawguessCanvas,
  drawguessGuessInput,
  drawguessGuessBtn,
  drawguessScore,
  wordrushStatus,
  wordrushDifficultySelect,
  wordrushStartBtn,
  wordrushPrompt,
  wordrushTimer,
  wordrushGuessInput,
  wordrushGuessBtn,
  wordrushScore
} from "./dom.js"
import { socket } from "./socket.js"
import { notify } from "./notice.js"
import { state } from "./state.js"

const MOBILE_BREAKPOINT = 760

let gameUiBound = false
let gamePanelVisible = false
let selectedGameId = "drawguess"
let activeGameId = ""
let drawguessTimerHandle = null
let wordrushTimerHandle = null
let drawguessStrokes = []
let isDrawing = false
let lastPoint = null

let gameLobbyState = {
  drawguess_players: [],
  wordrush_players: [],
  joined_game_id: ""
}

let drawguessState = {
  active: false,
  is_drawer: false,
  drawer_username: "",
  word_mask: "",
  round_ends_at_ts: 0,
  scores: [],
  participants: []
}

let wordrushState = {
  active: false,
  joined: false,
  difficulty: "medium",
  word_hint: "",
  round_ends_at_ts: 0,
  scores: [],
  participants: []
}

function normalizeWordrushDifficulty(value) {
  const raw = String(value || "").trim().toLowerCase()
  if (raw === "easy" || raw === "hard") return raw
  return "medium"
}

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
}

function getCurrentUsername() {
  return String(state.username || "").trim()
}

function getCanvasContext() {
  if (!drawguessCanvas) return null
  return drawguessCanvas.getContext("2d")
}

function clampUnit(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(1, num))
}

function isCurrentChannelGameRoom() {
  const channelName = String((channelSelect && channelSelect.value) || "").trim().toLowerCase()
  return /^game(?:-[a-z0-9-]+)?$/i.test(channelName)
}

function formatPlayerList(players) {
  const list = Array.isArray(players)
    ? players.map((item) => String(item || "").trim()).filter(Boolean)
    : []
  if (!list.length) return "-"
  if (list.length <= 4) return list.join(", ")
  return `${list.slice(0, 4).join(", ")} +${list.length - 4}`
}

function getLobbyPlayers(gameId) {
  if (gameId === "drawguess") return Array.isArray(gameLobbyState.drawguess_players) ? gameLobbyState.drawguess_players : []
  if (gameId === "wordrush") return Array.isArray(gameLobbyState.wordrush_players) ? gameLobbyState.wordrush_players : []
  return []
}

function getJoinedGameIdFromLobby() {
  const joined = String(gameLobbyState.joined_game_id || "")
  if (joined === "drawguess" || joined === "wordrush") return joined
  return ""
}

function clearDrawguessTimer() {
  if (!drawguessTimerHandle) return
  clearInterval(drawguessTimerHandle)
  drawguessTimerHandle = null
}

function clearWordrushTimer() {
  if (!wordrushTimerHandle) return
  clearInterval(wordrushTimerHandle)
  wordrushTimerHandle = null
}

function formatCountdown(ts, isActive) {
  if (!isActive || !ts) return "--s"
  const leftMs = Math.max(0, Number(ts) - Date.now())
  return `${Math.ceil(leftMs / 1000)}s`
}

function updateCountdownUi() {
  if (drawguessTimer) {
    drawguessTimer.textContent = formatCountdown(drawguessState.round_ends_at_ts, drawguessState.active)
  }
  if (wordrushTimer) {
    wordrushTimer.textContent = formatCountdown(wordrushState.round_ends_at_ts, wordrushState.active)
  }
}

function startTimers() {
  clearDrawguessTimer()
  clearWordrushTimer()
  updateCountdownUi()
  if (drawguessState.active) {
    drawguessTimerHandle = setInterval(updateCountdownUi, 500)
  }
  if (wordrushState.active) {
    wordrushTimerHandle = setInterval(updateCountdownUi, 500)
  }
}

function clearCanvasVisual() {
  const ctx = getCanvasContext()
  if (!ctx || !drawguessCanvas) return
  ctx.clearRect(0, 0, drawguessCanvas.width, drawguessCanvas.height)
  ctx.fillStyle = "#111724"
  ctx.fillRect(0, 0, drawguessCanvas.width, drawguessCanvas.height)
}

function drawStroke(stroke) {
  const ctx = getCanvasContext()
  if (!ctx || !drawguessCanvas || !stroke) return
  const x0 = clampUnit(stroke.x0) * drawguessCanvas.width
  const y0 = clampUnit(stroke.y0) * drawguessCanvas.height
  const x1 = clampUnit(stroke.x1) * drawguessCanvas.width
  const y1 = clampUnit(stroke.y1) * drawguessCanvas.height
  const sizeRatio = Math.max(0.0025, Math.min(0.05, Number(stroke.size) || 0.007))
  const lineWidth = Math.max(1, sizeRatio * drawguessCanvas.width)
  const isErase = String(stroke.tool || "draw").toLowerCase() === "erase"

  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = isErase ? "#111724" : String(stroke.color || "#f1f5ff")
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

function redrawFromStrokes() {
  clearCanvasVisual()
  drawguessStrokes.forEach((stroke) => drawStroke(stroke))
}

function resizeCanvas() {
  if (!drawguessCanvas) return
  const rect = drawguessCanvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  drawguessCanvas.width = Math.max(320, Math.round(rect.width))
  drawguessCanvas.height = Math.max(180, Math.round(rect.height))
  redrawFromStrokes()
}

function setPanelVisible(visible) {
  gamePanelVisible = Boolean(visible)
  if (drawguessPanel) {
    drawguessPanel.hidden = !gamePanelVisible
  }
}

function setSelectedGame(gameId) {
  const safeGameId = gameId === "wordrush" ? "wordrush" : "drawguess"
  selectedGameId = safeGameId
  if (gameItemDrawguess) {
    gameItemDrawguess.classList.toggle("is-active", safeGameId === "drawguess")
  }
  if (gameItemWordrush) {
    gameItemWordrush.classList.toggle("is-active", safeGameId === "wordrush")
  }
}

function setActiveGameScreen(gameId) {
  const nextGameId = gameId === "drawguess" || gameId === "wordrush" ? gameId : ""
  activeGameId = nextGameId
  if (drawguessPanel) {
    drawguessPanel.classList.toggle("is-game-screen", Boolean(nextGameId))
  }
  if (chatRoot) {
    chatRoot.classList.toggle("is-game-fullscreen", Boolean(nextGameId) && isMobileLayout())
  }
}

function renderGameScreenMeta() {
  const screenOpen = Boolean(activeGameId)
  if (gameRoomScreenHead) {
    gameRoomScreenHead.hidden = !screenOpen
  }
  if (!screenOpen) return

  const players = getLobbyPlayers(activeGameId)
  if (gameRoomScreenTitle) {
    gameRoomScreenTitle.textContent = activeGameId === "wordrush" ? "Word Rush" : "Draw & Guess"
  }
  if (gameRoomScreenPlayers) {
    gameRoomScreenPlayers.textContent = `Pemain: ${formatPlayerList(players)}`
  }
}

function renderLobbyCards() {
  const drawguessPlayers = getLobbyPlayers("drawguess")
  const wordrushPlayers = getLobbyPlayers("wordrush")

  if (gameItemDrawguessPlayers) {
    gameItemDrawguessPlayers.textContent = `Pemain: ${formatPlayerList(drawguessPlayers)}`
  }
  if (gameItemWordrushPlayers) {
    gameItemWordrushPlayers.textContent = `Pemain: ${formatPlayerList(wordrushPlayers)}`
  }
}

function renderDrawguessUi() {
  const inGameRoom = isCurrentChannelGameRoom()
  const joinedGameId = getJoinedGameIdFromLobby()
  const isJoinedDrawguess = joinedGameId === "drawguess"
  const canInteract = activeGameId === "drawguess" && isJoinedDrawguess

  if (drawguessStatus) {
    if (!drawguessState.active) {
      drawguessStatus.textContent = "Belum ada ronde aktif"
    } else if (drawguessState.is_drawer) {
      drawguessStatus.textContent = "Kamu jadi drawer, gambar sejelas mungkin"
    } else {
      drawguessStatus.textContent = `${drawguessState.drawer_username} sedang menggambar`
    }
  }
  if (drawguessWord) {
    drawguessWord.textContent = drawguessState.active ? `Kata: ${drawguessState.word_mask || "-"}` : "Kata: -"
  }
  if (drawguessStartBtn) {
    drawguessStartBtn.disabled = !canInteract || drawguessState.active || !inGameRoom
    drawguessStartBtn.textContent = drawguessState.active ? "Round Active" : "Start Round"
  }
  if (drawguessClearBtn) {
    drawguessClearBtn.disabled = !canInteract || !drawguessState.active || !drawguessState.is_drawer
  }
  if (drawguessGuessInput) {
    drawguessGuessInput.disabled = !canInteract || !drawguessState.active || drawguessState.is_drawer
    drawguessGuessInput.placeholder = drawguessState.active
      ? drawguessState.is_drawer
        ? "kamu yang gambar..."
        : "tebak kata..."
      : "belum ada ronde aktif"
  }
  if (drawguessGuessBtn) {
    drawguessGuessBtn.disabled = !canInteract || !drawguessState.active || drawguessState.is_drawer
  }
  if (drawguessToggleBtn) {
    drawguessToggleBtn.classList.toggle("is-live", drawguessState.active)
  }
}

function renderWordrushUi() {
  const inGameRoom = isCurrentChannelGameRoom()
  const joinedGameId = getJoinedGameIdFromLobby()
  const isJoinedWordrush = joinedGameId === "wordrush"
  const canInteract = activeGameId === "wordrush" && isJoinedWordrush
  const difficulty = normalizeWordrushDifficulty(wordrushState.difficulty)
  const difficultyLabel = difficulty[0].toUpperCase() + difficulty.slice(1)

  if (wordrushStatus) {
    wordrushStatus.textContent = wordrushState.active
      ? `Ronde ${difficultyLabel} berjalan, ketik jawaban secepatnya`
      : "Belum ada ronde aktif"
  }
  if (wordrushPrompt) {
    wordrushPrompt.textContent = wordrushState.active
      ? `Kata: ${String(wordrushState.word_hint || "-")}`
      : "Kata: -"
  }
  if (wordrushDifficultySelect) {
    wordrushDifficultySelect.value = difficulty
    wordrushDifficultySelect.disabled = !canInteract || wordrushState.active
  }
  if (wordrushStartBtn) {
    wordrushStartBtn.disabled = !canInteract || wordrushState.active || !inGameRoom
    wordrushStartBtn.textContent = wordrushState.active ? "Round Active" : "Start Round"
  }
  if (wordrushGuessInput) {
    wordrushGuessInput.disabled = !canInteract || !wordrushState.active
    wordrushGuessInput.placeholder = wordrushState.active
      ? "ketik jawaban kata..."
      : "belum ada ronde aktif"
  }
  if (wordrushGuessBtn) {
    wordrushGuessBtn.disabled = !canInteract || !wordrushState.active
  }
  if (wordrushScore) {
    const scores = Array.isArray(wordrushState.scores) ? wordrushState.scores : []
    wordrushScore.textContent = scores.length
      ? `Score: ${scores.map((item) => `${item.username} ${item.score}`).join(" • ")}`
      : "Score: belum ada poin"
  }
}

function renderLayoutVisibility() {
  const screenOpen = Boolean(activeGameId)
  const showCatalog = !screenOpen

  if (gameRoomHint) {
    const inGameRoom = isCurrentChannelGameRoom()
    gameRoomHint.textContent = inGameRoom
      ? "Pilih game, lalu masuk ke game yang kamu mau."
      : "Pindah dulu ke channel #game / #game-* untuk main game."
    gameRoomHint.classList.toggle("is-ok", inGameRoom)
  }

  if (drawguessPanel) {
    drawguessPanel.classList.toggle("is-invalid-room", !isCurrentChannelGameRoom())
  }

  if (gameItemDrawguess) {
    gameItemDrawguess.hidden = !showCatalog
  }
  if (gameItemWordrush) {
    gameItemWordrush.hidden = !showCatalog
  }
  if (drawguessRoomPanel) {
    drawguessRoomPanel.hidden = !screenOpen || activeGameId !== "drawguess"
  }
  if (wordrushRoomPanel) {
    wordrushRoomPanel.hidden = !screenOpen || activeGameId !== "wordrush"
  }
}

function renderUi() {
  renderLobbyCards()
  renderGameScreenMeta()
  renderLayoutVisibility()
  renderDrawguessUi()
  renderWordrushUi()
  startTimers()
  if (activeGameId === "drawguess") {
    setTimeout(() => resizeCanvas(), 0)
  }
}

function getPointFromPointerEvent(event) {
  if (!drawguessCanvas) return null
  const rect = drawguessCanvas.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const x = clampUnit((event.clientX - rect.left) / rect.width)
  const y = clampUnit((event.clientY - rect.top) / rect.height)
  return { x, y }
}

function emitStroke(fromPoint, toPoint) {
  const stroke = {
    x0: clampUnit(fromPoint.x),
    y0: clampUnit(fromPoint.y),
    x1: clampUnit(toPoint.x),
    y1: clampUnit(toPoint.y),
    size: 0.008,
    color: "#eaf2ff",
    tool: "draw"
  }
  drawguessStrokes.push(stroke)
  drawStroke(stroke)
  socket.emit("drawguess stroke", stroke)
}

function bindCanvasInteraction() {
  if (!drawguessCanvas) return

  drawguessCanvas.addEventListener("pointerdown", (event) => {
    if (activeGameId !== "drawguess") return
    if (!drawguessState.active || !drawguessState.is_drawer) return
    const point = getPointFromPointerEvent(event)
    if (!point) return
    isDrawing = true
    lastPoint = point
    drawguessCanvas.setPointerCapture(event.pointerId)
  })

  drawguessCanvas.addEventListener("pointermove", (event) => {
    if (activeGameId !== "drawguess") return
    if (!isDrawing || !drawguessState.active || !drawguessState.is_drawer) return
    const point = getPointFromPointerEvent(event)
    if (!point || !lastPoint) return
    emitStroke(lastPoint, point)
    lastPoint = point
  })

  const stopDraw = () => {
    isDrawing = false
    lastPoint = null
  }
  drawguessCanvas.addEventListener("pointerup", stopDraw)
  drawguessCanvas.addEventListener("pointercancel", stopDraw)
  drawguessCanvas.addEventListener("pointerleave", stopDraw)
}

function submitDrawguessGuess() {
  if (activeGameId !== "drawguess") return
  if (!drawguessGuessInput) return
  const guess = String(drawguessGuessInput.value || "").trim()
  if (!guess) return
  socket.emit("drawguess guess", { guess }, (res) => {
    if (!res || !res.ok) {
      notify((res && res.error) || "Gagal kirim tebakan", "error")
      return
    }
    if (res.correct) {
      notify(`Jawaban benar! +${Number(res.points) || 0} poin`, "success")
      drawguessGuessInput.value = ""
      return
    }
    notify("Belum tepat, coba lagi")
  })
}

function submitWordrushGuess() {
  if (activeGameId !== "wordrush") return
  if (!wordrushGuessInput) return
  const guess = String(wordrushGuessInput.value || "").trim()
  if (!guess) return
  socket.emit("wordrush guess", { guess }, (res) => {
    if (!res || !res.ok) {
      notify((res && res.error) || "Gagal kirim tebakan Word Rush", "error")
      return
    }
    if (res.correct) {
      notify(`Jawaban benar! +${Number(res.points) || 0} poin`, "success")
      wordrushGuessInput.value = ""
      return
    }
    notify("Belum tepat, gas lagi")
  })
}

function enterGame(gameId) {
  const safeGameId = gameId === "wordrush" ? "wordrush" : "drawguess"
  if (!isCurrentChannelGameRoom()) {
    notify("Masuk dulu ke channel #game / #game-* untuk main.", "error", {
      title: "Room Game Diperlukan"
    })
    return
  }

  socket.emit("game join", { game_id: safeGameId }, (res) => {
    if (!res || !res.ok) {
      notify((res && res.error) || "Gagal masuk game", "error")
      return
    }
    const players = Array.isArray(res.players) ? res.players : []
    const joinedUsername = String(res.username || getCurrentUsername() || "kamu")
    const gameLabel = safeGameId === "wordrush" ? "Word Rush" : "Draw & Guess"
    notify(
      `${joinedUsername} sudah masuk ${gameLabel}. Pemain: ${formatPlayerList(players)}`,
      "success",
      { title: "Masuk Game" }
    )
    setSelectedGame(safeGameId)
    setActiveGameScreen(safeGameId)
    setPanelVisible(true)
    renderUi()
  })
}

function leaveActiveGame() {
  if (!activeGameId) return
  const leavingGame = activeGameId
  socket.emit("game leave", { game_id: leavingGame }, () => {})
  setActiveGameScreen("")
  renderUi()
}

function startDrawguessRound() {
  socket.emit("drawguess start", (res) => {
    if (!res || !res.ok) {
      const code = String((res && res.code) || "")
      if (code === "DRAWGUESS_NEED_PLAYERS") {
        notify(`Minimal 2 pemain. Saat ini: ${formatPlayerList(res.players)}`, "error", {
          title: "Pemain Belum Cukup"
        })
        return
      }
      if (code === "DRAWGUESS_JOIN_REQUIRED") {
        notify((res && res.error) || "Masuk game Draw & Guess dulu.", "error", {
          title: "Belum Join Game"
        })
        return
      }
      notify((res && res.error) || "Gagal memulai Draw & Guess", "error")
      return
    }
    notify("Draw & Guess dimulai", "success")
  })
}

function startWordrushRound() {
  const difficulty = normalizeWordrushDifficulty(
    wordrushDifficultySelect ? wordrushDifficultySelect.value : "medium"
  )
  socket.emit("wordrush start", { difficulty }, (res) => {
    if (!res || !res.ok) {
      const code = String((res && res.code) || "")
      if (code === "WORDRUSH_NEED_PLAYERS") {
        notify(`Minimal 2 pemain. Saat ini: ${formatPlayerList(res.players)}`, "error", {
          title: "Pemain Belum Cukup"
        })
        return
      }
      if (code === "WORDRUSH_JOIN_REQUIRED") {
        notify((res && res.error) || "Masuk game Word Rush dulu.", "error", {
          title: "Belum Join Game"
        })
        return
      }
      notify((res && res.error) || "Gagal memulai Word Rush", "error")
      return
    }
    const startedDifficulty = normalizeWordrushDifficulty(res && res.difficulty || difficulty)
    notify(`Word Rush ${startedDifficulty.toUpperCase()} dimulai`, "success")
  })
}

function toggleGamePanel() {
  setPanelVisible(!gamePanelVisible)
  if (!gamePanelVisible) {
    setActiveGameScreen("")
  }
  renderUi()
}

function initDrawGuessUi() {
  if (gameUiBound) return
  gameUiBound = true

  setPanelVisible(false)
  setSelectedGame("drawguess")
  setActiveGameScreen("")
  if (wordrushDifficultySelect) {
    wordrushDifficultySelect.value = "medium"
  }
  clearCanvasVisual()
  renderUi()

  if (drawguessToggleBtn) {
    drawguessToggleBtn.addEventListener("click", (event) => {
      event.preventDefault()
      toggleGamePanel()
    })
  }
  if (mobileGameBtn) {
    mobileGameBtn.addEventListener("click", (event) => {
      event.preventDefault()
      toggleGamePanel()
    })
  }

  if (gameItemDrawguess) {
    gameItemDrawguess.addEventListener("click", () => {
      enterGame("drawguess")
    })
  }
  if (gameItemWordrush) {
    gameItemWordrush.addEventListener("click", () => {
      enterGame("wordrush")
    })
  }
  if (gameRoomScreenBackBtn) {
    gameRoomScreenBackBtn.addEventListener("click", (event) => {
      event.preventDefault()
      leaveActiveGame()
    })
  }

  if (drawguessStartBtn) {
    drawguessStartBtn.addEventListener("click", (event) => {
      event.preventDefault()
      if (activeGameId !== "drawguess") return
      startDrawguessRound()
    })
  }
  if (drawguessClearBtn) {
    drawguessClearBtn.addEventListener("click", (event) => {
      event.preventDefault()
      if (activeGameId !== "drawguess") return
      socket.emit("drawguess clear")
    })
  }
  if (drawguessGuessBtn) {
    drawguessGuessBtn.addEventListener("click", (event) => {
      event.preventDefault()
      submitDrawguessGuess()
    })
  }
  if (drawguessGuessInput) {
    drawguessGuessInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      submitDrawguessGuess()
    })
  }

  if (wordrushStartBtn) {
    wordrushStartBtn.addEventListener("click", (event) => {
      event.preventDefault()
      if (activeGameId !== "wordrush") return
      startWordrushRound()
    })
  }
  if (wordrushGuessBtn) {
    wordrushGuessBtn.addEventListener("click", (event) => {
      event.preventDefault()
      submitWordrushGuess()
    })
  }
  if (wordrushGuessInput) {
    wordrushGuessInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      submitWordrushGuess()
    })
  }

  bindCanvasInteraction()
  window.addEventListener("resize", () => {
    if (gamePanelVisible && activeGameId === "drawguess") {
      resizeCanvas()
    }
    if (chatRoot) {
      chatRoot.classList.toggle("is-game-fullscreen", Boolean(activeGameId) && isMobileLayout())
    }
  })
  window.addEventListener("privix:no-channel", () => {
    resetDrawGuessUi()
  })
  if (channelSelect) {
    channelSelect.addEventListener("change", () => {
      setActiveGameScreen("")
      renderUi()
    })
  }
}

function handleGameLobbyState(payload) {
  const data = payload && typeof payload === "object" ? payload : {}
  gameLobbyState = {
    drawguess_players: Array.isArray(data.drawguess_players) ? data.drawguess_players : [],
    wordrush_players: Array.isArray(data.wordrush_players) ? data.wordrush_players : [],
    joined_game_id: String(data.joined_game_id || "")
  }
  const joinedGameId = getJoinedGameIdFromLobby()
  if (activeGameId && joinedGameId !== activeGameId) {
    setActiveGameScreen("")
  }
  renderUi()
}

function handleDrawGuessState(payload) {
  const data = payload && typeof payload === "object" ? payload : {}
  drawguessState = {
    active: Boolean(data.active),
    is_drawer: Boolean(data.is_drawer),
    drawer_username: String(data.drawer_username || ""),
    word_mask: String(data.word_mask || ""),
    round_ends_at_ts: Number(data.round_ends_at_ts || 0),
    scores: Array.isArray(data.scores) ? data.scores : [],
    participants: Array.isArray(data.participants) ? data.participants : []
  }
  drawguessStrokes = Array.isArray(data.strokes) ? [...data.strokes] : []
  renderUi()
}

function handleDrawGuessStroke(payload) {
  if (!payload || typeof payload !== "object") return
  drawguessStrokes.push(payload)
  if (activeGameId === "drawguess") {
    drawStroke(payload)
  }
}

function handleDrawGuessClear() {
  drawguessStrokes = []
  if (activeGameId === "drawguess") {
    redrawFromStrokes()
  }
}

function handleDrawGuessRoundEnded(payload) {
  const word = String((payload && payload.word) || "")
  const winner = String((payload && payload.winner_username) || "")
  if (winner) {
    notify(`${winner} menebak kata "${word}"`, "success")
    return
  }
  if (word) {
    notify(`Ronde selesai. Kata: ${word}`)
  }
}

function handleWordRushState(payload) {
  const data = payload && typeof payload === "object" ? payload : {}
  wordrushState = {
    active: Boolean(data.active),
    joined: Boolean(data.joined),
    difficulty: normalizeWordrushDifficulty(data.difficulty),
    word_hint: String(data.word_hint || ""),
    round_ends_at_ts: Number(data.round_ends_at_ts || 0),
    scores: Array.isArray(data.scores) ? data.scores : [],
    participants: Array.isArray(data.participants) ? data.participants : []
  }
  renderUi()
}

function handleWordRushRoundEnded(payload) {
  const word = String((payload && payload.word) || "")
  const winner = String((payload && payload.winner_username) || "")
  if (winner) {
    notify(`${winner} menang Word Rush: "${word}"`, "success")
    return
  }
  if (word) {
    notify(`Word Rush selesai. Kata: ${word}`)
  }
}

function resetDrawGuessUi() {
  clearDrawguessTimer()
  clearWordrushTimer()

  gameLobbyState = {
    drawguess_players: [],
    wordrush_players: [],
    joined_game_id: ""
  }
  drawguessState = {
    active: false,
    is_drawer: false,
    drawer_username: "",
    word_mask: "",
    round_ends_at_ts: 0,
    scores: [],
    participants: []
  }
  wordrushState = {
    active: false,
    joined: false,
    difficulty: "medium",
    word_hint: "",
    round_ends_at_ts: 0,
    scores: [],
    participants: []
  }

  drawguessStrokes = []
  isDrawing = false
  lastPoint = null
  if (drawguessGuessInput) drawguessGuessInput.value = ""
  if (wordrushGuessInput) wordrushGuessInput.value = ""

  setSelectedGame("drawguess")
  setActiveGameScreen("")
  setPanelVisible(false)
  clearCanvasVisual()
  renderUi()
  if (drawguessToggleBtn) {
    drawguessToggleBtn.classList.remove("is-live")
  }
}

export {
  initDrawGuessUi,
  handleGameLobbyState,
  handleDrawGuessState,
  handleDrawGuessStroke,
  handleDrawGuessClear,
  handleDrawGuessRoundEnded,
  handleWordRushState,
  handleWordRushRoundEnded,
  resetDrawGuessUi
}
