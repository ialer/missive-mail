#!/bin/bash
# ═════════════════════════════════════════════════════════════════════════════
# Missive Mail — Cloudflare Email Routing Setup
# Configures DNS records and Email Routing for receiving mail via CF Workers.
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

# ─── Configuration ───────────────────────────────────────────────────────────
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain>"
  echo "Example: $0 example.com"
  exit 1
fi

echo ""
echo -e "${GREEN}═══ Missive Mail — Email Routing Setup ═════════════════════════════${NC}"
echo -e "  Domain: ${BLUE}$DOMAIN${NC}"
echo ""

# ─── Step 1: DNS Records ────────────────────────────────────────────────────
log "Step 1: Required DNS records for $DOMAIN"
echo ""
echo "  Add the following DNS records in your Cloudflare Dashboard:"
echo ""
echo -e "  ${YELLOW}MX Record:${NC}"
echo "    Type:     MX"
echo "    Name:     $DOMAIN"
echo "    Content:  route1.mx.cloudflare.net"
echo "    Priority: 56"
echo ""
echo "    (Add additional MX records if Cloudflare provides them — typically 3)"
echo ""
echo -e "  ${YELLOW}TXT Record (SPF):${NC}"
echo "    Type:     TXT"
echo "    Name:     $DOMAIN"
echo "    Content:  \"v=spf1 include:_spf.mx.cloudflare.net ~all\""
echo ""
echo -e "  ${YELLOW}DKIM (recommended):${NC}"
echo "    Cloudflare manages DKIM automatically when Email Routing is enabled."
echo ""

# ─── Step 2: Enable Email Routing ───────────────────────────────────────────
log "Step 2: Enable Email Routing"
echo ""
echo "  ⚠️  This step must be done in the Cloudflare Dashboard:"
echo ""
echo "  1. Go to: https://dash.cloudflare.com → Select your zone"
echo "  2. Navigate to: Email → Email Routing"
echo "  3. Click 'Get Started' or 'Enable Email Routing'"
echo "  4. Cloudflare will verify DNS records (MX + TXT)"
echo "  5. Once verified, Email Routing is active"
echo ""

# ─── Step 3: Configure Routing Rules ────────────────────────────────────────
log "Step 3: Configure Catch-All Routing Rule"
echo ""
echo "  In the Email Routing dashboard:"
echo ""
echo "  1. Go to 'Routing Rules' tab"
echo "  2. Under 'Catch-All Address', click 'Edit'"
echo "  3. Select action: 'Send to a Worker'"
echo "  4. Choose worker: ${GREEN}missive-mail${NC}"
echo "  5. Save"
echo ""
echo "  This routes ALL incoming mail for $DOMAIN to the Worker."
echo ""

# ─── Step 4: Custom Address Routing (optional) ──────────────────────────────
log "Step 4: Custom Routing Rules (optional)"
echo ""
echo "  You can also add specific address rules:"
echo ""
echo "  Custom address:  hello@$DOMAIN  →  Worker: missive-mail"
echo "  Custom address:  support@$DOMAIN →  Worker: missive-mail"
echo "  Custom address:  *@$DOMAIN       →  Worker: missive-mail  (catch-all)"
echo ""

# ─── Step 5: KV Email→User Mapping ──────────────────────────────────────────
log "Step 5: Email → User Mapping (KV)"
echo ""
echo "  The Worker uses KV to map email addresses to user IDs."
echo "  When a user registers, add a KV entry:"
echo ""
echo "    Key:   email:<address@$DOMAIN>"
echo "    Value: <user_id>"
echo ""
echo "  Example:"
echo "    wrangler kv key put --binding=KV \"email:bob@$DOMAIN\" \"c1abc123...\""
echo ""
echo "  The auth routes handle this automatically during registration."
echo ""

# ─── Verification ───────────────────────────────────────────────────────────
log "Verification checklist:"
echo ""
echo "  □ DNS MX record points to Cloudflare"
echo "  □ DNS TXT SPF record configured"
echo "  □ Email Routing enabled in CF Dashboard"
echo "  □ Catch-all rule routes to Worker"
echo "  □ Send test email to verify delivery"
echo ""

echo -e "${GREEN}Setup guide complete!${NC}"
echo ""
