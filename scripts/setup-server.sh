#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Cargo Bot — Server Setup Script
#  Tested on: Ubuntu 22.04 / 24.04
#  Run as root: sudo bash scripts/setup-server.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash scripts/setup-server.sh"

# ── 1. System update ──────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Base dependencies ──────────────────────────────────────
info "Installing base dependencies..."
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban

# ── 3. Docker ─────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  warn "Docker already installed: $(docker --version)"
else
  info "Installing Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  systemctl start docker
  info "Docker installed: $(docker --version)"
fi

# ── 4. Deployment directories ─────────────────────────────────
info "Creating deployment directories..."
mkdir -p /opt/cargo_bot_staging
mkdir -p /opt/cargo_bot_prod
info "  /opt/cargo_bot_staging  (staging)"
info "  /opt/cargo_bot_prod     (production)"

# ── 5. Deploy user ────────────────────────────────────────────
DEPLOY_USER="deploy"
if id "$DEPLOY_USER" &>/dev/null; then
  warn "User '$DEPLOY_USER' already exists — skipping"
else
  info "Creating user '$DEPLOY_USER'..."
  useradd -m -s /bin/bash "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
  info "User '$DEPLOY_USER' created and added to docker group"
fi

chown -R "$DEPLOY_USER":"$DEPLOY_USER" /opt/cargo_bot_staging /opt/cargo_bot_prod
chmod 750 /opt/cargo_bot_staging /opt/cargo_bot_prod

# ── 6. Firewall ───────────────────────────────────────────────
info "Configuring firewall (UFW)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment "SSH"
ufw allow 3000/tcp comment "Admin panel — production"
ufw allow 3001/tcp comment "Admin panel — staging"
ufw --force enable
info "Open ports: 22 (SSH), 3000 (prod admin), 3001 (staging admin)"

# ── 7. Fail2ban ───────────────────────────────────────────────
info "Enabling fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# ── Done ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✅ Server is ready!${NC}"
echo ""
echo "  Staging   → /opt/cargo_bot_staging  (port 3001)"
echo "  Prod      → /opt/cargo_bot_prod     (port 3000)"
echo ""
echo "Next steps:"
echo ""
echo "  1. Add SSH key for deploy user (required for GitHub Actions):"
echo "       mkdir -p /home/$DEPLOY_USER/.ssh"
echo "       echo '<your_public_key>' >> /home/$DEPLOY_USER/.ssh/authorized_keys"
echo "       chmod 700 /home/$DEPLOY_USER/.ssh"
echo "       chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys"
echo "       chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh"
echo ""
echo "  2. Add GitHub Actions secrets (Settings → Secrets → Actions):"
echo "       SERVER_HOST          — server IP"
echo "       SERVER_USER          — $DEPLOY_USER"
echo "       SERVER_PASSWORD      — SSH password or private key"
echo "       BOT_TOKEN            — Telegram bot token"
echo "       POSTGRES_PASSWORD    — database password"
echo "       ADMIN_EMAIL          — admin panel email"
echo "       ADMIN_PASSWORD       — admin panel password"
echo "       ADMIN_COOKIE_SECRET  — random string, min 32 chars"
echo ""
echo "  3. Push to main → staging deploy"
echo "     Push to release/x.x.x → production deploy"
