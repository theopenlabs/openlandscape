#!/usr/bin/env bash
# `npm run data`: a fresh copy of the live site's public data (`copy` in deploy/ol-deploy: no accounts, sign-ins, keys,
# payments or emails), saved as the main folder's data/openpipeline.db. Working copies (git worktrees inside the repo) without a
# database of their own use that file (src/db.js). Needs the ol-status key (deploy/ACCESS.md); no Touch ID.
set -euo pipefail
root=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
out="$root/data/openpipeline.db"
part="$out.download"
mkdir -p "$root/data"
trap 'rm -f "$part" "$part.gz" "$part-wal" "$part-shm"' EXIT
echo "Asking the server for a copy (about a minute)..."
ssh -o ConnectTimeout=20 ol-status "copy" > "$part.gz"
gunzip -c "$part.gz" > "$part"
[ "$(sqlite3 "$part" 'pragma integrity_check')" = ok ] || { echo "The copy arrived damaged; the old one is kept."; exit 1; }
private=$(sqlite3 "$part" "select group_concat(name, ', ') from sqlite_master where type='table' and name in ('user','session','api_key','payment','login_token')")
[ -z "$private" ] || { echo "The copy holds $private; not saved."; exit 1; }
rm -f "$out-wal" "$out-shm"
mv -f "$part" "$out"
echo "Saved $out: $(sqlite3 "$out" 'select count(*) from trial') trials, loaded $(sqlite3 "$out" "select v from meta where k='trials_loaded_at'")."
