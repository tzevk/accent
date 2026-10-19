<#
.SYNOPSIS
	Start, stop, and inspect the local MariaDB instance used for testing.

.DESCRIPTION
	Production runs MariaDB 10.11.15, so local checks must run on MariaDB too.
	This machine has one instance for that purpose, owned by the current user
	and listening on 127.0.0.1:33369. The instance runs as a plain background
	process, so starting and stopping it never needs administrator rights and
	never shows a consent prompt.

	The instance lives in %LOCALAPPDATA%\AccentMariaDB. The MariaDB binaries
	stay in their install location: C:\Program Files\MariaDB 10.11\bin.

.EXAMPLE
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 start
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 status
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 stop
#>

param(
	[Parameter(Position = 0)]
	[ValidateSet('start', 'stop', 'status', 'restart')]
	[string]$Action = 'status',

	[int]$Port = 33369
)

$ErrorActionPreference = 'Continue'
$Bin = 'C:\Program Files\MariaDB 10.11\bin'
$Mysqld = Join-Path $Bin 'mysqld.exe'
$Admin = Join-Path $Bin 'mariadb-admin.exe'
$Client = Join-Path $Bin 'mariadb.exe'
$Root = Join-Path $env:LOCALAPPDATA 'AccentMariaDB'
$Data = Join-Path $Root 'data'
$Ini = Join-Path $Root 'my.ini'
$PidFile = Join-Path $Root 'mysqld.pid'

function Test-PortOpen {
	param([int]$PortNumber)
	try {
		$tcp = New-Object System.Net.Sockets.TcpClient
		$task = $tcp.ConnectAsync('127.0.0.1', $PortNumber)
		if (-not $task.Wait(1500)) { return $false }
		$tcp.Close()
		return $true
	} catch {
		return $false
	}
}

function Get-ServerPid {
	if (Test-Path $PidFile) {
		$recorded = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
		if ($recorded) { return [int]$recorded }
	}
	return $null
}

function Start-LocalDb {
	if (Test-PortOpen -PortNumber $Port) {
		Write-Output "MariaDB already listening on 127.0.0.1:$Port"
		return 0
	}
	if (-not (Test-Path $Mysqld)) {
		Write-Output "mysqld not found at $Mysqld"
		return 1
	}
	if (-not (Test-Path $Ini)) {
		Write-Output "config not found at $Ini"
		return 1
	}
	$process = Start-Process -FilePath $Mysqld -ArgumentList "--defaults-file=$Ini" -WindowStyle Hidden -PassThru
	$process.Id | Set-Content -Path $PidFile -Encoding ascii
	$deadline = (Get-Date).AddSeconds(45)
	while ((Get-Date) -lt $deadline) {
		if (Test-PortOpen -PortNumber $Port) {
			Write-Output "MariaDB started on 127.0.0.1:$Port (pid $($process.Id))"
			return 0
		}
		Start-Sleep -Milliseconds 500
	}
	Write-Output "MariaDB did not become ready; see $(Join-Path $Root 'error.log')"
	return 1
}

function Stop-LocalDb {
	if (-not (Test-PortOpen -PortNumber $Port)) {
		Write-Output 'MariaDB already stopped'
		return 0
	}
	# Clean shutdown first, so InnoDB flushes and the data directory stays consistent.
	if (Test-Path $Admin) {
		& $Admin --host=127.0.0.1 --port=$Port --user=root shutdown 2>&1 | Out-Null
	}
	$deadline = (Get-Date).AddSeconds(20)
	while ((Get-Date) -lt $deadline) {
		if (-not (Test-PortOpen -PortNumber $Port)) {
			Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
			Write-Output 'MariaDB stopped'
			return 0
		}
		Start-Sleep -Milliseconds 500
	}
	$pidValue = Get-ServerPid
	if ($pidValue) {
		Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
		Start-Sleep -Seconds 2
	}
	Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
	if (Test-PortOpen -PortNumber $Port) {
		Write-Output "MariaDB still listening on 127.0.0.1:$Port"
		return 1
	}
	Write-Output 'MariaDB stopped'
	return 0
}

function Show-LocalDbStatus {
	if (Test-PortOpen -PortNumber $Port) {
		Write-Output "port $Port : open"
		if (Test-Path $Client) {
			$version = & $Client --host=127.0.0.1 --port=$Port --user=root --skip-column-names --execute='SELECT VERSION();' 2>&1
			Write-Output "server version : $version"
		}
	} else {
		Write-Output "port $Port : closed"
	}
	$pidValue = Get-ServerPid
	if ($pidValue) {
		$running = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
		if ($running) { Write-Output "process : pid $pidValue" }
	}
	Write-Output "instance : $Root"
}

switch ($Action) {
	'start' { exit (Start-LocalDb) }
	'stop' { exit (Stop-LocalDb) }
	'restart' {
		Stop-LocalDb | Out-Null
		exit (Start-LocalDb)
	}
	default {
		Show-LocalDbStatus
		exit 0
	}
}
