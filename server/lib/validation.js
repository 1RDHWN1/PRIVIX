function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function isValidLength(value, maxLength) {
  return value.length > 0 && value.length <= maxLength
}

module.exports = {
  normalizeText,
  isValidLength
}
