# ---------- 前端构建 ----------
FROM node:24-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 运行镜像 ----------
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FRAMEPICK_DATA_DIR=/data \
    FRAMEPICK_MODEL_DIR=/data/models \
    HOST=0.0.0.0 \
    PORT=8790 \
    CHROME_BIN=/usr/bin/chromium

# ffmpeg 负责转码/截帧；chromium 供抖音、小红书免登录解析使用
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      chromium \
      libatomic1 \
      fonts-wqy-zenhei \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY run.sh ./
COPY --from=web /app/web/dist ./web/dist

VOLUME ["/data"]
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8790/api/health || exit 1

CMD ["bash", "./run.sh"]
