import type { Judgment } from "./judge";

/**
 * Folds the Charter sentence the judge relied on (`policy_ref`) into the
 * Receipt's `reason`, so the Audit Console shows *which* policy line decided
 * the call without adding a field to the Receipt schema / DB.
 *
 * Used by BOTH receipt-writing paths (src/app/api/judge/route.ts over HTTP and
 * src/mcp/gateway.ts over MCP), so the Notion policy sentence appears on the
 * receipt no matter which surface the agent (or the demo) recorded through.
 * Empty policy_ref -> the reason is returned unchanged (no trailing artifact).
 */
export function receiptReasonFrom(j: Pick<Judgment, "reason" | "policy_ref">): string {
  const ref = j.policy_ref?.trim();
  return ref ? `${j.reason} (policy: ${ref})` : j.reason;
}
