#!/usr/bin/env bash
# 在伺服器上部署（testing 或 production）
# 用法：./deploy/deploy.sh test
#       ./deploy/deploy.sh prod
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_NAME="${1:-}"
if [[ "$ENV_NAME" != "test" && "$ENV_NAME" != "prod" ]]; then
  echo "用法: $0 test|prod"
  exit 1
fi

CONFIG_FILE="$SCRIPT_DIR/deploy.${ENV_NAME}.env"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "找不到設定檔: $CONFIG_FILE"
  echo "請先複製: cp deploy/deploy.${ENV_NAME}.env.example deploy/deploy.${ENV_NAME}.env"
  exit 1
fi

# shellcheck source=/dev/null
source "$CONFIG_FILE"

: "${APP_DIR:?APP_DIR 未設定}"
: "${GIT_BRANCH:?GIT_BRANCH 未設定}"
: "${SYSTEMD_SERVICE:?SYSTEMD_SERVICE 未設定}"
: "${HEALTH_URL:?HEALTH_URL 未設定}"

log() { echo "[deploy:$ENV_NAME] $*"; }

if [[ ! -d "$APP_DIR" ]]; then
  echo "APP_DIR 不存在: $APP_DIR"
  exit 1
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "缺少 $APP_DIR/.env — 請在伺服器建立（勿提交 git）"
  exit 1
fi

cd "$APP_DIR"

log "拉取 git ($GIT_BRANCH)..."
git fetch origin
git checkout "$GIT_BRANCH"
git pull --ff-only origin "$GIT_BRANCH"

log "安裝依賴..."
npm ci

log "編譯 CSS..."
npm run build:css

log "移除 devDependencies..."
npm prune --omit=dev

log "重啟 $SYSTEMD_SERVICE..."
sudo systemctl restart "$SYSTEMD_SERVICE"

log "等待服務啟動..."
sleep 2

if systemctl is-active --quiet "$SYSTEMD_SERVICE"; then
  log "systemd: active"
else
  echo "服務未正常啟動，最近 log："
  sudo journalctl -u "$SYSTEMD_SERVICE" -n 30 --no-pager
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  if [[ "$HTTP_CODE" =~ ^[23] ]]; then
    log "健康檢查 OK ($HEALTH_URL → $HTTP_CODE)"
  else
    log "警告: 健康檢查 HTTP $HTTP_CODE ($HEALTH_URL)"
  fi
fi

log "部署完成 — ${DOMAIN:-$ENV_NAME}"
