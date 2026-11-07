#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================="
echo "  GioV 雨量計 (Hiroshima Rainfall) を起動しています..."
echo "=========================================="

# ポート5501が起動しているか確認し、起動していなければ起動
if ! lsof -i :5501 > /dev/null 2>&1; then
    echo "サーバー (server/server.js) を起動中..."
    node server/server.js &
    sleep 1
else
    echo "サーバーは既に起動しています。"
fi

# ブラウザを自動で開く
echo "ブラウザで GioV 雨量計 を開きます..."
open http://localhost:5501
