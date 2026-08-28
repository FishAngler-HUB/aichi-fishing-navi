@echo off
rem ============================================================
rem  釣り情報ツール - 天気データ自動更新
rem  タスクスケジューラからも、手動ダブルクリックからも使えます。
rem  ログは同じフォルダの fetch.log に追記されます。
rem ============================================================

rem このバッチがある tools フォルダの 1つ上（プロジェクト直下）へ移動
cd /d "%~dp0.."

rem Node で更新スクリプトを実行
node "tools\update-forecast.js"
set EXITCODE=%ERRORLEVEL%

rem Node 自体が起動できなかった場合の保険ログ
if %EXITCODE% GEQ 1 (
  echo [%date% %time%] run-update.bat: node terminated with exit code %EXITCODE% >> "%~dp0fetch.log"
)

exit /b %EXITCODE%
