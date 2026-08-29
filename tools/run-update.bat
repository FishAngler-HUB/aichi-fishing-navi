@echo off
rem Wrapper for Windows Task Scheduler / manual double-click.
rem ASCII-only and CRLF on purpose (Task Scheduler safe).
rem All output is appended to tools\fetch.log .

setlocal

rem Move to the project root (folder above this "tools" folder).
cd /d "%~dp0.."

set "LOG=%~dp0fetch.log"

rem Resolve node.exe : PATH first, then common install locations.
set "NODE="
for %%I in (node.exe) do set "NODE=%%~$PATH:I"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"

>>"%LOG%" echo.
>>"%LOG%" echo ===== %date% %time% run-update.bat start =====

if not defined NODE (
  >>"%LOG%" echo ERROR: node.exe not found. Please install Node.js from https://nodejs.org/
  endlocal & exit /b 9009
)

>>"%LOG%" echo node=%NODE%
>>"%LOG%" 2>&1 "%NODE%" "tools\update-forecast.js"
set "EC=%ERRORLEVEL%"
>>"%LOG%" echo ===== end (exit %EC%) =====

endlocal & exit /b %EC%
