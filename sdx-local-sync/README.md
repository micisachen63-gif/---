# SD x 贏麻了：本機白名單 B2B 同步

此工具在**獲准存取 B2B 後台的 Windows 電腦**執行，不破解或繞過 IP 白名單。登入只在你的電腦上進行，密碼透過終端機安全提示輸入，程式不會提交密碼、session、玩家 AID 或真實姓名。

## 快速開始（Windows 10 / 11）
1. 確認 Python 3.10+ 已安裝，並可從這台電腦開啟 B2B 後台。
2. 打開命令提示字元，進入此資料夾。
3. `python sync_b2b.py --discover`：輸入 B2B 密碼後列出廠商 ID。
4. `python sync_b2b.py --discover --vendor <數字>`：查出兩款機台對應的 **gameName**。
5. 在 `config.local.json` 填入 `vendorId`、`games.SET2`、`games.THOR`、`startTW`（正式或測試統計起點，台灣時間，例：2026/11/20 16:00:00）。
6. 把本機同步金鑰放在 `.sync-token`（一行文字）；金鑰應由活動管理員設定，不可放到 GitHub 或對外分享。
7. `python sync_b2b.py --inspect`：檢查 B2B 回應的欄位名稱及筆數，不會輸出 AID。
8. `python sync_b2b.py --dry-run`：計算並檢查前 10 名，**不會發佈**。
9. `python sync_b2b.py`：上傳經過濾的測試排行榜。若要每兩分鐘自動同步，`python sync_b2b.py --loop`，保持終端機視窗開啟。

## 資料與限制
- 只接受 B2B 明確的有效押碼欄位：`validBet` / `validBetAmount` / `effectiveBet` / `effective_bet`。**絕不**以總投注 `bet`、中獎額 `pay`、RTP 作為有效押碼。
- 玩家報表若欠缺有效押碼，逐頁讀取 `gameSTMT/vendorGameSTMTLog`，依唯一水單 ID 去重、依本次活動起始時間過濾。超出分頁或欄位未知時立即停止，不產生假榜。
- 「單把最高倍率」只有在確認後台有**官方逐局倍率**欄位，並設定 `officialMultiplierField` 後才啟用；不自己計算虛構倍率。
- 同分判定及派獎規則須另經核定；網站會標示**測試資料**，非已結算名單。
- `config.local.json` 可保存帳號與映射，**請勿放密碼**；`.sync-token` 是敏感金鑰，不可上傳至任何公開儲存庫。
- Render 的無磁碟版本重部署可能失去暫存；Windows 本機每兩分鐘同步可補回，停止同步超過 15 分鐘會標為「資料過期」，不會展示舊榜冒充即時。
- 本機的公網出口 IP 必須是 B2B 允許的 IP；若仍無法登入，請找後台管理員確認白名單，勿改用未授權轉發或代理。
