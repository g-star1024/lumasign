#!/bin/bash
# 灵屏 LumaSign · macOS 启动脚本
# 双击运行；首次运行需赋予执行权限：chmod +x 启动-Mac.command
cd "$(dirname "$0")" || exit 1

NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
  echo "未检测到 Node.js，请先安装：https://nodejs.org （建议 LTS 18+）"
  exit 1
fi

echo "灵屏 LumaSign 服务端启动中…"
echo "管理端： http://localhost:7788/"
echo "终端发现：UDP 7789"
echo "按 Ctrl+C 停止"
node server/server.js
