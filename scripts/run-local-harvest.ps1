# HabeshaCareers one-file local harvest launcher.
# Prompts for the Neon pooled DATABASE_URL (hidden), stores it into .env.local,
# verifies the DB connection, then runs the local catalog harvest.
# Progress-only output: never echoes the connection string.
try { $host.ui.RawUI.WindowTitle = 'HabeshaCareers local harvest' } catch {}
$ErrorActionPreference = 'Continue'  # show errors instead of vanishing; we check exit codes ourselves

function Pause-End([string]$msg = 'Press Enter to close') {
  Write-Host ''
  try { Read-Host $msg | Out-Null } catch { Start-Sleep -Seconds 30 }
}

try {
  Write-Host ''
  Write-Host '== HabeshaCareers local catalog harvest =='
  Write-Host 'This harvests the three origins that reject Vercel server IPs:'
  Write-Host '  - alljobspo (Jobs in Ethiopia)'
  Write-Host '  - ethiopian-reporter (Ethiopian Reporter Jobs)'
  Write-Host '  - ethiojobs-net-et'
  Write-Host 'Runs ~45-60 minutes. You can minimize this window; keep it open.'
  Write-Host 'It prints [slug batch] progress lines and finishes with HARVEST COMPLETE.'
  Write-Host ''

  # Resolve project root: prefer the script's own location so cwd doesn't matter.
  $root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
  Set-Location $root

  if (-not (Test-Path (Join-Path $root 'scripts\_tmp_envcheck.mjs'))) {
    Write-Host "ERROR: project scripts not found under: $root"
    Write-Host 'Open PowerShell, cd to your HabeshaCareer folder, and run:'
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\run-local-harvest.ps1'
    Pause-End; exit 1
  }

  $envPath = Join-Path $root '.env.local'
  if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env.local not found at: $envPath"
    Pause-End; exit 1
  }

  $sec = Read-Host 'Paste your Neon pooled DATABASE_URL now (input hidden)' -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $v = [Runtime.InteropServices.Marshal]::PtrToStringUni($b)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
  # Be forgiving: accept if they pasted the whole "DATABASE_URL=..." line or wrapped in quotes.
  $v = $v.Trim()
  if ($v -match '^DATABASE_URL\s*=\s*(.+)$') { $v = $Matches[1].Trim() }
  if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
  if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length - 2) }
  $v = $v.Trim()

  if ($v -notmatch '^postgres(ql)?://') {
    Write-Host 'ERROR: the string must start with postgresql:// (the pooled Neon connection string).'
    Write-Host 'Tip: in Neon Console -> Connect -> choose "Pooled connection" -> Copy.'
    Pause-End; exit 1
  }

  $text = [IO.File]::ReadAllText($envPath)
  [IO.File]::WriteAllText($envPath, [regex]::Replace($text, '(?m)^DATABASE_URL=.*$', 'DATABASE_URL=' + $v), [Text.UTF8Encoding]::new($false))
  Write-Host 'Connection string stored locally (value never shown). Verifying...'
  Write-Host ''

  node scripts\_tmp_envcheck.mjs
  $check = $LASTEXITCODE
  if ($check -ne 0) {
    Write-Host ''
    Write-Host "DB connection check FAILED (exit $check) - harvest not started."
    Write-Host 'Common causes: wrong password, used the direct (non-pooled) URL, or the project is paused.'
    Write-Host 'Fix the string and run this script again.'
    Pause-End; exit 1
  }

  Write-Host ''
  Write-Host 'DB check OK. Starting harvest (progress lines below)...'
  Write-Host ''
  node scripts\_tmp_local_backfill.mjs

  Write-Host ''
  Write-Host 'HARVEST COMPLETE - switch back to the chat and say: done'
  Pause-End
} catch {
  Write-Host ''
  Write-Host 'UNEXPECTED ERROR:'
  Write-Host $_
  Pause-End
}
