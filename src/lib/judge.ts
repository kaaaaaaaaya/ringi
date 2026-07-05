import Anthropic from "@anthropic-ai/sdk";
import type { ToolCall } from "./charter";
import { JUDGE_MODEL } from "./model";

/**
 * v1 judgment: the LLM judge. Given a natural-language Charter and a tool
 * call an agent is about to make, decide APPROVE / BLOCK and return the
 * Charter line the decision relied on (`policy_ref`).
 *
 * Availability + reproducibility (design ARCHITECT.md §5): when
 * ANTHROPIC_API_KEY is unset we replay a deterministic mock derived from the
 * Charter text, so the judge runs and reproduces identically with zero
 * credentials. The live path pins `temperature: 0`.
 */
export interface Judgment {
  action: "APPROVE" | "BLOCK";
  reason: string;
  /** The exact Charter sentence the judge relied on (traceability). */
  policy_ref: string;
}

const JUDGE_PROMPT = `You are Ringi, a decision gateway for AI business agents.
Given a company policy (Charter, natural language) and a tool call an agent is
about to make, decide whether to APPROVE or BLOCK it.

Respond with a JSON object ONLY, no prose:
{"action":"APPROVE"|"BLOCK","reason":<string>,"policy_ref":<string>}
- policy_ref = the exact sentence from the Charter you relied on (empty string if none).
- Default to APPROVE when no Charter policy blocks the call.

Charter:
---
{charter}
---

Tool call:
{toolcall}`;

export async function judge(toolCall: ToolCall, charterMd: string): Promise<Judgment> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return mockJudge(toolCall, charterMd);
  try {
    return await judgeWithClaude(apiKey, toolCall, charterMd);
  } catch {
    // Fail closed: an unreachable judge must never read as APPROVE.
    return {
      action: "BLOCK",
      reason: "Judge was unreachable; applied fail-closed (BLOCK).",
      policy_ref: "",
    };
  }
}

async function judgeWithClaude(
  apiKey: string,
  toolCall: ToolCall,
  charterMd: string
): Promise<Judgment> {
  const client = new Anthropic({ apiKey });
  const prompt = JUDGE_PROMPT.replace("{charter}", charterMd).replace(
    "{toolcall}",
    JSON.stringify(toolCall)
  );
  const message = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 512,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Judge returned no text content");
  }
  const parsed = JSON.parse(textBlock.text) as Partial<Judgment>;
  if (parsed.action !== "APPROVE" && parsed.action !== "BLOCK") {
    throw new Error(`Judge returned invalid action: ${String(parsed.action)}`);
  }
  return {
    action: parsed.action,
    reason: parsed.reason ?? "",
    policy_ref: parsed.policy_ref ?? "",
  };
}

const TRUTHY = new Set(["true", "1", "yes", "y"]);
function isTruthy(v: number | string | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === "number") return v === 1;
  return TRUTHY.has(v.toLowerCase());
}

// Numeric limits the mock understands, in the order it checks them.
const NUMERIC_LIMITS: { key: string; label: string; re: RegExp }[] = [
  { key: "discount_percent", label: "%", re: /(\d[\d.]*)\s*%/ },
  { key: "amount_usd", label: " USD", re: /(\d[\d,]*)\s*USD/i },
];

/**
 * Deterministic mock judge (the "recorded fixture" replayed with no key).
 * Reads thresholds out of the Charter text so the result tracks the policy
 * rather than a hardcoded constant, while staying byte-identical run to run.
 * Handles the sales fleet's actions: numeric caps (discount %, USD amount) and
 * an opt-out / do-not-contact flag on outbound sends.
 */
export function mockJudge(toolCall: ToolCall, charterMd: string): Judgment {
  const params = toolCall.params;
  const sentences = charterMd
    .split(/(?<=[.!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 1) Opt-out / do-not-contact flag on outbound sends.
  const optOut =
    params["opted_out"] ?? params["do_not_contact"] ?? params["opt_out"];
  if (isTruthy(optOut)) {
    const s = sentences.find(
      (x) =>
        /(opt|unsubscrib|do not contact)/i.test(x) &&
        /(must not|not be sent|blocked|do not)/i.test(x)
    );
    if (s) {
      return {
        action: "BLOCK",
        reason: `Contact has opted out; ${toolCall.tool_name} not permitted.`,
        policy_ref: s,
      };
    }
  }

  // 2) Numeric caps (discount %, USD amount) named in the Charter.
  for (const { key, label, re } of NUMERIC_LIMITS) {
    const val = Number(params[key]);
    if (Number.isNaN(val)) continue;
    for (const sentence of sentences) {
      const m = sentence.match(re);
      if (!m) continue;
      const threshold = Number(m[1].replace(/,/g, ""));
      if (val > threshold) {
        return {
          action: "BLOCK",
          reason: `${toolCall.tool_name}: ${key}=${val}${label.trim()} exceeds the ${threshold}${label} limit.`,
          policy_ref: sentence,
        };
      }
    }
  }

  return {
    action: "APPROVE",
    reason: "No Charter policy blocks this call.",
    policy_ref: "",
  };
}
