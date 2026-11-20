# SD × 贏麻了｜將 B2B AID 驗證接上 Google Sheets

現有 Render 服務已加入「驗證成功才寫入」的程式流程，但 Google Sheets 授權必須由試算表擁有者親自完成一次。

## 需要做一次的 Google 授權（約數個操作步驟，不必寫程式）

1. 用對這份試算表有**編輯**權限的 Google 帳號開啟：
   https://docs.google.com/spreadsheets/d/1xsil-htvQ0TF6V9QB2FuGnHkhDLYR-NTFVyd8JPMLbQ/edit#gid=626779962
2. 點選 **擴充功能 → Apps Script**。第一次進入會開一個程式碼編輯器。
3. 將本資料夾的 `Code.gs` **全部**貼到 Apps Script 編輯器取代原本空白程式碼，存檔。
4. 到 Apps Script 左側 **專案設定（齒輪）→ 指令碼屬性 → 新增指令碼屬性**：
   - 名稱：`SDX_REGISTRATION_SECRET`
   - 值：打開本機檔案 `D:\\StarJournal\\sdx-local-b2b-sync\\google-script-secret.txt`，複製其中整行私密密鑰貼入；請勿把密鑰貼到群組或聊天室。
5. 點選右上角 **部署 → 新增部署 → 類型選「網頁應用程式」**：
   - 執行身分：**我（擁有試算表寫入權限的帳號）**
   - 存取權：**所有人（Anyone）**，服務只接受含有 64 字元私密密鑰的 POST 指令，沒有密鑰無法存取名單。
   - 授權 Google 試算表讀寫權限，完成部署。
6. 複製產生的 `https://script.google.com/macros/s/.../exec` **網址**。這個網址可以貼回 ChatGPT 讓我替你寫入 Render 的 **`GOOGLE_SCRIPT_WEBAPP_URL`** 環境變數；或者自行在 Render 後端設定該變數。
7. 關閉原本黑色的舊版「啟動同步」視窗，**重新**執行 `啟動同步.cmd` 輸入 B2B 密碼。程式會開第二個登入 session 專門檢查會員管理中的 AID；只要視窗開著，平均每 5 秒接收新的核對要求。
8. 在網頁「玩家登記」先輸入自己的真實已存在的 AID 及真實姓名（本系統不驗證姓名是否屬於該 AID；姓名由使用者自填）。若查無此 AID 不會寫入；查得到才會在「玩家登記與派獎」（gid=626779962）新增一行，同一行包括 AID 與姓名，以及「已登記／AID已驗證」。派獎資格仍待核對。
9. 新登記的 AID 將由下一輪本機同步自動從受密鑰保護的 Google Sheets 讀回，不需再手工編輯 `registered_aids.csv`。未登記玩家不能進入正式排行榜。

## 測試介面

- Render 後端登記可用性：`https://sdx-winmalo-b2b-ranking-api-2026.onrender.com/api/registration/status`。需同時顯示 `sheetReady: true` 與 `verifierOnline: true`、`enabled: true`，前端才允許送出。
- 玩家送出後：先收到「驗證中」，由本機連 B2B `/player/list` 以 `searchBy=0` 核對確實有該 AID。**只有確實存在，且 Google Sheets 寫入與回讀一致時，前台才顯示成功。**
- 失敗情境：「查無 AID」、「B2B 無法連線」、「Google Sheets 未授權」、「Google Sheets 寫入未確認」、「AID 已登記」都不會謊稱登記成功。
- Google Apps Script 預設沒有公開的 GET 查詢介面。Render 的 `GOOGLE_SCRIPT_SECRET` 已與上面本機文字檔一致，只須設定 `GOOGLE_SCRIPT_WEBAPP_URL`。

## 身分安全提醒

**確認 AID 在 B2B 存在，不代表填寫姓名的人確實持有該 AID。** 若活動要求「驗證 AID 所有權」，還需要登入後的遊戲帳號簽章、綁定驗證或後台人工核身。現階段程序符合「後台查得到 AID 才能登記」，姓名為前端本人輸入，一起寫入僅管理員可見的工作表。

## 機台設定

已固定為廠商 `2`、`slot1804`（戰神賽特 II）與 `slot1805`（雷神之錘）。使用你原先設定的本次活動起點，沒有匯入舊活動資料。Google 表的 `gid=626779955` 是「機台清單」，**實際玩家登記表是 `gid=626779962`「玩家登記與派獎」**。
