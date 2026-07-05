/**
 * Sales Charter (natural language). One policy shared by the whole sales agent
 * fleet (SDR, CRM-native, inbound-conversion) — every agent's risky action is
 * judged against it. Derived from the sales-agent's own "やらないこと" rules
 * plus a discount cap. In production this is produced by the Notion -> LLM
 * extraction pipeline (ARCHITECT.md §3); inlined here so the judge and MCP
 * gateway run with zero setup.
 */
export const DEMO_CHARTER_MD = `# Sales Outbound & Deal Policy

Discounts over 20% require manager approval and are blocked by default until approved.
Quotes with a discount over 20% must not be issued without approval.
Outbound emails to contacts who have opted out must not be sent.
Do not use false claims, fabricated case studies, or unverified numbers in outbound messages.
Do not continue follow-up after a contact has explicitly declined.`;
