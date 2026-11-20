# SD x 贏麻了 — B2B 即時榜單閘道
此服務只處理公開排行榜，與 Google 試算表「玩家登記與派獎」分離。既有 Render 靜態網站不會保存 B2B 憑證。
## 已確認的 B2B 前端 API
- Base: `https://admin-b2b.winmalo.com:9032/api/`
- `POST /login`，body `{account,password}`，使用 session cookie
- `POST /gameSTMT/vendorGamePlayerSTMT`，body `{vendorId,gameName,advertiserId,start,stop}`
- 尚未確認正式排行榜有效押碼欄位一定存在，故僅接受回應中的 `validBet`、`effective_bet` 或 `effectiveBet`，缺少就顯示「尚未驗證」，絕不以 `bet` 冒充。
- 逐局官方倍率欄位尚未驗證，倍率榜目前不顯示數字。
## Render 環境變數（只可在 Render Dashboard 設定，切勿提交至 GitHub）
必填：`B2B_ACCOUNT`、`B2B_PASSWORD`、`B2B_VENDOR_ID`、`B2B_GAME_SET2`、`B2B_GAME_THOR`、`EVENT_START_TW`。
`B2B_GAME_*` 必須填後台 `vendorGameList` 的 game `name`，不是顯示名稱。
`EVENT_START_TW` 必須是已正式確認的台灣時間 `YYYY/MM/DD HH:mm:ss`。
可選：`PUBLIC_RANK_LIMIT` 預設 10。
本專案不接受在前端、公開試算表或 Git 儲存 B2B 密碼，且不公開 AID、姓名、原始注單和敏感營運資料。
登入後由伺服器呼叫 B2B API，每 60 秒更新白名單公開榜單；資料失敗或未配置時顯示明確狀態，不以舊報表冒充本活動排名。
註：API 讀取未經正式帳號驗證的資料格式，完成環境設定後需實際驗證欄位；同分、活動範圍、黑名單、官方倍率、領獎資格仍以後台與正式規則核對。
