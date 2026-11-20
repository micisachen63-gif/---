@echo off
chcp 65001 >nul
cd /d "%~dp0"
python sync_b2b.py --setup
pause
