#!/usr/bin/env bash
# One-time setup, run as root on the server. Safe to run again. Changes no site code, data, or the root login.
#   bash install-deploy-access.sh '<deploy public key>' '<status public key>'
# See deploy/ACCESS.md for the whole sequence.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
[ $# -eq 2 ] || { echo "Usage: bash install-deploy-access.sh '<deploy public key>' '<status public key>'"; exit 1; }
for k in "$1" "$2"; do
  case "$k" in
    "ssh-ed25519 "*|"sk-ecdsa-sha2-nistp256@openssh.com "*) ;;
    *) echo "Each key must be a one-line ssh-ed25519 or Touch ID (sk-ecdsa) public key"; exit 1 ;;
  esac
  case "$k" in
    *$'\n'*|*'"'*) echo "Key contains an unexpected character"; exit 1 ;;
  esac
done
here=$(cd "$(dirname "$0")" && pwd)
[ -f "$here/ol-deploy" ] || { echo "ol-deploy must sit next to this script"; exit 1; }
id openpipeline >/dev/null 2>&1 || { echo "The openpipeline user must already exist"; exit 1; }
[ -f /etc/sudoers.d/openpipeline ] || { echo "The app's permission to restart itself (/etc/sudoers.d/openpipeline) must already exist"; exit 1; }

command -v rsync >/dev/null && command -v sqlite3 >/dev/null || { apt-get update && apt-get install -y rsync sqlite3; }

# The menu: root-owned, so neither a deploy nor the app can change its own rules.
install -o root -g root -m 755 "$here/ol-deploy" /usr/local/sbin/ol-deploy
# The menu's working files belong to the app user, because the menu runs as that user.
install -d -o openpipeline -g openpipeline -m 700 /var/lib/ol-deploy
install -d -o root -g openpipeline -m 750 /etc/ol-deploy
# The same ownership every deploy has always set: the menu must be able to write the code folder.
chown -Rh openpipeline /opt/openpipeline

# The user. It has no password and no use except the forced command below.
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/sh deploy
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
{
  printf 'restrict,command="sudo -n -u openpipeline /usr/local/sbin/ol-deploy \\"$SSH_ORIGINAL_COMMAND\\"" %s\n' "$1"
  printf 'restrict,command="sudo -n -u openpipeline /usr/local/sbin/ol-deploy \\"read $SSH_ORIGINAL_COMMAND\\"" %s\n' "$2"
} > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# The one thing the deploy user may do: run the menu as the app user. It gets no root at all.
tmp=$(mktemp)
echo 'deploy ALL=(openpipeline) NOPASSWD: /usr/local/sbin/ol-deploy *' > "$tmp"
visudo -cf "$tmp"
install -o root -g root -m 440 "$tmp" /etc/sudoers.d/ol-deploy
rm -f "$tmp"

# Read-only access to the GitHub repository, for fetching commits. GitHub's identity is fixed here, not trusted on first contact.
echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > /etc/ol-deploy/known_hosts
chmod 644 /etc/ol-deploy/known_hosts
[ -f /etc/ol-deploy/github_key ] || ssh-keygen -q -t ed25519 -N "" -C "ol-deploy server (read only)" -f /etc/ol-deploy/github_key
chown openpipeline:openpipeline /etc/ol-deploy/github_key
chmod 600 /etc/ol-deploy/github_key

echo
echo "Installed. Add this as a READ-ONLY deploy key on the GitHub repository:"
cat /etc/ol-deploy/github_key.pub
