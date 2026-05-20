# 匹克球比賽平台（開發中）

技術棧：Node.js 18+、Express、MongoDB（Mongoose）、Tailwind CSS、Socket.io。

## 本機需求

- [MongoDB](https://www.mongodb.com/try/download/community) 本機執行於 `mongodb://127.0.0.1:27017`，或自訂連線字串。
- Node.js 18 以上。

## 安裝與啟動

```bash
cd 計分系統
cp .env.example .env
# 編輯 .env 可改 MONGODB_URI、SESSION_SECRET

npm install
npm run build:css
npm run seed
npm run dev
```

瀏覽：

- 首頁：http://localhost:3000  
- 示範大會前台：http://localhost:3000/e/demo-2026  
- 管理後台：http://localhost:3000/admin/login（`admin@demo.local` / `Demo1234`）  
- 裁判：http://localhost:3000/referee/login（`referee@demo.local` / `Demo1234`）  

`npm run seed` 會輸出「大螢幕」單場網址（`/e/demo-2026/screen/...`）。

### 管理後台可做的事

登入後可 **新增大會**、進入 **大會設定**（名稱、slug、日期、場地；變更 slug 會將舊 slug 列入別名），並新增 **賽事**（小組／淘汰、各組前 N 名）。

在 **賽事管理頁**（`/admin/tournaments/:id`）可管理：**組別**、**隊伍**、**場次**（對戰、**賽制**：三局兩勝／五局三勝／一局過、開賽時間、場地、狀態），以及進入 **單場編輯** 指派 **裁判**。

**Excel 匯入場次**：同一頁可 **下載 xlsx 範本**、上傳填好的 `.xlsx`／`.xls`／`.csv`（讀取第一個工作表）。開賽欄位為 **僅時分（HH:mm）**，日期由大會設定。欄位說明見 `public/docs/xlsx-import-format.md`。

## 開發指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 開發模式（程式變更自動重啟） |
| `npm run build:css` | 編譯 Tailwind 至 `public/css/styles.css` |
| `npm run build:css:dev` | Tailwind watch |
| `npm run seed` | 寫入示範帳號與一場比賽 |

## 專案結構（摘要）

- `src/server.js`：HTTP + Socket.io
- `src/app.js`：Express 設定、Session、路由
- `src/models/`：資料模型
- `src/routes/`：頁面與 API
- `src/lib/scoring.js`：15 分、Deuce、局數／完賽邏輯
- `views/`：EJS 版型

詳見同目錄 `開發功能報告書.md`。
