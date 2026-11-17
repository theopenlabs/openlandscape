#!/usr/bin/env bash
# Hourly (cron, minute 5): ClinicalTrials.gov publishes once each weekday (stamped about 10:00, probably US Eastern).
# When a new release appears, reload it the same hour and record what changed.
# Every hour it also reads SEC filings (src/ingest/news.js) and looks for regulator decisions (approvals, rejections, delays).
# A full reload takes about 3 minutes. The previous database is kept as a backup first.
set -euo pipefail
# Each step runs through src/jobrun.js: it keeps whether the step worked (job_run) and emails us when one starts failing.
cd /opt/openpipeline
exec 9>data/refresh.lock
flock -n 9 || exit 0                                       # a reload is already running
node src/jobrun.js news -- node src/ingest/news.js || echo "news check failed"        # SEC filings, every hour
# Regulator decisions: SEC full-text search every hour; EMA's file once a day from
# 07:00 UTC (rebuilt about 06:00); openFDA approvals and rejection letters once a day from 08:00 UTC.
node src/jobrun.js sec -- node src/ingest/sec-decisions.js || echo "SEC decisions check failed"
node src/jobrun.js ema -- node src/ingest/ema.js --daily || echo "EMA check failed"
node src/jobrun.js fda -- node src/ingest/fda-decisions.js --daily || echo "openFDA decisions check failed"
# EU trials (CTIS): records changed since the last run, once a day from 08:00 UTC, then studies are regrouped.
# On failure it prints why, keeps the EU trials from the last good run and tries again next hour.
node src/jobrun.js ctis -- node src/ingest/ctis.js --daily || echo "CTIS (EU trials) update failed: kept the last good EU trials"
node src/ingest/release.js check || exit 0                 # exit 3 = nothing new
echo "--- $(date -u +%FT%TZ) reload"
cp data/openpipeline.db "data/backup-$(date +%a).db"      # 7 rolling daily backups
node src/ingest/changes.js snapshot
rm -rf data/raw/ctgov data/raw/openfda
node src/jobrun.js fetch -- npm run --silent fetch
node src/jobrun.js load -- npm run --silent load
node src/jobrun.js compare -- node src/ingest/changes.js compare
node src/ingest/release.js done
sudo systemctl restart openpipeline
