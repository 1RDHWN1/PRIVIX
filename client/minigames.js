import { msgInput } from "./dom.js"
import { CHANNEL_TYPE_VOICE, MAX_MESSAGE_LENGTH } from "./constants.js"
import { notify } from "./notice.js"
import { socket } from "./socket.js"
import { getActiveChannelInfo } from "./session.js"

const RPS_CHOICES = ["rock", "paper", "scissors"]
const RPS_LABELS = {
  rock: "Rock",
  paper: "Paper",
  scissors: "Scissors"
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function canPostMiniGameResult() {
  const channelInfo = getActiveChannelInfo()
  if (channelInfo && channelInfo.type === CHANNEL_TYPE_VOICE) {
    notify("Minigames hanya bisa dipakai di text channel")
    return false
  }
  if (!socket || !socket.connected) {
    notify("Belum tersambung ke server", "error")
    return false
  }
  return true
}

function postMiniGameResult(message, replyToMessageId = null) {
  if (!canPostMiniGameResult()) return false
  const safeMessage = String(message || "").slice(0, MAX_MESSAGE_LENGTH)
  socket.emit("chat message", {
    message: safeMessage,
    reply_to_message_id: replyToMessageId || null
  })
  return true
}

function buildRollResult(args) {
  const diceText = String(args[0] || "d6").toLowerCase()
  const match = diceText.match(/^(\d*)d(\d+)$/)
  if (!match) {
    return {
      error: "Format dice: /roll d20 atau /roll 2d6"
    }
  }

  const count = Math.max(1, Math.min(Number(match[1] || 1), 20))
  const sides = Math.max(2, Math.min(Number(match[2] || 6), 1000))
  const rolls = Array.from({ length: count }, () => randomInt(1, sides))
  const total = rolls.reduce((sum, value) => sum + value, 0)
  const detail = count === 1 ? String(total) : `${rolls.join(" + ")} = ${total}`

  return {
    message: `Minigame Dice Roll: ${count}d${sides} -> ${detail}`
  }
}

function buildFlipResult() {
  const result = Math.random() < 0.5 ? "Heads" : "Tails"
  return {
    message: `Minigame Coin Flip: ${result}`
  }
}

function buildRpsResult(args) {
  const playerChoice = String(args[0] || "").toLowerCase()
  if (!RPS_CHOICES.includes(playerChoice)) {
    return {
      error: "Pakai: /rps rock, /rps paper, atau /rps scissors"
    }
  }

  const botChoice = RPS_CHOICES[randomInt(0, RPS_CHOICES.length - 1)]
  const isDraw = playerChoice === botChoice
  const didWin =
    (playerChoice === "rock" && botChoice === "scissors") ||
    (playerChoice === "paper" && botChoice === "rock") ||
    (playerChoice === "scissors" && botChoice === "paper")
  const result = isDraw ? "Draw" : didWin ? "You win" : "Privix wins"

  return {
    message: `Minigame RPS: You picked ${RPS_LABELS[playerChoice]}, Privix picked ${RPS_LABELS[botChoice]} -> ${result}`
  }
}

function buildGuessResult(args) {
  const guess = Number(args[0])
  if (!Number.isInteger(guess) || guess < 1 || guess > 10) {
    return {
      error: "Pakai angka 1-10, contoh: /guess 7"
    }
  }

  const answer = randomInt(1, 10)
  const result = guess === answer ? "Benar" : "Belum kena"
  return {
    message: `Minigame Guess 1-10: tebakan ${guess}, angka Privix ${answer} -> ${result}`
  }
}

function buildHelpResult() {
  return {
    message: "Minigames tersedia: /roll d20, /roll 2d6, /flip, /rps rock|paper|scissors, /guess 1-10"
  }
}

function buildMiniGameResult(rawCommand) {
  const parts = String(rawCommand || "").trim().split(/\s+/).filter(Boolean)
  const command = String(parts.shift() || "").toLowerCase()

  if (command === "/roll") return buildRollResult(parts)
  if (command === "/flip") return buildFlipResult()
  if (command === "/rps") return buildRpsResult(parts)
  if (command === "/guess") return buildGuessResult(parts)
  if (command === "/games" || command === "/game") return buildHelpResult()

  return null
}

function handleMiniGameCommand(rawCommand, options = {}) {
  const result = buildMiniGameResult(rawCommand)
  if (!result) return false
  if (result.error) {
    notify(result.error, "error")
    return true
  }
  postMiniGameResult(result.message, options.replyToMessageId)
  return true
}

function initMiniGames() {
  const section = document.getElementById("section-minigames")
  if (!section) return

  section.addEventListener("click", (event) => {
    const button = event.target.closest("[data-minigame-command]")
    if (!button) return
    event.preventDefault()

    const command = String(button.dataset.minigameCommand || "").trim()
    if (!command) return
    if (msgInput) {
      msgInput.value = command
      msgInput.focus()
      msgInput.dispatchEvent(new Event("input", { bubbles: true }))
    }
    notify("Command minigame siap. Tekan Send untuk main.")
  })
}

export { handleMiniGameCommand, initMiniGames }
