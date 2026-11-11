#!/usr/bin/env bash
# 打包 extension/ 为可上传 Chrome Web Store 的 zip（manifest.json 位于 zip 根目录）
set -euo pipefail

cd "$(dirname "$0")/.."
if [ ! -f extension/vendor/ffmpeg-core/ffmpeg-core.wasm ]; then
  echo "缺少 extension/vendor/ffmpeg-core，请先运行 npm install && npm run vendor" >&2
  exit 1
fi
VERSION=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
OUT="dist/douyin-note-to-video-v${VERSION}.zip"
rm -f "$OUT"
(cd extension && zip -rq "../$OUT" . -x ".*")
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
