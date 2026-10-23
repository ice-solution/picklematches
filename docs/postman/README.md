# 公開前台 API — Postman

給外部平台實作對接用。

## 匯入

1. 打開 Postman → **Import**
2. 選呢兩個檔：
   - `計分系統-公開API.postman_collection.json`
   - `計分系統-公開API.postman_environment.json`
3. 右上角 Environment 揀 **計分系統 — Local**
4. 按需要改 `baseUrl`（正式站改成你嘅網域）同 `eventSlug`

## 建議測試順序

1. `GET /api` — 睇目錄  
2. `GET /api/events` — 攞大會列表  
3. `GET /api/events/:slug` — 攞賽事  
4. `GET /api/events/:slug/matches` — 攞賽程／賽果（把某個 `matches[].id` 填入 `matchId`）  
5. `GET /api/events/:slug/standings` — 積分榜  

## 重點

- 無需認證  
- 直播頁：`match.urls.live` → `/e/{slug}/court/{court}/live`  
- 篩選：`?date=YYYY-MM-DD&status=live&court=1&tournamentId=...`
