# 交接版本驗證

驗證日期：2026-10-21。這是公開程式交接的檢查結果，不代表後台資料已補齊。

- 回補工作階段、歷史佇列、渠道、官儲與幣商合併追蹤、分頁及來源驗證：76 項通過。
- 競品買賣幣、每日歷史封存、借用瀏覽器生命週期、登入及 DPAPI：59 項通過。
- DPAPI 測試只使用臨時假帳密，未讀取或修改正式帳密。
- 公開名冊及測試 AID 都是合成資料；正式名冊需由本機私有設定載入。遞迴凍結保留原有名冊的唯讀行為。
- 本次未執行需要完整真實快照的全站整合測試，也未重新採集後台或部署網站。

重現第一組測試見 README。第二組測試先在乾淨副本準備非正式的本機配置：

```powershell
Copy-Item runtime/operations-program/config.example.json runtime/operations-program/config.json
$env:OPERATIONS_SYNTHETIC_FIXTURES='1'
node --test scripts/competitor-funding.test.mjs scripts/competitor-archive.test.mjs runtime/operations-program/credentials.test.mjs runtime/operations-program/login.test.mjs runtime/operations-program/attached-browser.test.mjs
Remove-Item Env:OPERATIONS_SYNTHETIC_FIXTURES
```

`config.json` 被 Git 忽略。不要用範例覆寫已存在的正式配置。Windows DPAPI 測試在其他作業系統會略過。

公開資料邊界：不沿用原專案 Git 歷史，不提交 `private/`、`data/`、`worker/`、`dist/`、真實名冊、瀏覽器 profile、DPAPI 檔或登入配置；推送前檢查實際提交內容及已知帳密與 Token 格式。
