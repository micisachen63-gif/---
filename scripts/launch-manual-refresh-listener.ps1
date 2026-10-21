param([string]$NodePath = '')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$listenerPath = Join-Path $projectRoot 'scripts\manual-refresh-listener.mjs'
if ([string]::IsNullOrWhiteSpace($NodePath)) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = [IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node.js executable not found.' }
if (-not (Test-Path -LiteralPath $listenerPath -PathType Leaf)) { throw 'Manual refresh listener not found.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'private\site-service-token.dpapi'))) { throw 'Encrypted Site service token is not configured.' }
# Prevent a second listener from this same checkout while allowing unrelated Node apps.
$listenerMatch = $listenerPath.Replace('/', '\').ToLowerInvariant()
$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\').ToLowerInvariant().Contains($listenerMatch) }
if ($existing) { exit 0 }
$child = Start-Process -FilePath $NodePath -ArgumentList @('"' + $listenerPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$child.WaitForExit()
exit $child.ExitCode
