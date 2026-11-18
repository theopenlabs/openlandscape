<p align="center">
  <img src="brand/readme/banner.png" alt="OpenLandscape: every drug in development, with a source for every fact. Free to start, $49 a month, open source.">
</p>

<p align="center">
  Drug-pipeline landscapes from public registries: every drug for a disease, target or company,<br>
  who owns it, how far it has got and what happens next. On the web, and inside your AI assistant.
</p>

<p align="center">
  <a href="https://openlandscape.app"><b>openlandscape.app</b></a> ·
  <a href="https://openlandscape.app/landscapes/obesity">Try it (no account)</a> ·
  <a href="#use-it-from-your-ai-assistant">Use it from your AI</a> ·
  <a href="#openlandscape-and-the-big-pipeline-databases">vs Citeline</a> ·
  <a href="#what-it-costs">What it costs</a> ·
  <a href="#run-it-yourself">Run it yourself</a>
</p>

## Why OpenLandscape

**A source for every fact.** Every stage, date and number links to where it came from: ClinicalTrials.gov, the EU
trials register, FDA, EMA, SEC filings or the company's own news. Nothing to take on trust.

**A fair price.** Pipeline databases such as Citeline are sold to big pharma for tens of thousands a year, after a
sales call. OpenLandscape starts free and costs $49 a month for everything.

**Open by default.** The code is here, so anyone can see how every list is made. Your AI assistant can use it
directly through the MCP connector.

## What it does

### A landscape for any disease, target or company

Search for an area and get every drug in active trials: how it works, who owns it, its stage and its next date.
Filter by stage, mechanism or China-based companies, copy the table or download it. Ready-made landscapes
(obesity, PD-1/VEGF bispecifics, in vivo CAR-T, lung cancer) are free to read without an account.

![The obesity landscape: what changed this week, what is coming up, and every drug with how it works, company, stage and next date](brand/readme/landscape.png)

### Every drug, with its trials and sources

A drug page says what the drug is in plain words, its other names and code names, every trial and what it is tested
for, with the registry entry behind each line.

![The mazdutide page: stage, next date, active trials and targets, and what the drug is, in plain words with sources](brand/readme/drug.png)

### Every company's pipeline

A company page lists everything it runs in trials, what is furthest along, what reads out next, and its SEC filings.

![The Novo Nordisk page: drugs furthest along, next date, number of drugs and trials, and the drug list](brand/readme/company.png)

### Ask your AI

Add the connector to Claude, ChatGPT, Cursor or any MCP app and ask in plain words. The answer comes from the same
data, with the sources attached.

![A real answer through the connector: oral GLP-1 pills in Phase 3 or later, with company, stage and next date](brand/readme/ai-answer.png)

### Follow an area, hear what changed

Follow a landscape and see every new trial, moved date, approval and filing as it happens. A Monday email sums up
the week and the dates coming up.

<p align="center"><img src="brand/readme/monday-email.png" width="520" alt="The Monday email: what changed this week and what is coming up, each line with its source"></p>

### Light, dark and on your phone

![The PD-1/VEGF bispecifics landscape in dark mode](brand/readme/dark-mode.png)

![OpenLandscape on two phones: the obesity landscape and the mazdutide page](brand/readme/phones.png)

<p align="center">
  <sub>Screenshots are from the live data. The account in them (alex@example.com) is made up.</sub>
</p>

## OpenLandscape and the big pipeline databases

| | OpenLandscape | Citeline and similar |
|---|---|---|
| Price | Free to start, then $49 a month | Tens of thousands a year |
| Getting started | Sign in with your email, no card | A sales call and a contract |
| Where the facts come from | Public registries, regulators, filings and company news, each linked | Also their own analysts and private research |
| Code | Open source (AGPL-3.0) | Closed |

The big databases cover more, because they pay analysts to read what is not public. OpenLandscape covers what is
public, shows you the source for each line, and costs a small part of the price.

## What it costs

- **Free:** no card, no time limit. The top 10 of any list, one landscape in full and 25 AI questions a month.
- **Solo:** $49 a month or $490 a year (before VAT), for one person. Every list in full, follows, every change as it
  happens and the Monday email.

Details: [openlandscape.app/pricing](https://openlandscape.app/pricing).

## Use it from your AI assistant

OpenLandscape is a remote MCP server (Streamable HTTP). Server URL:

```
https://openlandscape.app/mcp
```

You sign in with your OpenLandscape account (OAuth) the first time; a free account works.

- **Claude** (app or claude.ai): find OpenLandscape in the connector directory, or **Settings → Connectors → Add
  custom connector**, name it OpenLandscape and paste the URL.
- **Claude Code:**

  ```bash
  claude mcp add --transport http openlandscape https://openlandscape.app/mcp
  ```

- **Cursor:** add to `~/.cursor/mcp.json`:

  ```json
  { "mcpServers": { "openlandscape": { "url": "https://openlandscape.app/mcp" } } }
  ```

- **Gemini CLI:** add to `~/.gemini/settings.json`, restart, and type `/mcp` to check:

  ```json
  { "mcpServers": { "openlandscape": { "httpUrl": "https://openlandscape.app/mcp" } } }
  ```

- **ChatGPT** and other apps: step-by-step on [openlandscape.app/connect](https://openlandscape.app/connect).

Then ask, for example: *"Map every amylin drug in Phase 2 or later, with next milestones."*

Tools: `search`, `landscape`, `trials`, `catalysts`, `who_runs_trials`, `drug`, `changes`, `whoami`, and `show`
(draws the answer as a card in apps that support it). Every answer carries its sources.

More for AI tools: [openlandscape.app/ai](https://openlandscape.app/ai) and [openlandscape.app/llms.txt](https://openlandscape.app/llms.txt).

## Run it yourself

### What is in this copy, and what is not

This repository is the open-source copy of the code. It has everything the site runs on: the data loaders, the
grouping of trials into drugs, the website, sign-in, billing, the AI connector and the checks.

It does not have the checked data. People check the rows by hand: which trial belongs to which drug, which company
owns what, which names mean the same drug. That work is what OpenLandscape sells, so it stays private. Also private:
company logos and the list of company aliases (for example that "GSK" means GlaxoSmithKline).

So a copy you build yourself is thinner than the live site:

- One checked area: obesity (`seed/obesity.js`), as a sample of what the checked data looks like.
- Every other area is grouped automatically from the registry names. It works, but expect more duplicates and
  more drugs without a known company or target.
- No company logos. Some company searches by short name find nothing.
- The files that hold checked data are empty stand-ins with the right shape (in `seed/`), so the code runs.

### Run it on your computer

Needs Node 22 or later, and about 1 GB of free disk space.

```bash
npm install
npm run ingest      # downloads trials from ClinicalTrials.gov and approvals from openFDA, builds the database (15 to 20 minutes)
npm start           # http://localhost:8080
```

Then open [localhost:8080/landscapes/obesity](http://localhost:8080/landscapes/obesity).

The database is one SQLite file, `data/openpipeline.db` (a few hundred MB). `npm run ingest` builds it from public
sources only. Most of the time goes on looking up drug names in public drug lists (the FDA substance registry and
the NCI drug dictionary) and FDA labels. The drug-list lookups stop after a few minutes, so some names are not
asked, and a few rows that are the same drug stay apart. Run `npm run ingest` again to refresh.

No keys are needed to run it locally:

- Without an email service, sign-in links are printed in the server log and shown on the page.
- Without a Stripe key, the pricing page shows, but checkout says payments are not configured.

To add keys, copy `.env.example` to `.env` and fill in what you need. [SETUP.md](SETUP.md) lists every account and
key, and how to run your own server.

#### Run the checks

```bash
TODAY=2026-11-06 npm run check
```

`TODAY` fixes the date, so date-based checks give the same answer on any day. Some checks need the private checked
data. In this copy they print `SKIP` and do not fail. That is expected.

## How it works

| Piece | What it does | Where |
|---|---|---|
| Trial loader | Downloads industry drug trials (phase 1 to 4) from the ClinicalTrials.gov API | `src/ingest/ctgov.js` |
| Approval loader | Downloads the FDA's list of approved drugs (openFDA) | `src/ingest/openfda.js` |
| Checked data | Hand-checked companies, drug names, approvals and filings, with sources | `seed/` (obesity only here) |
| Grouping | Groups trials into drugs, merges names for the same drug (mazdutide = LY3305677 = IBI362), skips placebo and comparator arms | `src/ingest/link.js` |
| Questions | Search, landscape, trials, catalysts, who runs trials, one drug, recent changes | `src/query.js` |
| AI connector | The same questions for AI apps, as a remote MCP server | `src/mcp.js` |
| Website | Landscape pages, dashboard, pricing, Stripe checkout, email sign-in | `src/server.js`, `src/pages/`, `web/` |
| Client | The connector setup for Claude and ChatGPT, and skills for writing landscape memos | `client/` |

Checked areas are listed in `seed/index.js`. To check a new area, add a seed file in the same format as
`seed/obesity.js` and list it there.

**Why the ClinicalTrials.gov API and not AACT?** AACT is a nightly database copy of the same registry. It needs an
account, and we only need the industry drug trials, a small part of it. The official API serves the same records
with no account.

## The AI connector

The connector is a remote MCP server at `/mcp`. AI apps sign in with OAuth (`src/oauth.js`); `/mcp/u/<api-key>`
also works for apps that take a plain address. It has eight tools:

`whoami`, `search`, `landscape`, `trials`, `catalysts`, `who_runs_trials`, `drug`, `changes`.

A ninth tool, `show`, draws the answer as a card inside Claude or ChatGPT. Set `AI_CARDS=0` in `.env` to turn cards
off; `show` then goes away and the tools answer in text only.

## Rules the product follows

1. Every phase, date and number links to its source.
2. Facts from press reports carry a "news" tag. Name merges and mechanisms not yet confirmed carry an orange dot.
3. Every page says when the data was pulled.
4. Features not built yet show the month they ship.

## Contributing and security

- How to send changes: [CONTRIBUTING.md](CONTRIBUTING.md)
- How to report a security problem: [SECURITY.md](SECURITY.md). Please do not open a public issue for it.

## Licence

- The app (server, data loaders, AI connector, website): AGPL-3.0, see `LICENSE`.
- The client (`client/`): MIT, see `client/LICENSE`.

The data the app downloads comes from ClinicalTrials.gov, openFDA and SEC EDGAR, under their own terms.
