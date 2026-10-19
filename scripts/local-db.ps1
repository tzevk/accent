<#
.SYNOPSIS
	Start, stop, and inspect the local MariaDB instance used for testing.

.DESCRIPTION
	Production runs MariaDB 10.11.15, so local checks must run on MariaDB too.
	This machine has one instance for that purpose: the Windows service
	`MariaDB-accent-local` on 127.0.0.1:33369, with a data directory owned by
	an administrator. The service is set to manual start, so it runs only while
	a task needs it.

	The service needs an elevated token to start or stop. This script performs
	that elevation itself, so an agent never needs a visible dialog.

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
$ServiceName = 'MariaDB-accent-local'
$Client = 'C:\Program Files\MariaDB 10.11\bin\mariadb.exe'

function Test-PortOpen {
	param([int]$PortNumber)
	try {
		$client = New-Object System.Net.Sockets.TcpClient
		$task = $client.ConnectAsync('127.0.0.1', $PortNumber)
		if (-not $task.Wait(1500)) { return $false }
		$client.Close()
		return $true
	} catch {
		return $false
	}
}

function Invoke-Elevated {
	param([string]$Command)
	$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
	$process = Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile', '-EncodedCommand', $encoded -Wait -PassThru
	return $process.ExitCode
}

function Start-LocalDb {
	if (Test-PortOpen -PortNumber $Port) {
		Write-Output "MariaDB already listening on 127.0.0.1:$Port"
		return 0
	}
	$service = Get-Service $ServiceName -ErrorAction SilentlyContinue
	if ($null -eq $service) {
		Write-Output "Service $ServiceName not found. Start mysqld manually:"
		Write-Output "  & 'C:\Program Files\MariaDB 10.11\bin\mysqld.exe' --defaults-file='C:\ProgramData\MariaDB\accent-local\my.ini'"
		return 1
	}
	$exit = Invoke-Elevated -Command "Start-Service -Name '$ServiceName'; Start-Sleep -Seconds 2"
	Start-Sleep -Seconds 2
	if (Test-PortOpen -PortNumber $Port) {
		Write-Output "MariaDB started on 127.0.0.1:$Port"
		return 0
	}
	Write-Output "MariaDB did not start (elevated exit $exit)"
	return 1
}

function Stop-LocalDb {
	if (-not (Test-PortOpen -PortNumber $Port)) {
		Write-Output "MariaDB already stopped"
		return 0
	}
	$service = Get-Service $ServiceName -ErrorAction SilentlyContinue
	if ($null -ne $service) {
		Invoke-Elevated -Command "Stop-Service -Name '$ServiceName' -Force" | Out-Null
	}
	Start-Sleep -Seconds 2
	if (Test-PortOpen -PortNumber $Port) {
		Write-Output "MariaDB still listening on 127.0.0.1:$Port"
		return 1
	}
	Write-Output "MariaDB stopped"
	return 0
}

function Show-LocalDbStatus {
	$service = Get-Service $ServiceName -ErrorAction SilentlyContinue
	if ($null -eq $service) {
		Write-Output "service $ServiceName : not installed"
	} else {
		Write-Output ("service {0} : {1} ({2})" -f $service.Name, $service.Status, $service.StartType)
	}
	if (Test-PortOpen -PortNumber $Port) {
		Write-Output "port $Port : open"
		if (Test-Path $Client) {
			$version = & $Client --host=127.0.0.1 --port=$Port --user=root --skip-column-names --execute='SELECT VERSION();' 2>&1
			Write-Output "server version : $version"
		}
	} else {
		Write-Output "port $Port : closed"
	}
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
