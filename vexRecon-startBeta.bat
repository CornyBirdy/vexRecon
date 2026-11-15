@echo off
setlocal
title Recon (vexRecon beta)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this again.
  pause & exit /b 1
)

:: First run: nothing downloaded yet, so download the beta branch straight away
if not exist vexRecon goto download

:menu
echo.
echo  Recon (vexRecon beta)
echo  ---------------------
echo  [1] Start Recon
echo  [2] Download latest beta, then start  (keeps your .dev.vars)
echo  [3] Fresh re-download of beta, then start  (deletes the old copy, keeps your .dev.vars)
echo  [4] Quit
echo.
choice /c 1234 /n /m "Choose 1-4: "
if errorlevel 4 exit /b 0
if errorlevel 3 goto fresh
if errorlevel 2 goto update
goto run

:update
if exist vexRecon\.git (
  pushd vexRecon
  git fetch origin beta && git checkout beta && git reset --hard origin/beta
  popd
  call :install
  goto run
)
:: No git repo (zip install): fall through to a fresh download
:fresh
if exist vexRecon\.dev.vars copy /y vexRecon\.dev.vars env.backup >nul
if exist vexRecon rmdir /s /q vexRecon
:download
where git >nul 2>nul
if errorlevel 1 (
  echo Git not found, downloading the beta branch as a zip...
  powershell -NoProfile -Command "Invoke-WebRequest https://github.com/CornyBirdy/vexRecon/archive/refs/heads/beta.zip -OutFile beta.zip; Expand-Archive beta.zip -DestinationPath . -Force; Rename-Item vexRecon-beta vexRecon; Remove-Item beta.zip"
) else (
  git clone --branch beta https://github.com/CornyBirdy/vexRecon.git
)
if not exist vexRecon (
  echo Download failed. Check your internet connection.
  pause & exit /b 1
)
if exist env.backup move /y env.backup vexRecon\.dev.vars >nul
call :install
goto run

:install
pushd vexRecon
call npm install
popd
exit /b 0

:run
cd /d "%~dp0vexRecon"

set "NEEDKEY="
if not exist .dev.vars set "NEEDKEY=1"
if exist .dev.vars (
  findstr /r /c:"^ROBOTEVENTS_KEY=." .dev.vars >nul 2>nul || (findstr /c:"# key skipped" .dev.vars >nul 2>nul || set "NEEDKEY=1")
)
if defined NEEDKEY call :askkey

if not exist node_modules call npm install

echo.
echo Starting Recon at http://localhost:8888
start "" http://localhost:8888
call npm run dev
pause
goto :eof

:askkey
:: Asked in its own routine so %KEY% is read AFTER you type it (inside an if ( ) block it would always be empty).
echo.
echo Paste your RobotEvents API key, or just press Enter to skip.
echo Without a key, team numbers aren't checked and event import won't work.
set "KEY="
set /p "KEY=ROBOTEVENTS_KEY: "
if exist .dev.vars (findstr /v /b /c:"ROBOTEVENTS_KEY=" /c:"# key skipped" .dev.vars > .dev.vars.tmp) else (type nul > .dev.vars.tmp)
if defined KEY (>> .dev.vars.tmp echo ROBOTEVENTS_KEY=%KEY%) else (>> .dev.vars.tmp echo # key skipped)
findstr /b /c:"ADMIN_CODE=" .dev.vars.tmp >nul 2>nul || >> .dev.vars.tmp echo ADMIN_CODE=test
move /y .dev.vars.tmp .dev.vars >nul
exit /b 0
