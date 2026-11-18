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

PORT="${PORT:-8790}"
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --log-level info
