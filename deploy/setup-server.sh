#!/usr/bin/env bash
# One-time setup on a fresh Hetzner Ubuntu 24.04 server. Run as root:  bash setup-server.sh (edit deploy/Caddyfile first if the domain changes)
set -euo pipefail
[ -f /etc/openpipeline.env ] || { echo 'Create /etc/openpipeline.env first (see .env.example; no comments after values)'; exit 1; }
chmod 600 /etc/openpipeline.env
apt-get update && apt-get install -y curl git unzip build-essential debian-keyring debian-archive-keyring apt-transport-https ufw unattended-upgrades
# Automatic security updates
dpkg-reconfigure -f noninteractive unattended-upgrades
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
# Caddy (HTTPS)
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
# SSH: keys only, no passwords
echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/00-keys-only.conf && systemctl reload ssh
# Firewall: only SSH and web
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
# App user and code (copy the repo to /opt/openpipeline first, e.g. git clone)
id openpipeline || useradd --system --create-home --shell /bin/bash openpipeline
chown -R openpipeline /opt/openpipeline
cd /opt/openpipeline && sudo -u openpipeline npm ci --omit=dev && sudo -u openpipeline npm run ingest
cp deploy/openpipeline.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now openpipeline
cp deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy
echo 'openpipeline ALL=NOPASSWD: /usr/bin/systemctl restart openpipeline' > /etc/sudoers.d/openpipeline
(crontab -u openpipeline -l 2>/dev/null || true; echo '5 * * * * /opt/openpipeline/deploy/hourly.sh >> /opt/openpipeline/data/hourly.log 2>&1') | crontab -u openpipeline -
echo "Done. Put secrets in /etc/openpipeline.env (see .env.example), then: systemctl restart openpipeline"
