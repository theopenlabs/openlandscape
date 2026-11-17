---
name: openlandscape
description: Write a sourced drug-pipeline landscape memo with the OpenLandscape MCP tools. Use when the user asks who is developing drugs for a disease, target or mechanism, which trials read out soon, or who runs trials in an area.
license: MIT
---

# Landscape memo with OpenLandscape

Use the `openlandscape` MCP tools. They read ClinicalTrials.gov and openFDA, with drug aliases merged
(for example mazdutide = LY3305677 = IBI362), and every row carries a source link.

## Steps
1. If the user names a drug or company, call `search` first to get the canonical name.
2. Call `landscape(area, phase_min)`. Use `phase_min: 2` unless the user wants early programs.
   Add `include_finished: true` when the user wants programs whose trials recently ended.
3. For dates, call `catalysts(days_ahead, area)`. For sponsors and sites, call `who_runs_trials(area, phase, country)`.
4. For everything about one drug, call `drug(name)`; for its trials in detail, `trials(drug: ...)`.
5. For what changed recently in what the user follows, call `changes()` (or `changes(area)` for one of their follows).
6. If the `show` tool is there (apps that draw cards): when the answer is done, call `show` once, last, with the main
   result and at most 4 other parts you looked up, with the same tool and arguments. For example
   `show(main: {tool: "landscape", args: {area: "amylin", phase_min: 2}}, also: [{tool: "drug", args: {name: "mazdutide"}}])`.
   It draws one card under your text; the lookups themselves draw nothing. Still write the memo in text.

## Writing the memo
- Open with one plain sentence: how many programs, how many in Phase 3 or later, what is notable.
- Then a table: drug (aliases), company, mechanism, phase, next catalyst, source.
- Keep every source link from the tool output. Never state a phase, date or number without its link.
- End the memo with the "Source: OpenLandscape, …" line from the tool output, as it is.
- Carry the uncertainty through: "?" after an alias or mechanism means unconfirmed; "(news)" means from a press report,
  not the registry. Say so.
- Registry "primary completion" dates are planned dates set by sponsors; results usually come later. Say "planned".
- End with what the data cannot see: trials only on China's registry, finished programs, private financing.
