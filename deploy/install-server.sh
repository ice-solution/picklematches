#!/usr/bin/env bash
# 首次在 Ubuntu/Debian 伺服器安裝 Apache + systemd（需 sudo）
# 用法：sudo ./deploy/install-server.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "請用 sudo 執行: sudo $0"
  exit 1
fi

log() { echo "[install-server] $*"; }

log "安裝 Apache 模組..."
a2enmod proxy proxy_http proxy_wstunnel rewrite headers remoteip

log "安裝 Apache Virtual Host..."
cp "$SCRIPT_DIR/apache/testmatch.picklevibes.hk.conf" /etc/apache2/sites-available/
cp "$SCRIPT_DIR/apache/match.picklevibes.hk.conf" /etc/apache2/sites-available/
a2ensite testmatch.picklevibes.hk.conf
a2ensite match.picklevibes.hk.conf
a2dissite 000-default.conf 2>/dev/null || true

log "安裝 systemd units..."
cp "$SCRIPT_DIR/systemd/pickleball-test.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/pickleball-prod.service" /etc/systemd/system/
systemctl daemon-reload

log "建立應用目錄..."
mkdir -p /var/www/pickleball-test /var/www/pickleball-prod
chown -R www-data:www-data /var/www/pickleball-test /var/www/pickleball-prod

apache2ctl configtest
systemctl reload apache2

log "完成。接下來："
echo "  1. git clone 到 /var/www/pickleball-test 與 /var/www/pickleball-prod"
echo "  2. 各目錄建立 .env（PORT=5239 / 5240，NODE_ENV=production）"
echo "  3. cp deploy/deploy.test.env.example deploy/deploy.test.env（兩邊各一份）"
echo "  4. systemctl enable --now pickleball-test pickleball-prod"
echo "  5. ./deploy/deploy.sh test 或 prod"
