import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { writeReceipt } from "@/lib/receipt";
import { adjudicate } from "@/lib/adjudicate";
import type { ToolCall } from "@/lib/charter";

interface JudgeBody {
  tool_name: string;
  params?: Record<string, number | string>;
}

/**
 * v1 judgment endpoint. LLM judge over the natural-language sales Charter,
 * returning the output contract (ARCHITECT.md §2):
 *   APPROVE -> { action, policy_ref, receipt }
 *   BLOCK   -> { action, reason, policy_ref, stop: true, receipt }
 * Both write a hash-chained Receipt. Reproducible with no ANTHROPIC_API_KEY.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as JudgeBody;
  const toolCall: ToolCall = { tool_name: body.tool_name, params: body.params ?? {} };

  const j = await adjudicate(toolCall);
  const receipt = await writeReceipt(getPool(), {
    action: j.action,
    rule_id: "LLM_JUDGE",
    reason: j.reason,
  });

  if (j.action === "BLOCK") {
    return NextResponse.json({
      action: "BLOCK",
      reason: j.reason,
      policy_ref: j.policy_ref,
      stop: true,
      receipt,
    });
  }
  return NextResponse.json({ action: "APPROVE", policy_ref: j.policy_ref, receipt });
}
