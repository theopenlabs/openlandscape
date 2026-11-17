# Running your own copy

To try OpenLandscape on your computer you need no accounts: see [README.md](README.md). This page is for running
it on a server for other people.

## Accounts and keys

All keys go in `.env` (on your computer) or `/etc/openpipeline.env` (on a server). `.env.example` lists every
setting, with a short note on each. Never commit the real file.

| What | Why | Needed? | Settings |
|---|---|---|---|
| A domain name | The public address | For a server | `PUBLIC_URL`, `DASHBOARD_URL`, `COOKIE_DOMAIN` |
| A server (Ubuntu 24.04, 2 CPUs, 4 GB memory is enough) | Runs the database, website and AI connector | For a server | none |
| Stripe | Payments | Only to take payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_SOLO_YEAR` |
| Resend | Sends the sign-in and weekly emails | For a server (without it, sign-in links only go to the server log) | `RESEND_API_KEY`, `MAIL_FROM`, `DIGEST_TO`, `DIGEST_FROM` |
| Google Cloud OAuth client | "Continue with Google" | Optional; the button is hidden without it | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Cloudflare (free plan) | DNS and protection in front of the server | Optional | none |

Also set:

- `ADMIN_TOKEN`: a long random string. `ADMIN_EMAILS`: the accounts that may open `/admin`.
- `CONTACT_EMAIL`: where "Report a wrong row" sends people.
- `BRAND`: the name shown on the site.

The AI connector's sign-in needs no keys. It uses `PUBLIC_URL` as its address.

## Server setup (once, about 20 minutes)

The files in `deploy/` set up one Ubuntu 24.04 server. One server holds everything: the SQLite database, the
website and the AI connector. Caddy in front gets the HTTPS certificates by itself.

1. Point your domain at the server.
2. Put this repository at `/opt/openpipeline` (for example with `git clone`).
3. Copy `.env.example` to `/etc/openpipeline.env` and fill it in. Put no comments after values on the same line:
   systemd reads them as part of the value.
4. Change the domain names in `deploy/Caddyfile` to yours.
5. Run `deploy/setup-server.sh` as the server's administrator. It installs Node 22 and Caddy, turns on automatic
   security updates and a firewall (SSH and web only), creates an `openpipeline` user, builds the database with
   `npm run ingest`, starts the service (`deploy/openpipeline.service`), and schedules `deploy/hourly.sh`.
6. In Stripe, under Developers, then Webhooks, add `https://<your-domain>/billing/webhook` with the events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`
   and `customer.subscription.deleted`. Put the
   signing secret in `/etc/openpipeline.env`, then restart the service.

`deploy/hourly.sh` runs every hour. It looks for a new ClinicalTrials.gov release and reloads the same hour one
appears, keeping the previous database as a backup. It also reads SEC filings and regulator decisions.

Before you have a domain, you can use `<server-ip-with-dashes>.sslip.io` as the domain. It gets a real HTTPS
certificate.

## Deploying changes without logging in as administrator (optional)

`deploy/install-deploy-access.sh` and `deploy/ol-deploy` set up a fixed menu of actions that an SSH key may run on
the server, as the app's own user: put a new commit live (it goes back by itself if the site fails a test after
the switch), regroup the drugs, load rows, show status, or make a copy of the public data. Read the comments at
the top of both files before using them, and change `REPO` in `deploy/ol-deploy` to your own repository.

## Why one server

The pages are built on the server, so they show data at once. One server with Caddy in front means one thing to
deploy and one file to back up. The server keeps public pages in memory for 10 minutes, so a burst of visitors
costs little.
