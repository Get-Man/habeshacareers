# HabeshaCareers one-file local harvest launcher.
# Prompts for the Neon pooled DATABASE_URL (hidden), stores it into .env.local,
# verifies the DB connection, then runs the local catalog harvest.
# Progress-only output: never echoes the connection string.
$ErrorActionPreference = 'Stop'
try { $host.ui.RawUI.WindowTitle = 'HabeshaCareers local harvest' } catch {}

Write-Host ''
Write-Host '== HabeshaCareers local catalog harvest =='
Write-Host 'This harvests the three origins that reject Vercel server IPs:'
Write-Host '  - alljobspo (Jobs in Ethiopia)'
Write-Host '  - ethiopian-reporter (Ethiopian Reporter Jobs)'
Write-Host '  - ethiojobs-net-et'
Write-Host 'Runs ~45-60 minutes. You can minimize this window; keep it open.'
Write-Host 'It prints [slug batch] progress lines and finishes with HARVEST COMPLETE.'
Write-Host ''

if (-not (Test-Path (Join-Path $PWD 'scripts\_tmp_envcheck.mjs'))) {
  Write-Host 'ERROR: run this from the HabeshaCareer project folder (scripts subfolder missing).'
  Read-Host 'Press Enter to close'
  exit 1
}

$envPath = Join-Path $PWD '.env.local'
if (-not (Test-Path $envPath)) {
  Write-Host 'ERROR: .env.local not found in the current folder.'
  Read-Host 'Press Enter to close'
  exit 1
}

$sec = Read-Host 'Paste your Neon pooled DATABASE_URL now (input hidden)' -AsSecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$v = [Runtime.InteropServices.Marshal]::PtrToStringUni($b)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
if ($v -notmatch '^postgres(ql)?://') {
  Write-Host 'ERROR: the string must start with postgresql:// - run this script again.'
  Read-Host 'Press Enter to close'
  exit 1
}

$text = [IO.File]::ReadAllText($envPath)
[IO.File]::WriteAllText($envPath, [regex]::Replace($text, '(?m)^DATABASE_URL=.*$', 'DATABASE_URL=' + $v), [Text.UTF8Encoding]::new($false))
Write-Host 'Connection string stored locally (value never shown). Verifying...'
Write-Host ''

node scripts\_tmp_envcheck.mjs
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'DB connection check FAILED - harvest not started. Run this script again.'
  Read-Host 'Press Enter to close'
  exit 1
}

Write-Host ''
Write-Host 'DB check OK. Starting harvest (progress lines below)...'
Write-Host ''
node scripts\_tmp_local_backfill.mjs

Write-Host ''
Write-Host 'HARVEST COMPLETE - switch back to the chat and say: done'
Read-Host 'Press Enter to close'
