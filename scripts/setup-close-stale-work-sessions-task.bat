@echo off
setlocal enabledelayedexpansion

rem ===========================================================================
rem Work Session sweep - register the Task Scheduler entry and verify it with
rem one real run. Pure cmd: no PowerShell required.
rem
rem    setup-close-stale-work-sessions-task.bat            register as SYSTEM
rem                                                        (run this cmd as
rem                                                        administrator)
rem    setup-close-stale-work-sessions-task.bat /user      register as the
rem                                                        signed-in user (no
rem                                                        admin needed, but the
rem                                                        task only runs while
rem                                                        that user is signed in)
rem
rem  Run it from the repo root (the folder that holds package.json and .env).
rem  It reads close-stale-work-sessions.task.xml next to this file, fills in
rem  the node executable, the script path and the principal, and creates the
rem  task "Accent Work Session Sweep" (an existing task of that name is
rem  replaced). The schedule lives in the task: every five minutes.
rem ===========================================================================

set "TASK_NAME=Accent Work Session Sweep"
set "ROOT_DIR=%~dp0.."
rem the sweep runs from the repo root, so the working directory is that root
set "SWEEP_DIR=%ROOT_DIR%"
if "%SWEEP_DIR:~-1%"=="\" set "SWEEP_DIR=%SWEEP_DIR:~0,-1%"
set "SWEEP_MJS=%SWEEP_DIR%\scripts\close-stale-work-sessions.mjs"
set "TEMPLATE=%~dp0close-stale-work-sessions.task.xml"
set "GEN_XML=%TEMP%\accent-work-session-sweep-task.xml"
set "AS_USER="
if /i "%~1"=="/user" set "AS_USER=1"
if /i "%~1"=="/current-user" set "AS_USER=1"

echo.
echo == Accent Work Session sweep: task setup ==
echo    folder : %SWEEP_DIR%

if not exist "%SWEEP_MJS%" (
	echo ERROR: scripts\close-stale-work-sessions.mjs is not next to this script.
	echo        Run setup-close-stale-work-sessions-task.bat from the repo root.
	exit /b 1
)
if not exist "%TEMPLATE%" (
	echo ERROR: close-stale-work-sessions.task.xml is not next to this script.
	exit /b 1
)
if not exist "%SWEEP_DIR%\.env" (
	echo ERROR: .env is missing in %SWEEP_DIR%.
	echo        The sweep reads the database credentials from it, and the task
	echo        runs with that folder as its working directory.
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
		set "line=!line:__SWEEP_MJS__=%SWEEP_MJS%!"
		set "line=!line:__SWEEP_DIR__=%SWEEP_DIR%!"
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
		echo        "Run as administrator", then run this script again.
		echo        No admin rights? Use:  setup-close-stale-work-sessions-task.bat /user
		exit /b 1
	)
)
echo.
echo    registering "%TASK_NAME%" ...
schtasks /Create /TN "%TASK_NAME%" /XML "%GEN_XML%" /F
if errorlevel 1 (
	echo.
	echo ERROR: schtasks /Create failed - see the message above.
	echo        "unable to switch the encoding" means the task.xml has an
	echo        encoding attribute.
	exit /b 1
)

rem --- verify with one real run ---------------------------------------------
echo.
echo == running the sweep once now ^(a real pass; only stale sessions move^) ==
schtasks /Run /TN "%TASK_NAME%"
rem a pass takes about a second; wait, then read its state
ping -n 6 127.0.0.1 >nul
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST | findstr /I "Status Logon Run As Next Run Time Last Run Time Last Result Task To Run Start In"

echo.
echo == done ==
echo    Last Result 0            = the scheduled pass ran
echo    Last Result 1            = it ran and failed - run the script by hand to
echo                               see the reason:
echo                               node scripts\close-stale-work-sessions.mjs
echo    Last Result 267009       = a pass is still running
echo    Next Run Time            = should be at the next five-minute mark
echo.
echo    To undo:  schtasks /Delete /TN "%TASK_NAME%" /F
endlocal
