/**
 * Smoke test: acts as a third-party MCP agent. Spawns the Ringi gateway over
 * stdio, lists its tools, then calls create_purchase_order twice (under and
 * over the Charter cap) and a refund. Verifies the BLOCK path returns isError
 * so a real client would halt. Run: `npm run mcp:smoke`.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/gateway.ts"],
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: "smoke-agent", version: "0.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

  async function call(name: string, args: Record<string, unknown>) {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text?: string }[];
    };
    const text = res.content.map((c) => c.text ?? "").join(" ");
    console.log(`\n> ${name}(${JSON.stringify(args)})`);
    console.log(`  isError=${res.isError === true}`);
    console.log(`  ${text.replace(/\n/g, "\n  ")}`);
    return res;
  }

  const approve = await call("apply_discount", { discount_percent: 15, deal_id: "D-100" });
  const block = await call("apply_discount", { discount_percent: 30, deal_id: "D-101" });
  await call("send_outbound_email", { to: "lead@acme.com", subject: "Intro", opted_out: true });
  await call("send_outbound_email", { to: "warm@beta.com", subject: "Following up", opted_out: false });

  await client.close();

  const ok = approve.isError !== true && block.isError === true;
  console.log(`\nSMOKE ${ok ? "PASS" : "FAIL"} (approve ran, block halted)`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exit(1);
});
