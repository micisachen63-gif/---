param(
 [string]$TaskName = 'RoyalOperationsManualRefreshListener',
 [string]$NodePath = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcher = Join-Path $PSScriptRoot 'launch-manual-refresh-listener.ps1'
if ([string]::IsNullOrWhiteSpace($NodePath)) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = [IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node.js executable not found.' }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Listener launcher not found.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'private\site-service-token.dpapi'))) { throw 'Encrypted Site service token is not configured.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$prior = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($prior -and $prior.Principal.UserId -ne $identity) { throw 'Existing task belongs to another Windows user.' }
$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -NodePath "' + $NodePath + '"'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 1 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Poll the private dashboard refresh queue every 15 seconds after this Windows user signs in. Uses CurrentUser DPAPI; no plaintext credentials in the task.'
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
$saved = Get-ScheduledTask -TaskName $TaskName
[PSCustomObject]@{TaskName=$saved.TaskName;State=[string]$saved.State;UserId=$saved.Principal.UserId;LogonType=[string]$saved.Principal.LogonType;Trigger='AtLogOn';HiddenWindow=$true;StartWhenAvailable=$saved.Settings.StartWhenAvailable;MultipleInstances=[string]$saved.Settings.MultipleInstances;StartedNow=$false} | ConvertTo-Json
