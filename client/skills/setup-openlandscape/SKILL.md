---
name: setup-openlandscape
description: Connect OpenLandscape (drug pipelines, clinical trials and milestones, every fact with its source) to this AI app. Use when the user pastes the OpenLandscape setup prompt or asks to connect OpenLandscape, its MCP server or its skill.
license: MIT
---

# Set up OpenLandscape

OpenLandscape is a remote MCP server with drug-pipeline and clinical-trial data from ClinicalTrials.gov, openFDA and SEC filings, with drug names merged across codes and brands. Every answer links to its source.

- MCP server: https://openlandscape.app/mcp (Streamable HTTP; sign-in by OAuth in the browser)
- Skill for writing landscape memos (optional): https://openlandscape.app/skill/SKILL.md
- Help: https://openlandscape.app/connect

Do every step you can yourself. Ask the user only for what you cannot do, such as approving sign-in in the browser or a click in the app's settings.

## 1. Check where you are
Say which app you are (Claude Code, Codex, Cursor, Gemini CLI, Claude, ChatGPT or another). Check whether OpenLandscape is already set up: a server named "openlandscape" or the URL above. If it is and its tools respond, skip to step 5. Never add it twice.

## 2. Chat apps: give the steps and stop
In Claude (claude.ai, desktop or mobile) or ChatGPT you cannot add connectors from a chat. Give the user these steps and stop:
- Claude: Settings → Connectors → Add custom connector. Name: OpenLandscape. URL: https://openlandscape.app/mcp. Click Add, then Connect, and click Allow in the browser.
- ChatGPT (paid plans, on chatgpt.com): Settings → Apps & Connectors → Advanced → turn on Developer mode, then Create. Name: OpenLandscape. MCP server URL: https://openlandscape.app/mcp. Authentication: OAuth. Create, then click Allow in the browser.

## 3. Add the server
Add it for the user, not inside a project repository:
- Claude Code: `claude mcp add --transport http --scope user openlandscape https://openlandscape.app/mcp`
- Codex: `codex mcp add openlandscape --url https://openlandscape.app/mcp`
- Cursor: in `~/.cursor/mcp.json`, add `"openlandscape": { "url": "https://openlandscape.app/mcp" }` under `mcpServers`.
- Gemini CLI: in `~/.gemini/settings.json`, add `"openlandscape": { "httpUrl": "https://openlandscape.app/mcp" }` under `mcpServers`.
- Any other app: add a remote MCP server (Streamable HTTP) named openlandscape with the URL above.

## 4. Sign in
Start the app's OAuth sign-in: in Claude Code, `/mcp`, choose openlandscape, Authenticate; in Codex, `codex mcp login openlandscape`; in Gemini CLI, `/mcp auth openlandscape`; most other apps open the browser on first use. The user signs in to OpenLandscape (email link or Google, free, no card) and clicks Allow.

If the app cannot sign in with OAuth: send the user to https://openlandscape.app/app#mcp to create a key, and have them put it in the app's secret settings or environment as the header `Authorization: Bearer <key>`. Never ask for the key in chat and never write it into a repository.

If the app supports skills, also save https://openlandscape.app/skill/SKILL.md as `openlandscape/SKILL.md` in the user's skills folder (Claude Code: `~/.claude/skills/`).

## 5. Reload and check
Reload MCP servers the app's own way, or ask the user to restart the app. Then call the `whoami` tool to check the connection. Do not run the other tools during setup.

## 6. Hand off
End with a short reply, 140 words or fewer: who is connected and on which plan (from `whoami`), whether a reload or restart is still needed, and three things to ask:
- "Map every amylin drug in Phase 2 or later, with next milestones."
- "Which oral GLP-1s read out in the next six months?"
- "Who runs the most Phase 3 lung cancer trials in China?"
