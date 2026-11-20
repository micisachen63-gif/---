@echo off
chcp 65001 >nul
cd /d "%~dp0"
python sync_b2b.py --inspect
if not errorlevel 1 python sync_b2b.py --dry-run
pause
