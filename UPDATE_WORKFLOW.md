# 六站營運儀表盤：每日獨立更新

Site ID：appgprj_6ad726b0c850819187260b5a83eaeb54

唯一資料寫入目標：https://royal-operations-observatory.smartangel12.chatgpt.site/api/data 。

使用者要求每天 08:00（Asia/Taipei）更新，採 Windows 工作排程執行獨立程式，不需每日透過 Codex。本文件不代表排程已安裝；須以工作排程實際狀態及成功寫入回條核對。

## 原後台來源

既有 ThreePlatformOperations0800 每天 08:00 讀取贏麻了、茄子、爽爆後台。本更新器不重跑它的 run.mjs、不改原工作排程、不發 Telegram。只讀原程式產生的後台快照：
C:/Users/User/Documents/Codex/2026-09-18/new-chat/outputs/operations-program 。

原 logs/latest.json 必須符合：台灣今日 date、昨日 through、mode=apply、completed=true、有 finished，且三站各 state=verified、沒有 warnings。同批次 private/runs/<runId>/<key>-source.json 必須有昨日 daily row。

網站數值從後台快照產生；原月報及週報只提供分析架構參考。各站、會員逐月排行、渠道、幣商、活動與洗碼紀錄各有自己的資料覆蓋及截止日。每日首頁刷新不表示固定快照明細也已更新。欠缺來源維持缺值，不能當成 0、推估歷史或宣稱已驗證。

## 一次性服務存取設定

首次設定由原生 Sites get_site 確認本 Site 為使用者擁有、已部署的 owner-private，使用支援的 siwc_bypass_bearer_token。這是 Site 服務存取，不能使用 source repository credential 代替，也不能傳給遊戲後台。

以原 Windows 使用者 DPAPI ProtectedData.Protect(UTF8(token), entropy=null, CurrentUser) 加密，將 ciphertext 的 Base64 純文字存為 private/site-service-token.dpapi。不包 JSON。

private/ 已由 .gitignore 排除，不得加入原始碼或部署封存。明文不得出現在命令列參數、環境變數、排程描述或日誌。重新開機後由同一 Windows 使用者 DPAPI 解密到記憶體即可，不需每日呼叫 Codex。

憑證是不透明權杖；沒有 exp 不代表永久有效。撤銷、存取政策改變或 HTTP 401/403 時，更新器記錄失敗並保留網站最後成功資料。須重新確認 Site 擁有權與 audience，透過支援方式取得有效權杖，再更新 DPAPI 加密檔；不得自行製造或把網站改公開繞過驗證。

## 執行鏈

1. scripts/standalone-refresh.mjs 以目前 Windows 帳戶解密 DPAPI 檔，權杖僅保留記憶體。
2. 以 piped stdin 啟動 scripts/refresh.mjs，傳入 token JSON。權杖不放 argv、shell 字串或檔案。
3. refresh.mjs 最多等待原 08:00 收集 20 分鐘，每隔 60 秒檢查。未完成或有警告不推送，不重跑原收集。
4. collect-data.mjs 產生資料，再確認原批次未變，PUT 本 Site /api/data，GET 並精確比對全文 SHA-256。成功才有完整驗證回條；不必重部署。
5. 最後狀態寫 private/refresh-last.json，明細寫 private/refresh-logs/<UTC timestamp>.log。成功含來源批次/截止日、讀回 SHA-256、驗證時間；失敗 ok=false,status=failed，均不含權杖。

## 安裝與操作

第一次真實更新與 GET 讀回成功後，以相同 Windows 帳戶執行：
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-refresh-task.ps1

預設建立 RoyalOperationsDashboard0800，需電腦開機且使用者登入。每日 08:00、目前使用者 Interactive、隱藏 PowerShell/Node、StartWhenAvailable、MultipleInstances=IgnoreNew、最長 30 分鐘。失敗至多重試一次，間隔 10 分鐘；不重新啟動原後台收集。安裝器核對 Windows 時區為 Taipei Standard Time。

安裝器不自動執行工作。先完成實測，再安裝並核對工作。不要另建每日 Codex heartbeat。再次執行安裝器會更新同名同使用者工作。

手動測試：node scripts/standalone-refresh.mjs，不需 token 參數。
只檢查來源：node scripts/refresh.mjs --check-source 。
只產檔不連站：node scripts/refresh.mjs --prepare-only --no-wait 。

## 失敗處理

未完成來源、缺昨日或站點警告：不推送，沿用網站前版。電腦關機或未登入：下次可執行時補跑並核對日期，不推估缺日。DPAPI 錯誤：核對原 Windows 帳戶與加密檔。

HTTP 401/403：標記存取失效，不清空遠端。409：遠端較新，不倒退覆寫。網路或 5xx：至多一次排程重試，仍需讀回。GET 不符：列為失敗，不因 PUT 200 就宣稱成功。若 PUT 已成功而 GET 網路錯誤，可能已寫入但尚未證實；下一次重新驗證。

## 驗證狀態

網站已部署。腳本與安裝器完成不等於已啟用排程。首次真實 DPAPI 解密、PUT/GET、已保存工作名稱及下次執行時間，以 private/refresh-last.json 與 Windows 工作排程為準。未實測或尚未安裝時明確標示。

## 網頁「刷新數據」手動重新查詢

獨立 listener：node scripts/manual-refresh-listener.mjs。它每 15 秒輪詢同一私人 Site 的 /api/refresh，不依賴每日 Codex 對話。尚須父流程完成 worker 佇列 route、按鈕與端到端驗證；本文件不代表手動按鈕已可用，也未安裝 listener 的登入背景工作。

佇列契約：POST /api/refresh 建立 {id: UUID, state: queued, createdAt}；GET 回傳最新 job（可直接 job 或 {job}）；PATCH 接受 {id, state: running|succeeded|partial|failed, summary, finishedAt, platforms}。開始執行可附 startedAt；讀回成功可附 sha256/verifiedAt。所有 route 仍依 Sites 私人存取邊界，不建立公開 endpoint 或前端服務權杖。

listener 先檢查並取得原營運程式 private/run.lock，忙碌時保留 queued，不與每日收集併行。只在取得鎖後 claim running。鎖有 PID 與 nonce，只刪除自己取得的鎖。重啟後以 private/manual-refresh-state.json 的 lastCompletedId 去重；遠端不是 queued 的工作不會重新執行。

scripts/collect-dashboard-readonly.mjs 只使用原有已授權 runtime.browser()/login.openRoute()，新開報表頁，讀取 /statements/player-summary：本月1日至昨日的玩家消費日報，以及當年1月至當月的玩家消費(月)、玩家活躍(月)。日/月日期遮罩先清空、填入再 Tab，驗證欄位值，等待所選起迄真正回傳並核對可見加總。日報不含今日未結日；月快照可能含今日當下，兩種截止日分開顯示。

更新快照時保留歷史年月，逐站逐表保留成功時間；失敗表沿用前版，不補0、不假稱全部刷新。此流程不執行原營運 run.mjs，不使用 --apply，不更新 Sheets、週報、活動設定、會員資源或金流。

目前原獨立登入只接入 win/song/qz。rd/lucky/bo 在 IAB 登入不等於原19385專用Chrome有登入及DPAPI帳密，故各列 partial 與保留舊資料。至少一站有成功表才 collect 並 publishData；依各表捕捉時間顯示 freshness。全部失敗不推送。上傳後仍須 GET SHA-256 比對；完成結果 PATCH partial 或 succeeded，不能只用網頁 reload 冒充重新抓取。

data.update 包含 manualStatus、manualJobId、manualCapturedAt、platforms[]。各站列 key/name/state/capturedAt/dailyThrough/monthlyThrough/updatedViews/errors，供 UI 顯示成功、部分或失敗及實際截止。其他固定模組（玩家名單、幣商、渠道、活動等）此次不自動重抓，仍須顯示各自原本來源時間。

本階段只跑純函式與 Site endpoint mock tests；未以 exec 啟動真實 browser 控制。父流程應以受支援 CUA 完成實際按鈕端到端查證後，再決定安裝 listener 登入背景排程。

## 發又發每日逐日歸檔（2026/10/21 新增）

沿用現有 `RoyalOperationsDashboard0800`，沒有另外建立或修改 Windows 工作。每日 08:00，`refresh.mjs` 同時開始等待原三站批次及呼叫 `run-o8-archive.mjs`；後者以共用鎖等待目前採集結束，不與原程式控制瀏覽器的作業重疊。這是獨立 Node 程式，不需要每天開啟 Codex。發又發歸檔的成功與否獨立列示；失敗不清空成功來源，也不阻斷原三站可驗證的更新。原三站失敗也不會阻止發又發的每日保存。

後台現場確認「起訖時間要限制今天以前7天內」，且七個日曆日包括今日。因此每天重新擷取 `台灣今日−6日` 至 `昨日` 六個已結日；今日未結不放入已結金流。10/21 的可查已結日期為 10/15–20；10/14 使用先前已保存的有效版本，不能因今天查不到就改為 0 或刪除。長期按逐日檔累積，不能把每天重疊的週範圍直接相加。

程式只接原先已核可的 `127.0.0.1:19385` 專用 Chrome 持久 context，不抽取 IAB cookie、不新建瀏覽器 profile、不匯出 cookie、不保存新後台帳密。原 runtime 的配置仍只有 win/song/qz，並不表示 o8 已登入。沒有有效工作階段時記錄 `login_required`；必須人工／一次性正常登入後再核對。

正式登入檢查（只開自建報表頁並關閉，不採集、不建 job）：

```sh
node scripts/run-o8-archive.mjs --check-login
```

獲使用者授權的一次性正常登入：`node scripts/run-o8-archive.mjs --login-once`，只由呼叫程式透過 stdin 傳入 JSON `{username,password}`，值僅在記憶體中使用，不接受密碼 argv／環境變數，不寫 config、日誌或密碼檔。最多按一次「登入」；驗證「贈禮排行」可見後關閉自建頁，登入 session 由既有 Chrome 一般方式維持。發現 CAPTCHA 或憑證／隱私權 interstitial 即停止，不繞過、不重設密碼。不得將真實帳密貼入 shell 命令或排程設定。

先完成登入及正式逐日採集驗證，才由維護者建立不含密碼的 `private/o8-archive-config.json`：

```json
{"enabled":true,"browserMode":"existing_authorized_context","runtimeValidated":true}
```

未建立此檔或未啟用，hook 僅記錄 `not_configured`；`runtimeValidated` 不為 true 時記錄 `configured_unverified`。這兩種狀態都不代表每日實抓已生效。啟用後手動執行正式 runner 為 `node scripts/run-o8-archive.mjs`；維護者須先確認無其他採集作業，不要重複觸發。`--prepare-only` 及 `--check-source` 不會操作發又發後台。

來源驗證包含可見日期欄清空、填值、Tab 後回讀，AID 篩選為空，報表 tab，`Total Rows`、完整分頁、全域名次連續及逐頁 hash、單向交易淨額一致。每頁最多 1000 列；多頁使用已觀察的 next 按鈕，若頁碼名次只在頁內重置而無獨立選頁證據則停止，不冒稱完整。正式 adapter 已識別初始「沒有符合的結果」，但尚無獨立 UI 查詢完成標誌可證實最後空結果，因此最後查詢為 0 時保守等待／回報 empty_result_unverified，不寫成完整零日。只有另行完整核驗的來源才可有已證實零值。超期警告、未改變來源、逾時或缺頁均為失敗。舊成功版本保留。

資料只寫入私人來源目錄：

- `live-data/competitor-archive/o8/daily/YYYY-MM-DD/<capture-UTC>-<SHA16>.json`：不可變原始快照，保留實際 `capturedAt` 與查詢／分頁證據。相同 capture 重試以 hash 去重，新捕捉版本另存。
- `index.json`：每日期最新成功版本指標；不是金額來源。讀取器依日選最新有效版本，禁止把同日多版本相加。
- `status.json`：`configured/status/lastAttemptAt/lastSuccessfulCaptureAt/failureAt/loginExpired` 與日期窗、此次成功／失敗日期及仍缺日期。`status=success` 只表示本次六個日期都核對成功；舊來源可用與本次重抓失敗分開列示。

runner 與原日更及手動刷新共用 `operations-program/private/run.lock`，只刪除自己的 nonce，不搶鎖、不刪除其他作業的鎖。日更 hook 最多等待共享鎖 20 分鐘，實際採集最多八分鐘，兩者合計受本次刷新 23 分鐘總預算約束；逾時及清理失敗仍寫入失敗狀態，釋放自己的鎖，不無限重試。沒有重新執行原 `run.mjs --apply`、修改 Sheets 或發送外部訊息。

腳本與純資料／mock 測試完成不等於已取得持久登入、已啟用或已通過 08:00 真實執行；以正式 `--check-login`、首次六日來源、status 回條及 Windows 任務實際結果為準。原排程定義本次未變更。


### 原三站不通過時：只更新發又發歸檔

`o8-archive-only.mjs` 只接受本次開始後的真實 status.lastAttemptAt，且 configured=true、狀態為 success／failed／login_required／configured_unverified。未啟用、舊回條或未來時間不能觸發部分發布。

若原三站資料 gate 未過，但本次發又發已嘗試，讀取既有完整 data/dashboard.json；不存在時只由 dashboard-snapshot.json.gz 合法物化，兩者都無有效完整內容就失敗。絕不呼叫 collect() 合併未核對的三站批次。

保留完整快照的其他欄位及各來源 capturedAt／through／verifiedAt，只重新計算 competitorArchive、更新 generatedAt 編整時間並明示 update.archiveOnly=true、partial=true、原三站保留舊資料及失敗原因。即使本次發又發是登入失效，也可讓儀表盤揭露該失敗狀態。

部分發布仍使用同一私人 Site PUT／GET 精確 hash 驗證。回條 archiveOnly 與 archiveThrough 另列；sourceThrough 繼續代表保留的三站截止，不把新編整時間冒充其來源已更新。尚未啟用發又發時，原三站失敗仍維持舊的拒絕發布行為。


### 2026/10/21 正式執行驗證

已在原19385專用持久context透過一次性stdin正常登入，結果 existing_session_authenticated、credentialsStored=false；沒有新保存後台密碼。非密碼 private/o8-archive-config.json 已啟用 enabled=true、runtimeValidated=true。

正式 runner 於台灣07:28:22–07:28:37執行完成（UTC2026-10-20T23:28:22Z–23:28:37Z），exit0、configured=true、status=success。10/15–20六日分別完整保存168、163、179、136、128、171列；missingDates=[]、cleanupErrors=[]。這是正式程式的新捕捉來源，不是舊快照重標日期；共享鎖已釋放。

沿用既有 RoyalOperationsDashboard0800，下一次為今天2026/10/21 08:00（台灣）；本次沒有修改其XML或另建工作。尚未把「手動正式成功」宣稱為「08:00排程已成功跑過」，08:00後仍須看當次回條。

台灣07:38:23–07:38:41再次執行完整runner：六日排行再次保存成功，另取得10/15–20同期官儲日報與全站新贈禮日報。兩份附加來源均ok=true，官儲可見加總及平均已核對，status=success、partial=false、missingDates=[]、cleanupErrors=[]；新舊快照均保留。這次才是包含兩項附加日報的正式端到端驗證。


### 每日附加官儲與全站收贈禮日報

在逐日贈禮排行保存後，同一正式 runner 續查相同六個已結日：玩家消費日報（官儲、DAU、DPU等）以及收贈禮統計的「新日報表」（全站贈禮、手續費、人數與筆數）。不新增遊戲、註冊、活動、其他平台或密碼自動化。

來源為 private live-data/competitor-cash-range-o8-<from>_<through>.json 與 competitor-gift-summary-o8-<from>_<through>.json。更新前驗日期清空／填入／Tab回讀、每個已結日皆有一列、欄位與數值；玩家消費另核對可見加總及平均的官儲。前後可見資料簽章須改變，不能把尚未回傳當成新來源。

每次有效新來源先保存於 competitor-archive/o8/enrichment/cash 或 globalGift 的不可變版本，既有同名 flat 成功檔也先保留不可變備份，才原子替換 flat。失敗不覆寫舊 flat、不刪除已保存排行、不更改舊 capturedAt。讀取器按日期選最新可驗來源，重疊窗口不直接相加。

status.enrichment.cash/globalGift 各有 ok（true／false／尚未實測null）、from、through、capturedAt、固定error code。六日排行全成功而附加日報未齊時，status 可保持 success，但 partial=true，lastSuccessfulRunAt 不前進；只有六日排行及兩項附加來源全成功才更新完整執行成功時間。lastSuccessfulCaptureAt 仍可反映已保存排行的最新時間。網站須分別顯示兩表狀態與擷取時間，不能把初次07:28六日排行成功當作本次新增兩表也已實測。

### 四站競品共用日更與歷史補抓（2026/10/21 擴充）

`refresh.mjs` 現在以 `runCompetitorArchiveBatch` 依序處理 o8（發又發）、aos（黑桃A）、fcc（財哥）、cgb（超吉爆）。沿用同一個 RoyalOperationsDashboard0800、同一個 19385 持久 context 及共用 nonce 鎖；本次程式變更沒有另建或修改 Windows 工作。四站不平行操作瀏覽器。整批仍受原23分鐘預算約束，原三站來源等待獨立進行；任一競品失敗不清空已成功來源，也不阻止其他站在剩餘預算內嘗試。

公開 registry `config/competitor-archive-sites.json` 只有 key、host 和時間窗；名稱及換算率讀既有 merchant-rates.json，不包含登入資料。發又發仍讀原 private/o8-archive-config.json。其他三站的非密碼啟用設定為：

```json
{"platforms":{"aos":{"enabled":true,"browserMode":"existing_authorized_context","runtimeValidated":true},"fcc":{"enabled":true,"browserMode":"existing_authorized_context","runtimeValidated":true},"cgb":{"enabled":true,"browserMode":"existing_authorized_context","runtimeValidated":true}}}
```

此檔位於 private/competitor-archive-config.json。維護者只能在各站正式登入檢查及實際唯讀採集驗證後啟用；程式存在或純測試通過不代表三站已啟用。沒有設定則不開啟該站採集。不得在此檔加入帳密或 cookie。

共用正式 CLI：

```sh
node scripts/run-competitor-archive.mjs --platform aos --check-login
node scripts/run-competitor-archive.mjs --platform aos --login-once
node scripts/run-competitor-archive.mjs --platform aos
node scripts/run-competitor-archive.mjs --platform fcc --backfill --year 2026 --through 2026-10-20
node scripts/run-competitor-archive.mjs --platform cgb --daily-from 2026-09-01 --daily-through 2026-09-30
```

`--login-once` 的兩個值僅透過 stdin JSON 輸入，沿用已驗證的 click→clear→keyboard.type 正常登入語義。CLI 不接受密碼 argv。每次只執行一個 runner；未解鎖前不要另開另一站。遇 CAPTCHA、憑證警告或其他登入阻礙即停止，安全回條不含頁面正文或輸入值。原 run-o8-archive.mjs CLI 保留相容。

新三站每日取得今日−7日至昨日七個已結日的獨立贈禮排行，接著取得同七日官儲日報與全站新贈禮日報。發又發因已實測的七日含今日限制，維持今日−6日至昨日六個已結日；先前保存的第七日仍保留。收集失敗或無法獨立驗證的空結果不當作0。

現場已核對 AOS/FCC 分頁：選中頁按鈕為 `page 2`、aria-current=true；未選中為 `Go to page 2`。FCC每頁名次會重從1。共用 adapter 接受全域名次，或附獨立選中頁 DOM 證據的頁內名次；每頁筆數、順序、hash、整體總列數及交易淨額必須吻合。重複頁、缺頁或僅點擊而未實際換頁均不能通過。

`--backfill` 對該年度1月至指定已結截止日逐月取得完整贈禮排行，當月可為已結MTD。另查1/1至截止日官儲日報、全站贈禮日報，以及1月至截止月的全站贈禮月報。月報選擇 yyyy-MM，當前月包含擷取當日，明確標 currentMonthPartial=true，不能與只到昨日的排行／日報冒充完全同期。排行9月全月與10月1–20均是已結資料，currentDayPartial=false；MTD不使用 partial=true 冒充今日未結。發又發已證實拒絕歷史範圍，CLI不嘗試突破其限制。

若全年報表省略早期日期／月份，程式不推定開站日、不補0、不保存為完整全年；該附加表標失敗，已驗各月排行和舊來源保留。可在確認實際可查日期後另用歷史逐日模式補抓。歷史模式回條寫 backfill-status.json，不冒充每日08:00已成功。

四站共同私人來源契約：

- `competitor-archive/{key}/daily/YYYY-MM-DD/<captureUTC>-<hash>.json` 與 index.json：各日多版本不可變保存，每日只取最新有效版本。
- `competitor-period-rank-{key}-YYYY-MM-DD_YYYY-MM-DD.json`：整月或MTD完整排行，與逐日結果分別使用，禁止相加。
- `competitor-cash-range-{key}-from_through.json`、`competitor-gift-summary-{key}-from_through.json`：同期／全年已結日來源。月報另以 yyyy-MM 範圍保存，保留原UI欄位及日期證據。
- 所有 flat 更新先保存新原始不可變版本及舊 flat 備份，再原子替換；失敗不覆寫成功來源或重標 capturedAt。
- `competitor-archive/{key}/status.json`：本次 daily 設定、逐日結果、獨立 enrichment 狀態及實際成功時間；新三站與發又發各自列示。

原三站 gate 未通過時，`competitor-archive-only.mjs` 只接受本次真實已啟用競品嘗試，讀取既有完整儀表盤，重新建 competitorArchives 及舊版 competitorArchive（o8 alias），其餘資料與來源時間不變。部分發布仍做同一私人 Site PUT／GET SHA 驗證，不把編整時間當成三站資料更新時間。

### 詳細資料共用更新模組（2026-10-21）

`scripts/detail-refresh.mjs` 提供 `runDetailRefresh({startedAt,maxTotalMs,lockHeld,platforms?})`，供每日及手動刷新入口共用。此模組本身不安裝工作、不建立刷新請求。呼叫端已持有共用鎖時必須傳 `lockHeld:true`；否則模組只取得一次 nonce 鎖，依序執行，不平行開多個 runner。

預設清單為六個自有站及 registry 六個競品，僅排除 `config/platform-availability.json` 中 state 為 `temporarily_unavailable` 的站點。使用者2026-10-21通知來博恢復可登入，狀態為 `recovery_reported`，允許既有 session 驗證，尚不等於已擷取成功。金來快 `goldfun` 與黑狗兄 `o9` 的來源限各自指定 host，買幣除130、賣幣除135。設定來源及匯率不代表已登入或已有可靠幣商名單；沒有候選身分依據時，買賣及情境營收仍須保留未知。

更新順序為可用自有平台的真新註冊總數、各站本月截至昨日的儲值排行／創辦會員／機台、前月相同完整日數的儲值排行與機台，最後只補缺少有效完整來源的前月全月儲值排行。跨月時完整月按兩個曆月比較；前月不存在相同日數時標不同比，不創造日期。會員最後登入只是擷取當時快照，不能當歷史 MAU。

總預算上限23分鐘，扣除呼叫前已耗時間並保留30秒收尾；每個實際 query 仍受 collector 原有硬上限限制。超出預算的站點／種類／期間寫入明確缺口，成功來源和原擷取時間保留。全域回條為 `live-data/detail-refresh-status.json`；各站逐種類回條為 `platform-details-archive/{key}/status.json`。真註冊回條保留 `sources`、最近成功來源時間及最近全成功時間，失敗重試不抹掉舊成功來源。純 fixture 驗證不代表所有站點實際登入及採集成功，正式執行結果須另核對。

### 活動金流與成功儲值包來源

`scripts/collect-promotion-packages.mjs` 提供 `runPromotionPackages`，也可用 CLI `--platforms win --kinds promotions,packages --from 2026-10-01 --through 2026-10-20` 執行。未指定日期時查本月完整日至昨日及前月相同完整日數。沿用既有登入 context 與共享鎖，支援 `lockHeld:true`，不建立登入或保存密碼。

活動來源為 `/statements/moneyflow` 的「總金流查詢」；初始無日期的「總金流總表」不能當期間數據。收入、機台及存量表保留原分類，但不當活動發放。固定系統、期間活動、儲值活動與公會系統明細各自查詢並保留 tab 來源，主類與子類不能重複加總。每表必須包含完整日期集合、可解析金額及任何可見加總核驗；子 tab 失敗標部分，不把成功主表冒充所有明細齊備。

儲值包來源為 `/statements/deposit-statements`「使用日期查詢」，僅選「一次儲值包」及「成功」。程式驗證全部其他篩選、日期、真實 Total Rows、每頁1000及所有選中頁證據。訂單明文ID、備註、交易操作和聯絡資料不落盤；只保留來源訂單ID的 SHA256、AID字串、包名、成功狀態及價格，並據獨立訂單身分計算成功筆數、付費AID數及現金。無可靠訂單ID或未驗證空結果會標缺，不以發放金幣推算購買包數或ROI。

後台品項會把類型與SKU連接顯示，例如「一次儲值包mycard_9988_pack_id321」。來源另保存 `productType:'一次儲值包'`，`packageName` 保留完整SKU；必須已驗品項篩選並符合已實測的類型前綴，不能用任意 includes 混入其他商品。候選結果每列交易時間也須在所選期間內，才能開始兩次穩定驗證。

活動與訂單正式 adapter 額外驗證頁面自己發起、且在本次送出後完成的已知報表XHR：同一 admin hostname 的 HTTPS 9032，POST `/api/platformSTMT/moneyFlow` 或 `/api/platformSTMT/purchaseSTMTByDate`。只接受 `response.finished()` 成功且HTTP 2xx，搭配DOM日期／完整列數／加總或分頁／兩次穩定結果；不另發HTTP，不讀request或response body、headers、token或cookies。送出前的request、其他host/port/endpoint、未結束或非2xx回應均不能當新鮮來源。`queryProof.reportXHR` 與各表／各頁保留證據。會員、機台與排行既有完整性驗證保持不變，尚未加此同款XHR觀測時不能宣稱它們也有這項新proof。

各來源保存為 `promotion-flow-{key}-{from}_{through}-asof-YYYYMMDD.json`、`package-orders-{key}-{from}_{through}-asof-YYYYMMDD.json`，不可變原始版本及舊檔備份在 `promotion-package-archive/{key}/`。`status.json` 逐種類／日期保留最新嘗試和最後成功來源；失敗不抹掉原有效檔。主活動日期及金額一旦核驗即先保存部分來源，再補可用子表，每個子tab最多30秒；餘額表首日空白「誤差」保存未知，不補0，也不連帶丟棄已驗主活動。

每日入口已接同一個23分鐘起算的序列：競品歸檔（上限12分鐘，保留後續預算）、活動與成功訂單、會員／付費排行／機台明細。活動 hook 最多5分鐘，且最多使用當時剩餘預算扣收尾時間後的三分之一。手動刷新沿已持有的共享鎖依序執行總覽、活動與成功訂單、其餘明細；無一項新來源時保留前版，有部分新來源則仍可發布部分結果。時間不足的種類和期間明確寫入 not_run，保留原成功來源與原擷取時間。接入程式及 fixture 通過仍不表示每站權限、每張子表及每個訂單期間都已實際成功；請讀取各站回條與來源時間。

### 十二站指定期間註冊總數

`collect-registration-period.mjs` 提供 `runRegistrationPeriod({platform,from,through,lockHeld,...})` 及 history handler `runHistoricalRegistrationTask(task,options)`。它重用既有「玩家總覽」唯讀 adapter，逐站實際驗證登入、控制與來源，不以競品身分預設可查或不可查。獨立 CLI 範例為 `node scripts/collect-registration-period.mjs --platform o8 --from 2026-09-01 --through 2026-09-30`；沒有新密碼或登入流程。此指令不會另抓上個月，也不會改設定或會員資料。

新來源 `registration-period-{key}-{from}_{through}.json` 限12個指定 host 的 `/statements/player-view` 與「玩家總覽」。正式保存前須核對創建帳號 All 與 Android／Apple／Web／可選 Unknown 的總數、精確閉合日期、fresh result hash 及本次實際擷取時間。不可變版本和失敗保留回條在 `registration-period-archive/{key}/`；新Registered為0只有來源確實顯示且驗證通過才保留0。儲值、贈禮及登入累計不能替代真註冊數。

歷史 queue 的競品 registration 已接此單scope handler，owned原來源接口保留；舊 registration 缺接口任務可再次嘗試，其他確實缺少的登入交集接口不因此解禁。`buildOwnedRegistrationPeriods` 兼容原owned與新generic來源；member composition及current channels也獨立讀取本機generic raw，只有同站同期間創帳名單與真註冊總數完全對平才分類其餘付費會員為舊客。接入程式不等於已執行或所有站點已登入，真實成功以回條和來源時間為準。
# 12 站自動刷新範圍（2026-10-21 程式修正；本次僅 fixture 驗證）

每日與手動刷新共用 `scripts/refresh-domains.mjs`，同一開始時間最多 23 分鐘，序列執行且共用既有鎖。順序為六自站官儲／收贈禮（最多 4 分鐘，其中每日可等原排程鎖最多 2 分鐘）、六競品既有逐日歸檔（最多 8 分鐘，按剩餘站數公平分配）、手動原三站含今日報表（最多 3 分鐘）、活動／儲值包（最多剩餘額三分之一、上限 5 分鐘），最後會員／機台／排行與獨立註冊。各階段仍受同一 23 分鐘終點限制，不會平行操作後台。

六自站的 current/previous 官儲與幣流改由 `runOwnedFundingRefresh` 重用正式唯讀 adapter 與嚴格 store：官儲逐日完整及頁尾核對，贈禮排行全部頁面、來源日期、AID／雙向淨額核對，來源各自 immutable 保存。`owned-funding-refresh/{platform}/status.json` 保留每個 kind/period 本次結果與上次成功時間；失敗不覆蓋已驗證來源。只有截至昨日的已結資料，今日仍由原三站獨立 partial 路徑顯示。原三站以外的今日／月活躍來源並未因本修正自動補齊。

獨立註冊計數現在覆蓋 12 站：自站沿用已驗雙期流程，競品依 current/previous 精確窗口呼叫 `runRegistrationPeriod`，不讀會員累計儲值推算註冊。手動刷新亦呼叫六競品原歸檔流程，傳入 `lockHeld:true`，不再因持有外層鎖而誤報忙碌。暫停／登入失效／缺權限／預算耗盡均保留明確 gap；成功只代表各自實際來源通過，不能由程式已接入宣稱所有區塊已更新。

本輪未啟動瀏覽器、未修改登入或排程。正式來源採集與來源 gate 失敗時的安全 domain overlay 由主流程另行核驗。

### 有界歷史續跑與每輪同步（2026-10-21）

`scripts/history-session.mjs` 是手動啟動的續跑程式，不新增 Windows 或 Codex 排程。預設 `--plan` 只讀狀態，不採集、不發布。確認既有採集程序已釋放共享鎖、並由維護者明確移除 `private/history-session.stop` 後，可在專案根目錄執行：

```powershell
node scripts/history-session.mjs --run --year 2026 --cycle-ms 600000 --max-cycles 100
```

每輪另開一個隱藏 Node 子程序，保留完整十二站／所有月份 queue；採集最多10分鐘、每個任務最多3分鐘並受剩餘輪次預算限制。每輪結束由原採集程式釋放共享鎖後，使用最新已核驗的本機儀表盤及本輪真來源重建安全 overlay。原來源日期與身份限制保持；只有 PUT 和 GET SHA256 核對成功後，才原子寫回本機 `data/dashboard.json`。若沒有新來源或狀態變動，略過發布。僅狀態變動仍須標 `statusOnly`／`partial`，不將舊數字冒充新擷取。

`private/history-session-2026.json` 保存安全回條與 `unpublishedAttemptStartedAt`。解密、發布或讀回失敗會立即結束整個 session，不循環重試401／403；原 attempt 邊界保留。維護者解決問題後重新啟動時，先以原邊界和最新本機底稿重新建立 overlay，再驗證發布，不能重送過時的已編譯儀表盤。

先遍歷可用站點的 pending，再處理已到 retryAt、且總 attempts 小於2的可重試失敗。登入、驗證碼、憑證、歷史限制及無介面任務不反覆嘗試。`private/history-runtime-blocks-2026.json` 中 active 的 `login_required` 會跳過該站，但保留其 pending／failed 任務；較新的正式 `resolvedAt` 可解除舊登入失敗。若本輪新遇登入失效，同站後續任務也會跳過，不改平台 availability、密碼或 session。完整且日期／來源／分頁都通過的會員 raw 可作採集完成 seed，獨立註冊數尚缺造成的「新舊客待分類」不會觸發重抓數千筆會員。

正常停止請建立 `private/history-session.stop`；程式於下一輪邊界退出，當輪有界採集和已取得來源的驗證同步可先完成。最多100輪後自行退出。若子程序超出採集及收尾硬限，父程序停止該自建子程序並結束，不會自動刪共享鎖；維護者須核對實際 PID／nonce 後才處理殘留鎖。安全摘要不含權杖、密碼或玩家名單。本輪只完成 injected fixtures，正式啟動與實際來源結果另行核驗。

