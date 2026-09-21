@echo off
setlocal enabledelayedexpansion

rem ===========================================================================
rem  SmartOffice attendance sync - register the Task Scheduler entry and verify
rem  it with one real run. Pure cmd: no PowerShell required.
rem
rem    setup-task.bat            register as SYSTEM  (run this cmd as administrator)
rem    setup-task.bat /user      register as the signed-in user (no admin needed,
rem                              but the task only runs while that user is
rem                              signed in)
rem
rem  Run it from the deployed folder (e.g. C:\smartoffice-sync). It reads
rem  task.xml next to it, fills in the paths/principal, and creates the task
rem  "SmartOffice Attendance Sync" (an existing task of that name is replaced).
rem ===========================================================================

set "TASK_NAME=SmartOffice Attendance Sync"
set "SYNC_DIR=%~dp0"
if "%SYNC_DIR:~-1%"=="\" set "SYNC_DIR=%SYNC_DIR:~0,-1%"
set "SYNC_MJS=%SYNC_DIR%\sync.mjs"
set "TEMPLATE=%SYNC_DIR%\task.xml"
set "GEN_XML=%TEMP%\smartoffice-attendance-task.xml"
set "AS_USER="
if /i "%~1"=="/user" set "AS_USER=1"
if /i "%~1"=="/current-user" set "AS_USER=1"

echo.
echo == SmartOffice attendance sync: task setup ==
echo    folder : %SYNC_DIR%

if not exist "%SYNC_MJS%" (
	echo ERROR: sync.mjs is not next to this script.
	echo        Run setup-task.bat from the deployed folder.
	exit /b 1
)
if not exist "%TEMPLATE%" (
	echo ERROR: task.xml is not next to this script.
	exit /b 1
)

rem --- node.exe -------------------------------------------------------------
set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE (
	echo ERROR: node.exe not found. Install Node.js 18+ ^(or put it on PATH^).
	exit /b 1
)
echo    node   : %NODE_EXE%

rem --- dependencies + config ------------------------------------------------
if not exist "%SYNC_DIR%\node_modules\mssql" (
	echo    deps   : installing ^(node_modules\mssql missing^)
	pushd "%SYNC_DIR%"
	call npm install
	if errorlevel 1 (
		popd
		echo ERROR: npm install failed. Fix that first - the task would exit immediately.
		exit /b 1
	)
	popd
)
if not exist "%SYNC_DIR%\.env" (
	echo ERROR: .env is missing.
	echo        copy .env.example .env  then fill in WEBHOOK_URL / WEBHOOK_SECRET
	echo        ^(see the Settings table in README.md^), and re-run this script.
	exit /b 1
)

rem --- principal ------------------------------------------------------------
rem SYSTEM has no <LogonType> element on purpose: schtasks rejects
rem LogonType=ServiceAccount ("value incorrectly formatted"), and the SID
rem S-1-5-18 with no logon type is what Task Scheduler itself exports.
if defined AS_USER (
	set "PRINCIPAL_USER=%USERDOMAIN%\%USERNAME%"
	set "PRINCIPAL_LOGON=InteractiveToken"
	set "PRINCIPAL_RUNLEVEL="
) else (
	set "PRINCIPAL_USER=S-1-5-18"
	set "PRINCIPAL_LOGON="
	set "PRINCIPAL_RUNLEVEL=HighestAvailable"
)
echo    runs as: %PRINCIPAL_USER%

rem --- fill in task.xml -----------------------------------------------------
> "%GEN_XML%" (
	for /f "usebackq eol=| delims=" %%L in ("%TEMPLATE%") do (
		set "line=%%L"
		set "line=!line:__NODE_EXE__=%NODE_EXE%!"
		set "line=!line:__SYNC_MJS__=%SYNC_MJS%!"
		set "line=!line:__SYNC_DIR__=%SYNC_DIR%!"
		set "line=!line:__PRINCIPAL_USER__=%PRINCIPAL_USER%!"
		if not "%PRINCIPAL_LOGON%"=="" set "line=!line:__PRINCIPAL_LOGON__=%PRINCIPAL_LOGON%!"
		if not "%PRINCIPAL_RUNLEVEL%"=="" set "line=!line:__PRINCIPAL_RUNLEVEL__=%PRINCIPAL_RUNLEVEL%!"
		rem drop principal lines whose token had no value (e.g. LogonType for SYSTEM)
		if not "!line:__PRINCIPAL_=!"=="!line!" set "line="
		if defined line echo(!line!
	)
)
if not exist "%GEN_XML%" (
	echo ERROR: could not generate the task XML.
	exit /b 1
)
echo    xml    : %GEN_XML%

rem --- register -------------------------------------------------------------
if not defined AS_USER (
	net session >nul 2>&1
	if errorlevel 1 (
		echo.
		echo ERROR: registering the task as SYSTEM needs an elevated cmd.
		echo        Close this window, right-click Command Prompt, choose
		echo        "Run as administrator", then run setup-task.bat again
		echo        ^(the XML above is already filled in and will be reused^).
		echo        No admin rights? Use:  setup-task.bat /user
		exit /b 1
	)
)
echo.
echo    registering "%TASK_NAME%" ...
schtasks /Create /TN "%TASK_NAME%" /XML "%GEN_XML%" /F
if errorlevel 1 (
	echo.
	echo ERROR: schtasks /Create failed - see the message above.
	echo        "unable to switch the encoding" means task.xml got an encoding attribute.
	exit /b 1
)

rem --- verify with one real run --------------------------------------------
set "LOG=%SYNC_DIR%\sync.log"
set "LOGNAME="
for /f "usebackq tokens=1,* delims==" %%A in ("%SYNC_DIR%\.env") do if /i "%%A"=="LOG_FILE" if not "%%B"=="" set "LOGNAME=%%B"
if defined LOGNAME set "LOG=%SYNC_DIR%\%LOGNAME%"

echo.
echo == running the task once now ^(a real pass; the webhook upserts, so repeats are safe^) ==
schtasks /Run /TN "%TASK_NAME%"
rem ~25s: SQL Browser resolve + shard query + POST. "timeout" needs a console
rem stdin, so use ping for the delay instead.
ping -n 26 127.0.0.1 >nul
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST | findstr /I "Status Logon Run As Power Next Run Time Last Run Time Last Result Task To Run Start In"

echo.
echo == %LOG% (last lines) ==
rem No "!" anywhere in this one-liner: delayed expansion would eat it.
"%NODE_EXE%" -e "const fs=require('fs');const p=process.argv[1];if(fs.existsSync(p)){const l=fs.readFileSync(p,'utf8').replace(/\s+$/,'').split(/\r?\n/);console.log(l.slice(-15).join('\n'))}else{console.log('(no log yet at '+p+')')}" "%LOG%"

echo.
echo == done ==
echo    Last Result 0            = the scheduled pass ran and was accepted
echo    Last Result 1            = it ran and failed - the reason is in the log above
echo    Last Result 2            = bad argument in the task action
echo    Last Result 267011       = has not run yet
echo    Last Result 267009       = a pass is still running ^(wait, then re-check^)
echo    Last Result -2147024894  = node.exe path in the task does not exist
echo    Power Management must be empty - any text there means the task is gated
echo.
echo    To undo:  schtasks /Delete /TN "%TASK_NAME%" /F
endlocal
