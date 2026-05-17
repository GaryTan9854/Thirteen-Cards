#!/bin/bash
set -e

# ThirteenCards Deploy Script
# Usage:
#   ./deploy.sh           — full deploy (rsync + remote build + pm2 restart)
#   ./deploy.sh --quick   — skip npm install, just rsync + build + restart

REMOTE_USER="gary"
REMOTE_HOST="192.168.1.11"
REMOTE_DIR="/Users/gary/thirteencards-dist"
SSH_KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=no"
QUICK=false

for arg in "$@"; do
  [[ "$arg" == "--quick" ]] && QUICK=true
done

cd "$(dirname "$0")"

# ── Version bump ────────────────────────────────────────────────────────────
CURRENT_VER=$(python3 -c "
import re
with open('backend/main.py') as f:
    m = re.search(r'APP_VERSION = \"([^\"]+)\"', f.read())
    print(m.group(1) if m else '1.0')
")
NEXT_VER=$(python3 -c "
parts = '$CURRENT_VER'.split('.')
major, minor = int(parts[0]), int(parts[1])
print(f'{major + 1}.0' if minor == 20 else f'{major}.{minor + 1}')
")
python3 -c "
import re
path = 'backend/main.py'
with open(path) as f:
    content = f.read()
content = re.sub(r'APP_VERSION = \"[^\"]+\"', 'APP_VERSION = \"$NEXT_VER\"', content)
with open(path, 'w') as f:
    f.write(content)
"
echo "🔢 Version bumped: v$CURRENT_VER → v$NEXT_VER"

echo "📝 [0/4] Committing to git…"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "deploy ThirteenCards v$NEXT_VER $(date '+%Y-%m-%d %H:%M')"
fi
if git remote | grep -q origin; then
  git push origin main 2>/dev/null || git push origin master 2>/dev/null || echo "   (git push skipped)"
fi

echo "📦 [1/4] Syncing source to MBP…"
rsync -az -e "ssh $SSH_OPTS" \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.env' \
  --exclude 'venv/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'backend/static/' \
  --exclude '.git/' \
  "$(dirname "$0")/" \
  $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/

echo "🔨 [2/4] Building frontend on MBP…"
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "
  zsh -lic '
  cd $REMOTE_DIR/frontend

  if [ \"$QUICK\" = false ]; then
    echo \"   → npm install…\"
    npm install --silent
  fi

  echo \"   → vite build → ../backend/static/\"
  npm run build
  ls -lh $REMOTE_DIR/backend/static/assets/ 2>/dev/null || true
  '"

echo "🚀 [3/4] Installing Python deps + restarting PM2…"
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "
  zsh -lic '
  cd $REMOTE_DIR/backend

  if [ ! -d venv ]; then
    python3 -m venv venv
    echo \"   venv created\"
  fi

  if [ \"$QUICK\" = false ]; then
    echo \"   → pip install…\"
    venv/bin/pip install -r requirements.txt -q
  fi

  pm2 restart thirteencards 2>/dev/null || \
    pm2 start venv/bin/python3 \
      --name thirteencards \
      --cwd $REMOTE_DIR/backend \
      -- -m uvicorn main:app --host 0.0.0.0 --port 3013 --no-access-log
  pm2 save --force
  '
"

echo ""
echo "✅ Deploy complete → ThirteenCards v$NEXT_VER → https://thirteencards.visadelab.xyz"
