#!/usr/bin/env bash
# One-time setup on a fresh Hetzner Ubuntu 24.04 server. Run as root:  bash setup-server.sh (edit deploy/Caddyfile first if the domain changes)
set -euo pipefail
[ -f /etc/openpipeline.env ] || { echo 'Create /etc/openpipeline.env first (see .env.example; no comments after values)'; exit 1; }
chmod 600 /etc/openpipeline.env
apt-get update && apt-get install -y curl git gnupg unzip build-essential debian-keyring debian-archive-keyring apt-transport-https ufw unattended-upgrades
# Automatic security updates
dpkg-reconfigure -f noninteractive unattended-upgrades
# Package signing keys: download, refuse unless it is exactly the expected key, then save it for apt.
# Fingerprints checked 18 Nov 2026 against the Ubuntu keyserver; both keys date from 2016.
add_key() {
  local url=$1 want=$2 out=$3 tmp got
  tmp=$(mktemp)
  curl -fsSL "$url" -o "$tmp"
  [ "$(gpg --show-keys --with-colons "$tmp" | grep -c '^pub:')" -eq 1 ] || { echo "$url must hold exactly one key"; exit 1; }
  got=$(gpg --show-keys --with-colons "$tmp" | awk -F: '/^fpr:/ {print $10; exit}')
  [ "$got" = "$want" ] || { echo "Wrong signing key from $url: got $got, expected $want. Stopping."; exit 1; }
  gpg --dearmor < "$tmp" > "$out"
  chmod 644 "$out"
  rm -f "$tmp"
}
# Node 22, from NodeSource's signed apt repository (no downloaded install script runs as root)
add_key https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key 6F71F525282841EEDAF851B42F59B5F99B1BE0B4 /usr/share/keyrings/nodesource.gpg
printf 'Types: deb\nURIs: https://deb.nodesource.com/node_22.x\nSuites: nodistro\nComponents: main\nArchitectures: %s\nSigned-By: /usr/share/keyrings/nodesource.gpg\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/nodesource.sources
# Caddy (HTTPS)
add_key https://dl.cloudsmith.io/public/caddy/stable/gpg.key 65760C51EDEA2017CEA2CA15155B6D79CA56EA34 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y nodejs caddy
node --version | grep -q '^v22\.' || { echo "Expected Node 22, got $(node --version)"; exit 1; }
# SSH: keys only, no passwords
echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/00-keys-only.conf && systemctl reload ssh
# Firewall: only SSH and web
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
# App user and code (copy the repo to /opt/openpipeline first as root, e.g. git clone)
id openpipeline || useradd --system --create-home --shell /bin/bash openpipeline
cd /opt/openpipeline
# Root's settings are installed from the checkout while only root can write it, before any app or package code runs.
for f in deploy/openpipeline.service deploy/Caddyfile; do
  [ "$(stat -c %U "$f")" = root ] || { echo "$f must be owned by root (clone the repo as root, and run this script only once)"; exit 1; }
done
cp deploy/openpipeline.service /etc/systemd/system/ && systemctl daemon-reload
cp deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy
echo 'openpipeline ALL=NOPASSWD: /usr/bin/systemctl restart openpipeline' > /etc/sudoers.d/openpipeline
# Only now does the app user own the code and run npm.
chown -R openpipeline /opt/openpipeline
sudo -u openpipeline npm ci --omit=dev && sudo -u openpipeline npm run ingest
systemctl enable --now openpipeline
(crontab -u openpipeline -l 2>/dev/null || true; echo '5 * * * * /opt/openpipeline/deploy/hourly.sh >> /opt/openpipeline/data/hourly.log 2>&1') | crontab -u openpipeline -
echo "Done. Put secrets in /etc/openpipeline.env (see .env.example), then: systemctl restart openpipeline"
