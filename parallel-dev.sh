#!/bin/bash
# OpenMAIC 并行开发启动器
# 用法: ./parallel-dev.sh [session数量，默认3]

REPO="/Users/by/Claude/OpenMAIC"
SESSIONS=${1:-3}

echo "🚀 启动 $SESSIONS 个并行 Claude Code session..."
echo ""

# 创建 tmux session
tmux new-session -d -s claude -c "$REPO" -n "main"

for i in $(seq 1 $((SESSIONS - 1))); do
  BRANCH="wt-$i"
  WT_DIR="${REPO}-wt-${i}"

  # 如果 worktree 已存在就跳过
  if [ -d "$WT_DIR" ]; then
    echo "⚡ Worktree $WT_DIR 已存在，复用"
  else
    # 创建分支和 worktree
    git -C "$REPO" branch -D "$BRANCH" 2>/dev/null
    git -C "$REPO" worktree add "$WT_DIR" -b "$BRANCH" 2>/dev/null
    echo "✅ 创建 worktree: $WT_DIR (分支: $BRANCH)"
  fi

  # 在 tmux 中创建新窗口
  tmux new-window -t claude -n "wt-$i" -c "$WT_DIR"
done

echo ""
echo "📋 使用方法:"
echo "  打开终端，运行: tmux attach -t claude"
echo "  在每个窗口里运行: claude"
echo "  切换窗口: za(主目录) zb(wt-1) zc(wt-2) ..."
echo "  退出 tmux(不关闭): Ctrl+B 然后按 D"
echo ""
echo "🔧 完成后合并:"
echo "  cd $REPO"
echo "  git merge wt-1  # 合并第一个 worktree 的改动"
echo "  git worktree remove ${REPO}-wt-1  # 清理 worktree"
echo ""

# attach 到 tmux session
tmux attach -t claude
