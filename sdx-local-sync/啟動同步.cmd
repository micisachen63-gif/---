@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SD x Winmalo - B2B 同步（90秒）
echo.
echo ======================================================
echo    SD x 贏麻了  B2B + Google Sheets 同步
echo ======================================================
echo 位置：%CD%
echo 目前頻率：每 90 秒為目標開始一輪，網頁每 30 秒讀取榜單
echo 密碼只在本機輸入，畫面不會顯示任何字元。
echo.
python -u "%~dp0sync_b2b.py" --loop --interval 90
set "SYNC_EXIT_CODE=%ERRORLEVEL%"
echo.
echo ======================================================
echo  同步程式已結束，代碼：%SYNC_EXIT_CODE%
echo  若非手動按 Ctrl+C，請查看上方的進度／錯誤訊息。
echo  也可開啟本資料夾 sync-status.json 核對最後執行狀態。
echo ======================================================
pause
endlocal
