# Ringi — Team-Shared MVP Document ver1

## 1. Product Definition (the version you'd use to explain it to a new member in one minute)

**Ringi = the decision-making API (and its protocol) for AI business agents.**

When an agent runs, Ringi's infrastructure hooks into the communication on its own — acting as a proxy (a middleman for the traffic) or an event listener — automatically runs parallel processing, and renders a Verdict. On top of that, every judgment is left behind as a tamper-proof receipt.

The moment a third-party agent takes an action against a company's existing systems (Salesforce, Slack, procurement SaaS, etc.), Ringi's infrastructure hooks into the communication on its own — acting as a proxy (a middleman for the traffic) or an event listener — automatically runs parallel processing, and renders a Verdict.

- Tagline: **"Agents don't need more tools.**
- **They need judgment."**
- We are not a company that makes AI decide. We are a company that **turns judgment into a protocol** (the three primitives: Charter / Verdict / Receipt).
- Wedge: buy-side (procurement approval / ringi). Vision: **The reason why you Can FIRE Approving Managers.** (By 2028, $15T of B2B spend will flow through agents.)
- Three components: the company's decision criteria → structuring of data such as Charter and dashboards → a rule-based decision axis (the protocol) / Verdict API (MCP) / Accreditation Log

## 2. Confirmed Decisions

| # | Decision | Key rationale |
| :---- | :---- | :---- |
| D1 | The product name is **Ringi**. Ringi is not "abolished" but "reinvented as an API" | Consistency between the name and the claim |
| D2 | Positioning is **interface + protocol**. Spec published, reference implementation = repo, a state where **AI agents are already deployed** | The platform players (Microsoft AGT / assistants) provide easy-to-use Agents; we provide a decision-making foundation that Agents can easily read |
| D3 | We don't build an LP. The "looks" are handled by the **Audit Console** | What gets judged is a 90-second video. An LP doesn't add points |
| D4 | We **integrate via API** with Notion and the like (to fetch internal information). Inject static exports into the charter context | |

## 3. Scope

**Must**

- M1: Build each of the Ringi tools
- M2: The Audit Console outputs receipts with their result, reason, and log

**Won't (not this time)**

- Authentication / multi-tenancy / LP

## 4. Architecture and the Three Schemas

[Third-party / executing AI agent]
       │
       │ ⚡️ Just presses the buy button / tries to send a sales email
       ▼
  [ 🚦 Ringi auto-intercepts (detects on its own) right in front of the existing system ]
       │
       ├───────────────────────┐
       ▼ Parallel input [Step 1]   ▼ Parallel input [Step 2]
┌───────────────────────┐     ┌───────────────────────┐
│ From Salesforce/BI,   │     │ From IR / minutes /   │
│ structure and extract │     │ policy, extract the   │
│ data such as          │     │ (Charter)             │
│ dashboards            │     │                       │
└──────────┬────────────┘     └──────────┬────────────┘
           │                             │
           └──────────────┬──────────────┘
                          │
                          ▼ (auto-merges everything and feeds it to the AI at once)
┌─────────────────────────────────────────────────────┐
│ [Step 3] Protocol (AI batch-adjudication / gatekeeper │
│ layer)                                                │
│                                                       │
│  - Analyze the action the agent "tried to take."      │
│  - Judge with a prompt that includes structured data  │
│    + Charter.                                          │
│  - Output: APPROVE (let it through) / BLOCK            │
│    (rewrite / cut off)                                 │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼ 💾
               [tamper-proof Receipts.jsonl] ──▶ Audit Console (M3)
