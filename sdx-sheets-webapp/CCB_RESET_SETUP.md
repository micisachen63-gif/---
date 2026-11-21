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
- **正式活動開始當下**：確認已清場且 AID 為 0，輸入「啟動正式活動」並按啟動，系統會記錄當時的台灣時間，活動階段變 `OFFICIAL`。
- **重新啟動本機同步**：在官方開始前或當下，把仍在執行的舊版 `sync_b2b.py --loop` 以 Ctrl+C 停止，重新啟動「啟動同步.cmd」。新版會讀取 Google Sheets 保存的 `eventEpoch`、`phase`、`startTW`，在正式階段只查從新起點以後的投注及倍率。任何舊世代資料都會被 Render 拒收。
- 正式啟動後，管理頁的 CCB 清除功能會鎖定，**不允許刪除正式參加者**。

## 三層防止 CCB 舊資料混入正式活動

1. **Google ScriptProperties** 永久保存階段、世代與正式起點（Render 重新部署不會重設）。
2. **Render** 在公開資料查詢與 B2B 上傳時，對照 ScriptProperties；若世代或階段不符，拒絕顯示或接收。
3. **本機同步** 只以 Google 已登記 AID 統計，不再使用 CCB 的舊 CSV；正式期間以官方起始時間查資料。CCB 已清場但尚未啟動正式活動時不會發榜。

## 注意

- 程式版 `Code.gs` 更新在 GitHub 與本機，**不等於 Apps Script 正式部署版本已更新**。請確認使用既有部署新增版本。
- 管理頁需要獨立密鑰；Render 如果尚未設 `ADMIN_RESET_TOKEN`，管理頁會提示未授權，不會清場。
- 不要在 CCB 尚未結束時點清場。這裡只建立功能，沒有執行任何真實資料刪除。
