@echo off
rem NotebookLM に固定の指示文を送って回答を取得する（スケジュール実行用）
rem 出力: data\reports\_notebooklm-answer-YYYYMMDD.md / tools\notebooklm-last-conversation.txt
rem ログ: tools\notebooklm-query.log

setlocal
set "PROJ=%~dp0.."
set "VENV_PY=%USERPROFILE%\.claude\skills\notebooklm\.venv\Scripts\python.exe"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

if not exist "%VENV_PY%" (
  echo [%date% %time%] venv python not found: %VENV_PY% >> "%~dp0notebooklm-query.log"
  exit /b 1
)

cd /d "%PROJ%"
"%VENV_PY%" "%~dp0notebooklm-query.py"
set "RC=%ERRORLEVEL%"
echo [%date% %time%] run-notebooklm-query.bat exit=%RC% >> "%~dp0notebooklm-query.log"
endlocal & exit /b %RC%
