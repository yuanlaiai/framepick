#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 首次运行且没有构建产物时，尝试自动构建前端（需要 Node.js）
if [ ! -f web/dist/index.html ]; then
  echo "==> 未找到 web/dist，正在构建前端…"
  (cd web && npm install --no-audit --no-fund && npm run build) || {
    echo "前端构建失败，请手动执行：cd web && npm install && npm run build" >&2
    exit 1
  }
fi

# Docker 里用系统 python，本地用 .venv；HOST=0.0.0.0 供容器端口映射
PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if [ -x .venv/bin/python ]; then
    PYTHON=".venv/bin/python"
  else
    PYTHON="python3"
  fi
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8790}"
exec "$PYTHON" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --log-level info
