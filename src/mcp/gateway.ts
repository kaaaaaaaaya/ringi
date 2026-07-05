/**
 * Ringi MCP Gateway (stdio).
 *
 * One judgment layer shared by the whole sales agent fleet (SDR, CRM-native,
 * inbound-conversion). Each agent is pointed at this MCP server; every risky
 * action it takes is intercepted by the LLM judge against the sales Charter
 * before it runs (ARCHITECT.md §2).
 *
 *   Agent --MCP tools/call--> [Ringi Gateway] --judge--> APPROVE -> run action
 *                                                         BLOCK   -> refuse (isError)
 *
 * Output contract:
 *   APPROVE -> action executes; result + receipt hash returned.
 *   BLOCK   -> action does NOT run; isError result tells the agent to stop.
 * Both write a Receipt to the audit chain (best-effort; a DB-less run still
 * judges). Reproducible with no ANTHROPIC_API_KEY (deterministic mock judge).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { judge } from "../lib/judge";
import { getPool } from "../lib/db";
import { writeReceipt } from "../lib/receipt";
import { DEMO_CHARTER_MD } from "../lib/demo-charter-md";
import type { ToolCall } from "../lib/charter";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Run one tool call through the judge, forward to `execute` only on APPROVE. */
async function guard(toolCall: ToolCall, execute: () => string): Promise<ToolResult> {
  const j = await judge(toolCall, DEMO_CHARTER_MD);

  // Audit trail: write a Receipt for both verdicts. Best-effort so the gateway
  // still judges when no DB is up.
  let receiptHash = "(not persisted)";
  try {
    const r = await writeReceipt(getPool(), {
      action: j.action,
      rule_id: "LLM_JUDGE",
      reason: j.reason,
    });
    receiptHash = r.hash.slice(0, 12);
  } catch {
    // DB down — keep going; the verdict is unaffected.
  }

  if (j.action === "BLOCK") {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `BLOCKED by Ringi. Do not proceed.\n` +
            `Reason: ${j.reason}\n` +
            `Policy: ${j.policy_ref}\n` +
            `Receipt: ${receiptHash}`,
        },
      ],
    };
  }
  return {
    content: [
      { type: "text", text: `APPROVED by Ringi.\n${execute()}\nReceipt: ${receiptHash}` },
    ],
  };
}

const server = new McpServer({ name: "ringi-gateway", version: "0.1.0" });

// --- CRM-native / inbound: pricing actions (discount cap) ---
server.registerTool(
  "apply_discount",
  {
    description:
      "Apply a discount to a deal. Adjudicated by Ringi against the sales Charter before it is applied.",
    inputSchema: {
      discount_percent: z.number().describe("Discount percent, e.g. 30 for 30%"),
      deal_id: z.string().optional().describe("Deal / opportunity id"),
    },
  },
  async ({ discount_percent, deal_id }) =>
    guard(
      { tool_name: "apply_discount", params: { discount_percent, deal_id: deal_id ?? "" } },
      () => `Discount ${discount_percent}% applied${deal_id ? ` to deal ${deal_id}` : ""}.`
    )
);

server.registerTool(
  "create_quote",
  {
    description:
      "Issue a customer quote. Adjudicated by Ringi against the sales Charter before it is issued.",
    inputSchema: {
      amount_usd: z.number().describe("Quote amount in USD"),
      discount_percent: z.number().optional().describe("Discount percent on the quote"),
      deal_id: z.string().optional(),
    },
  },
  async ({ amount_usd, discount_percent, deal_id }) =>
    guard(
      {
        tool_name: "create_quote",
        params: {
          amount_usd,
          discount_percent: discount_percent ?? 0,
          deal_id: deal_id ?? "",
        },
      },
      () =>
        `Quote issued: $${amount_usd}${discount_percent ? ` at ${discount_percent}% off` : ""}${deal_id ? ` for deal ${deal_id}` : ""}.`
    )
);

// --- SDR / inbound: outbound send (opt-out + false-claims guard) ---
server.registerTool(
  "send_outbound_email",
  {
    description:
      "Send an outbound email to a contact. Adjudicated by Ringi against the sales Charter before it is sent.",
    inputSchema: {
      to: z.string().describe("Recipient email/contact"),
      subject: z.string().optional(),
      body: z.string().optional().describe("Email body (judged for false claims)"),
      opted_out: z
        .boolean()
        .optional()
        .describe("True if the contact has opted out / unsubscribed"),
    },
  },
  async ({ to, subject, body, opted_out }) =>
    guard(
      {
        tool_name: "send_outbound_email",
        params: {
          to,
          subject: subject ?? "",
          body: body ?? "",
          opted_out: opted_out ? "true" : "false",
        },
      },
      () => `Email sent to ${to}${subject ? ` — "${subject}"` : ""}.`
    )
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio: do not write to stdout (it is the protocol channel). Log to stderr.
  process.stderr.write("Ringi MCP gateway ready (stdio).\n");
}

main().catch((err) => {
  process.stderr.write(`Ringi gateway failed: ${String(err)}\n`);
  process.exit(1);
});
