# ChatGPT app package

What OpenAI's Plugins page takes for the ChatGPT app (Agent Plugins format, checked 16 Nov 2026 against
developers.openai.com/apps-sdk/deploy/submission): `plugin.json` (listing, 5 + 3 test questions, video link),
`mcp.json` (the /mcp address) and `assets/logo.png`.

Build the ZIP (files at the ZIP's root, not in a folder):

    cd client/chatgpt && rm -f ../openlandscape-chatgpt.zip && zip -r ../openlandscape-chatgpt.zip plugin.json mcp.json assets -x '.*'

Before uploading: pick the category from the dashboard's list if "Research"
is not on it. The reviewer's sign-in (REVIEWER_EMAIL and code) goes in the dashboard's "Review details" form, never in here.
