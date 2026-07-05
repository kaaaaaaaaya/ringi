import { judge, type Judgment } from "./judge";
import { loadCharter } from "./charter-source";
import { lookupOptOut } from "./crm";
import type { ToolCall } from "./charter";

/**
 * The full Ringi judgment: read the policy document, read the data the decision
 * depends on, then judge. This is what makes Ringi — not the agent — responsible
 * for reading docs and data (ARCHITECT.md §1, the "Normalize IN" stage).
 */
export async function adjudicate(toolCall: ToolCall): Promise<Judgment> {
  const charter = await loadCharter();
  const enriched = await enrich(toolCall);
  return judge(enriched, charter);
}

/**
 * Ringi fills in facts from data instead of trusting the agent to pass them.
 * For an outbound send, it looks up the recipient's opt-out status itself, so a
 * plain "email lead@acme.com" is blocked without the agent knowing/telling.
 */
async function enrich(toolCall: ToolCall): Promise<ToolCall> {
  if (toolCall.tool_name === "send_outbound_email") {
    const to = String(toolCall.params.to ?? "");
    if (to) {
      const optedOut = await lookupOptOut(to);
      return { ...toolCall, params: { ...toolCall.params, opted_out: optedOut ? "true" : "false" } };
    }
  }
  return toolCall;
}
