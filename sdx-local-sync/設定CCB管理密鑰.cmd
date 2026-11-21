@echo off
chcp 65001 >nul
cd /d "%~dp0"
python -c "from pathlib import Path; import secrets; p=Path('admin-reset-token.txt'); p.write_text(secrets.token_urlsafe(48),encoding='utf-8') if not p.exists() else None; print('管理員密鑰已建立：'+str(p.resolve()))"
echo.
echo 請開啟 admin-reset-token.txt，複製整行字串。
echo 在 Render 的 sdx-winmalo-b2b-ranking-api-2026 服務的 Environment 設定：
echo Key = ADMIN_RESET_TOKEN
echo Value = 剛才複製的密鑰
echo.
echo 請勿貼到聊天室、GitHub 或公開試算表。
pause
