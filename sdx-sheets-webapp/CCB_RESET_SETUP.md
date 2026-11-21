# SD × 贏麻了｜CCB 清場與正式活動管理

已開發但**沒有執行清場**。此功能只會在完成下列兩個授權步驟後啟用。

## ① 更新既有 Google Apps Script 部署（保留原 /exec 網址）

1. 用有活動試算表編輯權限的 Google 帳號，開啟 [玩家登記與派獎](https://docs.google.com/spreadsheets/d/1xsil-htvQ0TF6V9QB2FuGnHkhDLYR-NTFVyd8JPMLbQ/edit#gid=626779962)。
2. 選「擴充功能 → Apps Script」，**整份**用最新版 `Code.gs` 取代舊內容。相同程式檔也複製到你的 Windows 電腦：`D:\\StarJournal\\sdx-local-b2b-sync\\Code.gs`。
3. 保留原本指令碼屬性 `SDX_REGISTRATION_SECRET`，不要更動它。
4. 儲存後依序按「部署 → 管理部署 → 選既有網頁應用程式旁的編輯 → 版本選新增版本 → 部署」。**不要只按儲存，也不要建立不同網址的新部署**。
5. 既有 Render 後端連接的網址是：
   `https://script.google.com/macros/s/AKfycbyLZApd2FSe7CmnNQLZXeooU0wrZ1LRQ1bJjQYOowsEkjZEev6-Ko75sBpVL_HcKMBi/exec`
   使用同一部署更新版本即可保持連結不變。

## ② 設定獨立的管理員密鑰（不要使用 B2B 密碼）

1. 進入 Windows：`D:\\StarJournal\\sdx-local-b2b-sync\\`。
2. **第一次**執行「設定CCB管理密鑰.cmd」；程式產生 `admin-reset-token.txt`（本機私密檔，不可提交 Git）。
3. 開啟 `admin-reset-token.txt`，複製整行安全密鑰。
4. 到 [Render 後端設定](https://dashboard.render.com/web/srv-dbvvqiuc6qcc73aod690) 的 Environment 新增：
   - **Key**：`ADMIN_RESET_TOKEN`
   - **Value**：剛才從本機檔案複製的密鑰
5. 儲存，等 Render 更新後，不要把此密鑰貼進聊天室、群組或試算表。

## ③ 管理員操作流程

開啟 [CCB 管理頁](https://sdx-winmalo-internal-event-2026.onrender.com/admin.html)，輸入同一份密鑰，按「讀取活動狀態」。

- **CCB 測試中**：可以讓測試參加者登記、讀取雙機台排名、RTP、神運榜與個人成就。正式活動開始日期不用現在設定。
- **CCB 已結束**：建議先在 Google Sheets 匯出備份。管理頁輸入「清空CCB資料」並通過第二次確認後，會刪除「玩家登記與派獎」內活動代碼 `DUAL2026` 的所有登記資料（AID、姓名及該列的派獎欄），**不清除其他活動或其他工作表**；同時網站全部榜單失效，階段轉為「READY 已清場」。這個操作不可復原，且不會清除 B2B 後台原始投注紀錄。
- **設定正式活動起訖**：確認已清場且 AID 為 0，於管理頁填寫台灣時間（UTC+8）的開始與結束日期，最長 45 天，輸入「啟動正式活動」確認。開始時間未到顯示 `SCHEDULED`，到時間自動轉 `OFFICIAL`，結束時間到自動轉 `ENDED`。
- **重新啟動本機同步**：在官方開始前或當下，把仍在執行的舊版 `sync_b2b.py --loop` 以 Ctrl+C 停止，重新啟動「啟動同步.cmd」。新版會讀取 Google Sheets 保存的 `eventEpoch`、`phase`、`startTW`，在正式階段只查從新起點以後的投注及倍率。任何舊世代資料都會被 Render 拒收。
- 正式啟動後，管理頁的 CCB 清除功能會鎖定，**不允許刪除正式參加者**。

## 三層防止 CCB 舊資料混入正式活動

1. **Google ScriptProperties** 永久保存階段、世代與正式起點（Render 重新部署不會重設）。
2. **Render** 在公開資料查詢與 B2B 上傳時，對照 ScriptProperties；若世代或階段不符，拒絕顯示或接收。
3. **本機同步** 只以 Google 已登記 AID 統計，不再使用 CCB 的舊 CSV；正式期間只查官方設定的起訖區間，結束後停止更新。CCB 已清場但尚未啟動正式活動時不會發榜。

## 注意

- 程式版 `Code.gs` 更新在 GitHub 與本機，**不等於 Apps Script 正式部署版本已更新**。請確認使用既有部署新增版本。
- 管理頁需要獨立密鑰；Render 如果尚未設 `ADMIN_RESET_TOKEN`，管理頁會提示未授權，不會清場。
- 不要在 CCB 尚未結束時點清場。這裡只建立功能，沒有執行任何真實資料刪除。

## 最新版功能：時間設定與結束封存

- 管理頁現在有「正式開始時間」「正式結束時間」兩個欄位，均採台灣時間，**不需要現在先決定日期**。
- 日期可預先排程。開始前禁止正式登記與統計；開始後每兩分鐘由本機同步，結束時禁止新登記與任何新的公開榜單寫入。
- 正式活動同步時，Render 會先把經隱私過濾的公開資料存到 Google Sheets 的新分頁「雙神活動公開快照」，結束後不再覆寫，Render 重新部署仍可讀回。
- 活動結束時，網頁顯示「本次活動已結束」，仍可查看最後成功封存的投注額榜、倍率榜、RTP、神運榜與個人成就。若未曾成功封存，不會產生假榜。
- 目前本機每 120 秒同步一次，所以封存的最後資料可能比截止時刻早約兩分鐘或因故障更久；實際最後同步時間會在網頁顯示。
- **重要：** 必須用最新版 Windows Code.gs 的完整內容覆蓋既有 Apps Script 專案，選「部署 → 管理部署 → 編輯現有網頁應用程式 → 新增版本 → 部署」，保留原 /exec 網址與原本指令碼密鑰。舊版未更新前管理頁會鎖住正式排程按鈕。
- 管理員密鑰 ADMIN_RESET_TOKEN 沿用之前成功設定的內容，不需要更改。
- 更新本機 sync_b2b.py 後必須關閉舊的同步視窗並重新執行啟動同步.cmd，才能使用新的活動結束保護。

尚未執行任何真實清場、正式啟動或試算表資料刪除。
