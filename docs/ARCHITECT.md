# Ringi Architecture

This document describes Ringi's technical architecture.

---

## 1. Overview

[AI Agent execution]
      │
      ▼
┌─────────────────────────────────────────────┐
│  Ringi (our infrastructure)                   │
│                                               │
│  ① Charter evaluation                         │
│     tool-call + Charter(rules) → Verdict      │
│                                               │
│  ② Charter preparation                        │
│     Notion / dashboards → MD/CSV → Charter    │
└─────────────────────────────────────────────┘
      │
      ▼ output = Verdict + Receipt
[Agent receives it]

---

## 2. Implemented: Verdict API (the judgment core)

### Components

| Component | File | Role |
|---|---|---|
| Charter evaluation | src/lib/charter.ts | Matches a tool-call against the Charter rule set and decides APPROVE/BLOCK deterministically (no LLM used) |
| Verdict API | src/lib/verdict-api.ts | Runs Charter evaluation, fails closed (BLOCK) on error, generates a Receipt, and returns it |
| Receipt | src/lib/receipt.ts | A self-contained judgment record. Returned directly to the Agent, and also stored in the DB (see below) |
| Agent hook | src/lib/mcp-hook.ts | Wraps an arbitrary tool-execution function and obtains a Verdict before it runs |
| HTTP endpoint | src/app/api/verdict/route.ts | POST /api/verdict |

### Data flow

POST /api/verdict { tool_name, params }
        │
        ▼
evaluateCharter(toolCall, rules)
        │
   ┌────┴────┐
   ▼         ▼
 no match     match
 (Block)     (Approve)
   │         │
   └────┬────┘
        ▼
createReceipt(verdict)
        │
        ├─────────────────────────────┐
        ▼                             ▼
{ verdict, receipt,             Save to DB (async, fire-and-forget)
  receipt_markdown, latency_ms }      │
        │                             ▼
        ▼                       Humans review / audit later
[Agent receives directly]        (accumulated as know-how)
(does not go through the DB)

### Design decision: the Receipt is also stored in the DB (the response to the Agent does not go through the DB)

**Decision:** The Receipt is not disposable — it is also persisted to Postgres. However, the path that returns it to the Agent as the response to POST /api/verdict is a direct return that does not go through the DB write; the DB save is an incidental write.

**Rationale:** We originally took the stance that "the Receipt only needs to be handed to the agent and can be disposable," and eliminated the DB dependency. But we reconsidered and judged that the value of "humans can review it later" and "it accumulates as know-how" takes priority. We keep the DB out of the Agent's response path so that latency or failures in the DB write do not block the Verdict return to the Agent (this is where availability is secured).

- Response to the Agent: createReceipt(verdict) → direct response (does not go through the DB, low latency as before)
- Accumulation for humans: the same Receipt is also written to the DB (async; a failed write does not affect the response to the Agent)
- Nothing is lost anymore: the ability to "list and audit past judgment logs later" (the Audit-Console-style use) comes back
- Whether to adopt a hash chain (tamper detection via chaining against past Receipts) is a separate question (undecided in this document — whether to run with a single hash only or return to a chain is a future discussion)

**Receipt field composition (confirmed):**

| Field | Needed? | Rationale |
|---|---|---|
| ts | Needed | When the judgment was made |
| rule_id | Needed | Which rule was applied |
| action | Needed | APPROVE / BLOCK |
| reason | Needed | Material for the agent to decide its next action |
| hash | Needed | The minimum backing for self-tamper detection (no chain, but tampering with a single Receipt can be detected) |
| `id` (UUID) | **Reconsider** | Unnecessary under the "disposable" premise, but once stored in the DB there may be a need for a key so humans can reference individual Receipts (still unnecessary if the DB's auto-increment PK can substitute) |

**Return format (confirmed):** JSON as the primary form + Markdown alongside.

json
{
  "verdict": { "action": "BLOCK", "rule_id": "R001", "reason": "..." },
  "receipt": { "ts": "...", "rule_id": "R001", "action": "BLOCK", "reason": "...", "hash": "..." },
  "receipt_markdown": "## Receipt\n\n- **Timestamp:** ...\n- **Action:** BLOCK\n...",
  "latency_ms": 4.2
}

Rationale: the calling code (`interceptToolCall`, etc.) needs to branch on `action === "BLOCK"` from the JSON field, so JSON is primary. At the same time, when the agent itself passes this judgment result into its own context (log / conversation history), Markdown reads more naturally as prose — so we return both.

---

## 3. Design confirmed only (not implemented): Charter preparation pipeline

Organized based on the user's hand-drawn diagram (2026-07-05). **Not implemented; recorded as design.**

### Pipeline overview

① Discovery (full crawl)
   Connect to the Notion / dashboard APIs and enumerate all pages and all data sources

② Extract (structuring)
   Convert each page and each data source individually into an AI-friendly intermediate format
     - Notion page → Markdown (1 page = 1 MD file)
     - Dashboard API → JSON → CSV

③ Consolidate
   Merge the intermediate formats of multiple pages and multiple data sources into one

④ MD conversion (final output)
   Turn the consolidated result into Markdown usable for Charter evaluation

### Notion extraction MD format (confirmed)

1 page = 1 MD file.

markdown
---
source: notion
document_id: <notion-page-id>
document_title: <page title>
extracted_at: <ISO8601>
---

# <page title>

## Facts

- <structured fact/rule 1> (source: "<the original sentence quoted verbatim>")
- <structured fact/rule 2> (source: "<the original sentence quoted verbatim>")

**Include (absolutely required):**
- Source info in the frontmatter (`document_id` / document_title / `extracted_at`) — so a mis-extraction can be traced back to the original text
- Attach the original sentence as a quote to each Fact (traceability)

**Do not include (judged useless to the agent):**
- Notion decorations (emoji callouts, coloring, etc.)
- Navigation elements such as table of contents and breadcrumbs (the agent doesn't navigate screens, so they're unnecessary)
- A verbatim copy of the full page text (a waste of tokens; the structured Facts alone are sufficient)

### Dashboard extraction CSV format (confirmed)

csv
metric_name,value,unit,as_of_date
quarterly_spend_usd,482000,USD,2026-07-01

Rationale: for numeric-heavy data, CSV is more token-efficient for the LLM than JSON, and it reads directly as a table.

### Connection to downstream judgment (undecided)

How the MD after Consolidate connects to the implemented Charter evaluation (`evaluateCharter`) is not yet designed. Candidates:
- Pass the MD to an LLM and convert it into Charter JSON (`rule_id` / condition / action / `reason_template`) — close to the `charter-extraction.ts` in the old design
- Include the MD directly in the LLM's context and have the LLM judge each time together with the tool-call (this shifts from deterministic evaluation to LLM evaluation, so it requires discussion)

---

## 4. Extension: enterprise-facing detailed fields for APPROVE Receipts (design only)

From the perspective of the sales rep and the enterprise (buyer), with the goal that "a single APPROVE Receipt alone can fulfill accountability," we define the seven questions that must be answered. **The current implementation (`src/lib/receipt.ts`) stays with the minimal field set (`ts`/`rule_id`/`action`/`reason`/`hash`); this is designed as an extension layer for the enterprise-facing view.**

| Question | Field | Display example |
|---|---|---|
| What was approved | action_detail | MeetCoach AI annual contract $7,400 |
| On whose behalf | agent_id + requester_id | procurement-agent-03 / requester: T. Sato |
| When | timestamp | 2026-07-05 14:02:11 JST |
| Under which rule it passed | rule_id + charter_excerpt_ref | pilot.vendor_cap.v2 (within the $10,000 cap) |
| Which version of the criteria | charter_version | v2.0 |
| Impact on budget | budget_snapshot | 9.9% used of the $75,000 pilot budget |
| Until when this approval is valid | expires_at + scope | Valid within 15 minutes, for this order only |

**Relationship to the current minimal Receipt (open items):**
- timestamp is the same as the current ts. `rule_id` is also the same as the current field (with `charter_excerpt_ref` newly linked)
- action_detail / agent_id / requester_id / charter_version / budget_snapshot / expires_at / scope do not exist in the current `Verdict`/`Receipt` types. Adding them requires giving the ToolCall requester info, introducing version management to the Charter, an external data source to reference the remaining budget, and so on — dependencies that cannot be completed within the Verdict API alone
- expires_at / `scope` (what this approval applies to and until when it is valid) introduce a new concept (validity period / scope of application of an approval) into the current stateless judgment model of "one Verdict per one tool-call." This is a domain the current Charter evaluation logic (`evaluateCharter`) does not handle, and it requires a design extension

### BLOCK version: the asymmetry between the response to the Agent and the DB save

**Decision:** For a BLOCK, the response to the Agent is minimal (`action: BLOCK` + only the reason it should be stopped). Meanwhile, the details are saved to the DB (just as with APPROVE). **The lightness of the response to the Agent and the richness of the audit information left in the DB are separate axes** — that is the design.

- **Response to the Agent (unchanged):** { action: "BLOCK", reason: "..." } — the Agent just needs to receive this and stop executing the tool. It does not need to parse the details and make any judgment
- **Save to the DB (new):** leave behind what was blocked, on whose behalf, when, and under which rule it was blocked, so humans can audit it later. `expires_at` / `scope` (validity period / scope of an approval) are APPROVE-specific concepts, so they are not included in the BLOCK version

| Question | Field | Display example (BLOCK) |
|---|---|---|
| What was blocked | action_detail | MeetCoach AI annual contract $12,000 (requested) |
| On whose behalf | agent_id + requester_id | procurement-agent-03 / requester: T. Sato |
| When | timestamp | 2026-07-05 14:02:11 JST |
| Under which rule it was blocked | rule_id + charter_excerpt_ref | pilot.vendor_cap.v2 (exceeds the $10,000 cap) |
| Which version of the criteria | charter_version | v2.0 |
| Impact on budget | budget_snapshot | 9.9% used of the $75,000 pilot budget (this item not consumed) |

- These detailed fields are not required on every Receipt; they are positioned as an extension intended for **the scenario where an enterprise's approver / auditor reads them at DB-save time, for both APPROVE and BLOCK**. This is separate from the content of the response the Agent receives directly
