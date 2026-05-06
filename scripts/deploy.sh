#!/bin/bash
# ═════════════════════════════════════════════════════════════════════════════
# Missive Mail — One-click Deploy Script
# Creates all Cloudflare resources, runs migrations, and deploys.
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ─── Pre-flight checks ──────────────────────────────────────────────────────
log "Checking prerequisites..."
command -v wrangler >/dev/null 2>&1 || fail "wrangler CLI not found. Install: npm i -g wrangler"
command -v node    >/dev/null 2>&1 || fail "node not found"
command -v npm     >/dev/null 2>&1 || fail "npm not found"
wrangler whoami >/dev/null 2>&1 || fail "Not logged in to Cloudflare. Run: wrangler login"
ok "Prerequisites OK"

# ─── 1. Create D1 Database ──────────────────────────────────────────────────
log "Step 1/8: Creating D1 database..."
if grep -q "PLACEHOLDER_D1_ID" wrangler.toml; then
  D1_OUTPUT=$(wrangler d1 create mail-db 2>&1) || fail "Failed to create D1 database"
  D1_ID=$(echo "$D1_OUTPUT" | grep -oP 'database_id = "\K[^"]+')
  if [ -n "$D1_ID" ]; then
    sed -i "s/PLACEHOLDER_D1_ID/$D1_ID/" wrangler.toml
    ok "D1 database created: $D1_ID"
  else
    fail "Could not parse D1 database ID from output"
  fi
else
  warn "D1 database already configured, skipping creation"
fi

# ─── 2. Create KV Namespace ─────────────────────────────────────────────────
log "Step 2/8: Creating KV namespace..."
if grep -q "PLACEHOLDER_KV_ID" wrangler.toml; then
  KV_OUTPUT=$(wrangler kv namespace create KV 2>&1) || fail "Failed to create KV namespace"
  KV_ID=$(echo "$KV_OUTPUT" | grep -oP 'id = "\K[^"]+')
  if [ -n "$KV_ID" ]; then
    sed -i "s/PLACEHOLDER_KV_ID/$KV_ID/" wrangler.toml
    ok "KV namespace created: $KV_ID"
  else
    fail "Could not parse KV namespace ID"
  fi
else
  warn "KV namespace already configured, skipping creation"
fi

# ─── 3. Create R2 Bucket ────────────────────────────────────────────────────
log "Step 3/8: Creating R2 bucket..."
if ! wrangler r2 bucket info mail-storage >/dev/null 2>&1; then
  wrangler r2 bucket create mail-storage || fail "Failed to create R2 bucket"
  ok "R2 bucket created: mail-storage"
else
  warn "R2 bucket 'mail-storage' already exists, skipping"
fi

# ─── 4. Run D1 Migrations ───────────────────────────────────────────────────
log "Step 4/8: Running D1 migrations..."
wrangler d1 migrations apply mail-db --local 2>/dev/null || true
wrangler d1 migrations apply mail-db || fail "Failed to apply D1 migrations"
ok "Migrations applied"

# ─── 5. Set Secrets ─────────────────────────────────────────────────────────
log "Step 5/8: Setting secrets..."
set_secret() {
  local name=$1
  local value=$2
  if [ -n "$value" ]; then
    echo "$value" | wrangler secret put "$name" 2>/dev/null && ok "Set $name" || warn "Failed to set $name"
  else
    warn "Skipping $name (value not provided). Set manually: wrangler secret put $name"
  fi
}

# Generate JWT_SECRET if not provided
if [ -z "${JWT_SECRET:-}" ]; then
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))" 2>/dev/null || openssl rand -hex 64 2>/dev/null || echo "")
  if [ -n "$JWT_SECRET" ]; then
    log "Generated random JWT_SECRET"
  fi
fi

set_secret "JWT_SECRET" "${JWT_SECRET:-}"
set_secret "TURNSTILE_SECRET_KEY" "${TURNSTILE_SECRET_KEY:-}"
set_secret "CF_EMAIL_SERVICE_API_KEY" "${CF_EMAIL_SERVICE_API_KEY:-}"

# ─── 6. Build Frontend ──────────────────────────────────────────────────────
log "Step 6/8: Building frontend..."
if [ -d "$PROJECT_DIR/web" ]; then
  cd "$PROJECT_DIR/web"
  npm install --legacy-peer-deps 2>/dev/null || npm install
  npm run build || fail "Frontend build failed"
  cd "$PROJECT_DIR"
  ok "Frontend built"
else
  warn "No web/ directory found, skipping frontend build"
fi

# ─── 7. Deploy Worker ───────────────────────────────────────────────────────
log "Step 7/8: Deploying Worker..."
wrangler deploy || fail "Worker deployment failed"
ok "Worker deployed successfully!"

# ─── 8. Post-deploy info ────────────────────────────────────────────────────
log "Step 8/8: Post-deploy reminders..."
echo ""
echo -e "${YELLOW}═══ Manual Steps Required ════════════════════════════════════════════${NC}"
echo -e "  1. Enable Email Routing in CF Dashboard for your domain"
echo -e "  2. Run: ${GREEN}bash scripts/setup-email.sh${NC}"
echo -e "  3. Set any remaining secrets via CF Dashboard or wrangler"
echo -e "${YELLOW}════════════════════════════════════════════════════════════════════${NC}"
echo ""
ok "Deployment complete! 🚀"
