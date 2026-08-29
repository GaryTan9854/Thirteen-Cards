#!/bin/bash
set -e

# ThirteenCards Deploy Script
# Usage:
#   ./deploy.sh                      — full deploy (rsync + remote build + pm2 restart)
#   ./deploy.sh --quick              — skip npm install, just rsync + build + restart
#   ./deploy.sh [major|minor|patch]  — force version bump level
#       default: auto-detect from commit messages since last tag (fallback: patch)

REMOTE_USER="gary"
REMOTE_HOST="192.168.1.11"
REMOTE_DIR="/Users/gary/thirteencards-dist"
SSH_KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=no"
QUICK=false
BUMP=""

for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    major|minor|patch) BUMP=$arg ;;
  esac
done

cd "$(dirname "$0")"

# ── Version bump (SemVer: MAJOR.MINOR.PATCH) ────────────────────────────────
# 自動判斷：掃描上次 tag 以來所有 commit message，取最高等級
#   feat!: / breaking: → major   feat: → minor   其他（fix/refactor/perf/style…）→ patch
CURRENT_VER=$(grep -o 'APP_VERSION = "[^"]*"' backend/main.py | cut -d'"' -f2)

if [ -z "$BUMP" ]; then
  LAST_TAG=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo "")
  SUBJECTS=$(git log ${LAST_TAG:+$LAST_TAG..}HEAD --pretty=%s 2>/dev/null || echo "")
  BUMP=patch
  echo "$SUBJECTS" | grep -qE '^(breaking:|[a-z]+(\([^)]*\))?!:)' && BUMP=major
  if [ "$BUMP" = "patch" ]; then
    echo "$SUBJECTS" | grep -qE '^feat(\([^)]*\))?:' && BUMP=minor
  fi
fi

IFS=. read -r MA MI PA <<< "$CURRENT_VER"
PA=${PA:-0}
case "$BUMP" in
  major) MA=$((MA+1)); MI=0; PA=0 ;;
  minor) MI=$((MI+1)); PA=0 ;;
  *)     PA=$((PA+1)) ;;
esac
NEXT_VER="$MA.$MI.$PA"

# Build number = git commit 總數（含本次 deploy commit）
BUILD=$(( $(git rev-list --count HEAD) + 1 ))

sed -i '' "s/APP_VERSION = \"[^\"]*\"/APP_VERSION = \"$NEXT_VER\"/" backend/main.py
sed -i '' "s/APP_BUILD = \"[^\"]*\"/APP_BUILD = \"$BUILD\"/" backend/main.py
echo "🔢 Version: v$CURRENT_VER → v$NEXT_VER ($BUMP) | Build: $BUILD"

echo "📝 [0/4] Committing to git…"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "deploy ThirteenCards v$NEXT_VER (build $BUILD) $(date '+%Y-%m-%d %H:%M')"
  git tag "v$NEXT_VER"
fi
if git remote | grep -q origin; then
  git push origin main --tags 2>/dev/null || git push origin master --tags 2>/dev/null || echo "   (git push skipped)"
fi

echo "💾 [1/5] Backing up data on MBP…"
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "
  PROJ_DIR=\$HOME/db/thirteencards
  BACKUP_DIR=\$HOME/db-backups/thirteencards
  mkdir -p \$PROJ_DIR/logs \$BACKUP_DIR

  DB=\$PROJ_DIR/game_logs.db
  if [ -f \$DB ]; then
    STAMP=\$(date +%Y%m%d_%H%M%S)
    cp \$DB \$BACKUP_DIR/game_logs_\$STAMP.db
    ls -t \$BACKUP_DIR/game_logs_*.db 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
    echo \"   game_logs.db → game_logs_\$STAMP.db\"
  fi
  NLOG=\$(ls \$PROJ_DIR/logs/*.jsonl 2>/dev/null | wc -l | tr -d ' ')
  echo \"   \$NLOG JSONL log file(s) safe at ~/db/thirteencards/logs/\"
"

echo "📦 [2/5] Syncing source to MBP…"
rsync -az -e "ssh $SSH_OPTS" \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.env' \
  --exclude 'venv/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'backend/static/' \
  --exclude 'backend/logs/' \
  --exclude 'backend/game_logs.db' \
  --exclude '.git/' \
  --exclude 'backend/ml/data/dist_10k_*.npz' \
  --exclude 'backend/ml/data/train_*.npz' \
  --exclude 'backend/ml/data/*.pt' \
  "$(dirname "$0")/" \
  $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/

echo "🔨 [3/5] Building frontend on MBP…"
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "
  zsh -lic '
  set -e
  cd $REMOTE_DIR/frontend

  if [ \"$QUICK\" = false ]; then
    echo \"   → npm install…\"
    npm install --silent
  fi

  echo \"   → vite build → ../backend/static/\"
  npm run build
  ls -lh $REMOTE_DIR/backend/static/assets/ 2>/dev/null || true
  '" || { echo "❌ 前端 build 失敗（tsc/vite）— 已中止：PM2 未重啟、線上 bundle 未更新。修正後重跑 deploy（版本/commit 已先推進，無妨，下次 build 成功即同步）"; exit 1; }

echo "🚀 [4/5] Installing Python deps + restarting PM2…"
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "
  zsh -lic '
  cd $REMOTE_DIR/backend

  if [ ! -d venv ]; then
    python3 -m venv venv
    echo \"   venv created\"
  fi

  if [ \"$QUICK\" = false ]; then
    echo \"   → pip install…\"
    venv/bin/pip install -r requirements.txt -q -i https://pypi.tuna.tsinghua.edu.cn/simple
  fi

  pm2 restart thirteencards 2>/dev/null || \
    pm2 start venv/bin/python3 \
      --name thirteencards \
      --cwd $REMOTE_DIR/backend \
      -- -m uvicorn main:app --host 0.0.0.0 --port 3013 --no-access-log
  pm2 save --force
  '
"

# ── DB 備份 ────────────────────────────────────────────────────
# 2026-08-29：拉回 MBA 這條線已停用。災難復原改由 MBP 自己每天 03:00 備份到 NAS
# （MBP:~/bin/backup-to-nas.sh，launchd com.gary.backup-to-nas）。
# deploy 前的回滾保護留在 MBP 本機，見下。
# MBP 本機已在部署前留了 5 份輪替快照（見上面的 BACKUP_DIR），回滾夠用。

echo ""
echo "✅ Deploy complete → ThirteenCards v$NEXT_VER → https://thirteencards.visadelab.xyz"
