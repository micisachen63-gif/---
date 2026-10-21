param(
 [string]$TaskName = 'RoyalOperationsDashboard0800',
 [string]$NodePath = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$updater = Join-Path $projectRoot 'scripts\standalone-refresh.mjs'
$tokenFile = Join-Path $projectRoot 'private\site-service-token.dpapi'
if (-not (Test-Path -LiteralPath $updater -PathType Leaf)) { throw '找不到獨立更新程式。' }
if (-not (Test-Path -LiteralPath $tokenFile -PathType Leaf)) { throw '請先以目前 Windows 使用者 DPAPI 加密設定 Site service token。' }
if ([string]::IsNullOrWhiteSpace($NodePath)) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = [IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw '找不到 Node.js。' }
$zone = [TimeZoneInfo]::Local.Id
if ($zone -ne 'Taipei Standard Time') { throw "目前 Windows 時區為 $zone；此排程要求 Asia/Taipei，請先確認系統時區。" }
$userIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$prior = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($prior -and $prior.Principal.UserId -ne $userIdentity) { throw '同名排程屬於不同使用者，停止覆寫。' }

# Windows PowerShell is the hidden launcher; the service token never enters its arguments.
# Explicit escaping is safe because verified filesystem paths cannot contain double quotes.
$launchCode = "& '$($NodePath.Replace("'", "''"))' '$($updater.Replace("'", "''"))'; exit `$LASTEXITCODE"
$encodedLauncher = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launchCode))
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $encodedLauncher" -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
$principal = New-ScheduledTaskPrincipal -UserId $userIdentity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 1 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '每日08:00等待原營運後台收集完成後，驗證來源並更新私人儀表盤，再讀回比對。最多重試1次；不需每日啟動Codex。'
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
$saved = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[PSCustomObject]@{ TaskName=$saved.TaskName; State=[string]$saved.State; UserId=$saved.Principal.UserId; LogonType=[string]$saved.Principal.LogonType; NextRunTime=$info.NextRunTime; MultipleInstances=[string]$saved.Settings.MultipleInstances; RestartCount=$saved.Settings.RestartCount; RestartInterval=$saved.Settings.RestartInterval; StartWhenAvailable=$saved.Settings.StartWhenAvailable; Timezone=$zone } | ConvertTo-Json
