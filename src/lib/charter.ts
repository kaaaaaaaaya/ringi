/**
 * Core v1 types. Ringi's judgment is done by the LLM judge (see judge.ts)
 * over a natural-language Charter, so there is deliberately no deterministic
 * CharterRule / evaluateCharter here (that was rrng's v0 design).
 */
export interface ToolCall {
  tool_name: string;
  params: Record<string, number | string>;
}

/** What the Receipt is written from. `rule_id` is a coarse tag of what decided
 * the call (e.g. "LLM_JUDGE", "FAIL_CLOSED"); the specific Charter line lives
 * in the Judgment's `policy_ref`. */
export interface Verdict {
  action: "APPROVE" | "BLOCK";
  rule_id: string;
  reason: string;
}
