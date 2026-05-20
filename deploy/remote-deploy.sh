#!/usr/bin/env bash
# 從本機 SSH 到伺服器執行 deploy（可選）
# 用法：./deploy/remote-deploy.sh test
#       ./deploy/remote-deploy.sh prod
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_NAME="${1:-}"

if [[ "$ENV_NAME" != "test" && "$ENV_NAME" != "prod" ]]; then
  echo "用法: $0 test|prod"
  exit 1
fi

REMOTE_CONFIG="$SCRIPT_DIR/remote.env"
if [[ ! -f "$REMOTE_CONFIG" ]]; then
  echo "請建立 $REMOTE_CONFIG（參考 deploy/remote.env.example）"
  exit 1
fi

# shellcheck source=/dev/null
source "$REMOTE_CONFIG"

: "${SSH_HOST:?SSH_HOST 未設定}"
: "${SSH_USER:?SSH_USER 未設定}"

SSH_PORT="${SSH_PORT:-22}"

DEPLOY_CONFIG="$SCRIPT_DIR/deploy.${ENV_NAME}.env"
if [[ ! -f "$DEPLOY_CONFIG" ]]; then
  echo "本機需有 $DEPLOY_CONFIG 以讀取 APP_DIR"
  exit 1
fi

# shellcheck source=/dev/null
source "$DEPLOY_CONFIG"

: "${APP_DIR:?APP_DIR 未設定}"

echo "[remote-deploy] $SSH_USER@$SSH_HOST → $APP_DIR (./deploy/deploy.sh $ENV_NAME)"
ssh -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "cd '$APP_DIR' && ./deploy/deploy.sh '$ENV_NAME'"
