$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envCandidates = @(
  (Join-Path $root ".env.turn"),
  (Join-Path $PSScriptRoot ".env.turn")
)

$envFile = $null
foreach ($candidate in $envCandidates) {
  if (Test-Path $candidate) {
    $envFile = $candidate
    break
  }
}

if (-not $envFile) {
  Write-Host "Missing .env.turn."
  Write-Host "Create one in C:\\PRIVIX\\.env.turn or C:\\PRIVIX\\scripts\\.env.turn"
  Write-Host "Template: scripts\\turn.env.example"
  exit 1
}

$loaded = @{}

Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line.Length -eq 0) { return }
  if ($line.StartsWith("#")) { return }
  $pair = $line -split "=", 2
  if ($pair.Length -ne 2) { return }
  $name = $pair[0].Trim()
  $value = $pair[1].Trim()
  if ($name.Length -eq 0) { return }
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
  $loaded[$name] = $value
}

$hasPgParts =
  $loaded.ContainsKey("PGHOST") -or
  $loaded.ContainsKey("PGPORT") -or
  $loaded.ContainsKey("PGDATABASE") -or
  $loaded.ContainsKey("PGUSER") -or
  $loaded.ContainsKey("PGPASSWORD")

$hasExplicitUrl =
  $loaded.ContainsKey("DATABASE_URL") -or
  $loaded.ContainsKey("PRIVIX_DATABASE_URL")

if ($hasPgParts -and -not $hasExplicitUrl) {
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $null, "Process")
  [Environment]::SetEnvironmentVariable("PRIVIX_DATABASE_URL", $null, "Process")
}

npm start
