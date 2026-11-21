@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo 正在檢查 Winmalo B2B 玩家管理的金幣欄位名稱...
echo 僅列出欄位名稱，不會列出玩家 AID、姓名或餘額。
echo.
python "%~dp0sync_b2b.py" --inspect-balance
echo.
echo 如看到候選金幣欄位，可以啟動新版同步程式。
echo 若查詢結果只有其他欄位，請提供欄位名稱以確認對應，不要提供帳密或 AID。
pause
