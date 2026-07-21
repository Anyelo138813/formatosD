param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot '..\.env'),
  [string]$OutputFile = (Join-Path $PSScriptRoot '..\env.js')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
  throw "No existe $EnvironmentFile. Copia .env.example a .env y configura las variables."
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $name, $value = $line -split '=', 2
  $values[$name.Trim()] = $value.Trim().Trim('"').Trim("'")
}

foreach ($required in 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY') {
  if ([string]::IsNullOrWhiteSpace($values[$required])) {
    throw "Falta $required en $EnvironmentFile."
  }
}

$url = ConvertTo-Json ([string]$values.SUPABASE_URL) -Compress
$key = ConvertTo-Json ([string]$values.SUPABASE_PUBLISHABLE_KEY) -Compress
$content = @"
// Generated file. Do not commit environment-specific values.
globalThis.__APP_ENV__ = Object.freeze({
  SUPABASE_URL: $url,
  SUPABASE_PUBLISHABLE_KEY: $key
});
"@

[System.IO.File]::WriteAllText((Resolve-Path (Split-Path $OutputFile -Parent)).Path + '\' + (Split-Path $OutputFile -Leaf), $content, [System.Text.UTF8Encoding]::new($false))
Write-Host "Configuración pública generada en $OutputFile"
