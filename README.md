# 營運數據中心：GROK 接手入口

這是 2026-10-21 已部署的 Sites 第 15 版程式交接，來源提交為 `ecc0955de29c048e07605379573fab1d1c008d48`。本庫只放程式、必要視覺素材、合成測試與交接文件，不包含真實會員資料或登入資訊。

**先讀 [交接狀態](docs/grok-handoff-20261021.json) 與 [接手步驟](docs/GROK_START_HERE.md)。目前資料尚未補齊，不能將介面完成視為全年資料完成。**

2026-10-21 追加：[最新幣商篩選規則](docs/MERCHANT_SCREENING_RULES.md) 與純函式 `scripts/merchant-screening.mjs`，依累計官儲、每月20個不同交易對象及歷史證據篩選。真實名單與會員頁核對只留原機器的 `private/`。

## 工作目標

先補六自有站今年 1–7 月收贈禮／買賣幣，產出可核對營收，再補會員、機台、活動、儲值包與新舊活躍交集。所有數字只來自後台；雲端表僅參考分析架構。缺值保留未知與實際截止日。

營收＝官儲＋買幣金幣／買幣除數－賣幣金幣／賣幣除數。設定見 `config/merchant-rates.json`。競品候選名單只能產生情境營收，不能冒稱正式營收。只買幣、沒有官儲的會員不能誤列流失。

## 原機器繼續工作

原始 Windows 工作目錄：

```text
C:/Users/User/Documents/ChatGPT/sites/operations-observatory
```

完整後台原始資料、最新儀表盤、原有 Chrome profile、DPAPI 憑證、來源驗證與執行狀態仍在原機器，**沒有上傳 GitHub**。能操作原機器的代理可直接在原目錄繼續工作；不要用空白 clone 覆寫原目錄，也不要把現存私人資料推送回本庫。

現有採集依賴 `runtime.mjs`、`login.mjs` 等本機執行環境。其不帶設定與憑證的副本位於 `runtime/operations-program/`，用於查閱與除錯；原機器仍應沿用交接檔列出的正式 runtime，避免建立另一套登入／排程。

## 乾淨 clone 的隱私邊界

公開版本將真實幣商 AID 名冊與角色清單移到本機私有設定。三個相關模組保留最新計算邏輯，改由 `scripts/private-rosters.mjs` 載入名冊。其他真實 AID／暱稱測試常數也已替換為一致的合成值。

- 正式工作需 `OPERATIONS_PRIVATE_ROSTERS` 指向本機私有名冊，或準備本庫 `private/rosters.json`。
- 原機器可使用交接檔 `export.privateRostersOnOriginalMachine` 指定的本地檔；檔案不得上傳。
- 沒有私有名冊時會明確失敗，不能以空名冊產出假的零買賣幣。
- `config/rosters.synthetic.json` 只供合成測試；不可用於正式採集、計算或發布。
- `data/`、`worker/`、`dist/` 都是本地資料或產物，未納入 Git。

原始碼與本庫的刻意差異：隱私名冊抽離、合成測試常數、擴充忽略規則，以及本交接文件；沒有改動正式站台或其資料。

## 不操作後台的測試

Node.js 22 以上，PowerShell 範例：

```powershell
$env:OPERATIONS_SYNTHETIC_FIXTURES='1'
node --test scripts/history-session.test.mjs scripts/history-backfill.test.mjs scripts/current-channel-data.test.mjs scripts/cohort-merchant-flows.test.mjs scripts/platform-details.test.mjs
Remove-Item Env:OPERATIONS_SYNTHETIC_FIXTURES
```

上述測試使用注入式 fixture，不採集後台或發布資料。完整畫面與資料整合測試另需原機器的私有快照，不能宣稱乾淨 clone 已跑過完整資料測試。

## 發布與排程

目前資料更新可由既有 `publishData` + 原 Windows 帳戶 DPAPI 解密在本機執行，不需要修改前端或重建網站。必須 PUT 成功並 GET 讀回 SHA-256 相符後才保存本機已驗資料。服務憑證不在本庫，無法由公開網址推導。

既有每日 08:00（Asia/Taipei）工作與手動 listener 都保留。不要重複安裝排程、不要同時啟動兩個採集、不要刪除別人持有的鎖。詳細流程見 [UPDATE_WORKFLOW.md](UPDATE_WORKFLOW.md)，其中較早段落是歷史階段，**最新狀態以交接檔及實際程式為準**。

## 資料與憑證禁止入庫

禁止提交任何帳號密碼、Token、Cookie、DPAPI 檔、瀏覽器 profile、原始會員名單、真實 AID 名冊、後台快照、渲染後嵌入資料的 Worker、日誌、封存與本機配置。更新前必須檢查 staged 檔案；`.gitignore` 不會自動保護曾經追蹤的檔案。
