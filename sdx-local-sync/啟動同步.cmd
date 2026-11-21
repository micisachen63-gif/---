@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title SDX Winmalo B2B Sync
echo.
echo ====================================================
echo   SDX Winmalo - B2B and Google Sheets Sync
echo ====================================================
echo Starting local sync. Target: 90 seconds per cycle.
echo Password entry is hidden. Press Enter to submit.
echo To stop syncing: Ctrl+C
echo.
where python >nul 2>nul
if errorlevel 1 goto NO_PYTHON
python -u "%~dp0sync_b2b.py" --loop --interval 90
set "SYNC_EXIT_CODE=%ERRORLEVEL%"
echo.
echo ====================================================
echo Sync process exited. Exit code: %SYNC_EXIT_CODE%
echo Check the messages above and sync-status.json.
echo ====================================================
pause
exit /b %SYNC_EXIT_CODE%
:NO_PYTHON
echo ERROR: Python command was not found on this PC.
echo Please install Python or fix the PATH setting.
pause
exit /b 9009
