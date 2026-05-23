# 伺服器部署

## 目錄

| 檔案 | 說明 |
|------|------|
| `deploy.sh` | 在伺服器上部署（git pull、build、重啟） |
| `remote-deploy.sh` | 從本機 SSH 觸發遠端 deploy |
| `install-server.sh` | 首次安裝 Apache vhost + systemd |
| `deploy.test.env.example` | Testing 設定範本 |
| `deploy.prod.env.example` | Production 設定範本 |
| `apache/` | Cloudflare Flexible 用的 Virtual Host |
| `systemd/` | Node 服務 unit |

## 網域與埠

| 環境 | 網域 | Node PORT | systemd |
|------|------|-----------|---------|
| Testing | testmatch.picklevibes.hk | 5239 | pickleball-test |
| Production | match.picklevibes.hk | 5240 | pickleball-prod |

## 首次安裝（伺服器）

```bash
# 1. 安裝 Node 18+、git
# 2. 複製專案
sudo mkdir -p /var/www/pickleball-test /var/www/pickleball-prod
sudo git clone <你的-repo> /var/www/pickleball-test
sudo git clone <你的-repo> /var/www/pickleball-prod

# 3. Apache + systemd
cd /var/www/pickleball-test
sudo ./deploy/install-server.sh

# 4. 各環境 .env（勿提交 git）
# testing: PORT=5239, NODE_ENV=production, MONGODB_URI=..._dev
# production: PORT=5240, NODE_ENV=production, MONGODB_URI=..._prod
sudo nano /var/www/pickleball-test/.env
sudo nano /var/www/pickleball-prod/.env
sudo chown www-data:www-data /var/www/pickleball-*/.env

# 5. deploy 設定
cp deploy/deploy.test.env.example deploy/deploy.test.env
cp deploy/deploy.prod.env.example deploy/deploy.prod.env

# 6. 啟動服務
sudo systemctl enable --now pickleball-test
sudo systemctl enable --now pickleball-prod
```

## 日常部署

在伺服器上：

```bash
cd /var/www/pickleball-test && ./deploy/deploy.sh test
cd /var/www/pickleball-prod && ./deploy/deploy.sh prod
```

從本機（需設定 `deploy/remote.env`）：

```bash
./deploy/remote-deploy.sh test
./deploy/remote-deploy.sh prod
```

## 首頁轉去大會報分表

在該環境 `.env` 設定（建議用程式，可帶 `#standings` 錨點）：

```bash
HOME_REDIRECT=/e/match-ap-2026#standings
```

改完重啟 Node：`sudo systemctl restart pickleball-prod`

若只用 Apache `Redirect` / `RewriteRule`，`#` 在設定檔裡是註解符號，通常**無法**可靠轉到 `#standings`；最多轉到 `/e/match-ap-2026`。

## Cloudflare

- SSL/TLS：**Flexible**
- WebSockets：**開啟**
- DNS：兩個 subdomain 指到伺服器 IP（Proxied）

## 指令權限

```bash
chmod +x deploy/deploy.sh deploy/install-server.sh deploy/remote-deploy.sh
```
