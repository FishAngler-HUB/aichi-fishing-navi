@echo off
rem Wrapper for Windows Task Scheduler / manual double-click.
rem ASCII-only and CRLF on purpose (Task Scheduler safe).
rem All output is appended to tools\fetch.log .

setlocal

rem Move to the project root (folder above this "tools" folder).
cd /d "%~dp0.."

set "LOG=%~dp0fetch.log"
set "NODE=node"
if not exist "%NODE%" if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"

>>"%LOG%" echo.
>>"%LOG%" echo ===== %date% %time% run-update.bat start =====
>>"%LOG%" echo cwd=%CD%
>>"%LOG%" 2>&1 where node
>>"%LOG%" 2>&1 "%NODE%" "tools\update-forecast.js"
set "EC=%ERRORLEVEL%"
>>"%LOG%" echo ===== end (exit %EC%) =====

endlocal & exit /b %EC%
