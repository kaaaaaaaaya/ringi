import { describe, it, expect } from "vitest";
import { mockJudge, judge } from "../judge";
import type { ToolCall } from "../charter";

const CHARTER = `# Sales Outbound & Deal Policy

Discounts over 20% require manager approval and are blocked by default until approved.
Quotes with a discount over 20% must not be issued without approval.
Outbound emails to contacts who have opted out must not be sent.
Do not continue follow-up after a contact has explicitly declined.`;

describe("mockJudge — discount cap", () => {
  it("BLOCKs a discount over the Charter cap and cites the line", () => {
    const call: ToolCall = { tool_name: "apply_discount", params: { discount_percent: 30 } };
    const j = mockJudge(call, CHARTER);
    expect(j.action).toBe("BLOCK");
    expect(j.policy_ref).toContain("20%");
    expect(j.reason).toContain("30");
  });

  it("APPROVEs a discount at or under the cap", () => {
    const call: ToolCall = { tool_name: "apply_discount", params: { discount_percent: 15 } };
    expect(mockJudge(call, CHARTER).action).toBe("APPROVE");
  });

  it("BLOCKs a quote whose discount exceeds the cap", () => {
    const call: ToolCall = {
      tool_name: "create_quote",
      params: { amount_usd: 50000, discount_percent: 25 },
    };
    expect(mockJudge(call, CHARTER).action).toBe("BLOCK");
  });
});

describe("mockJudge — outbound opt-out", () => {
  it("BLOCKs an email to an opted-out contact", () => {
    const call: ToolCall = {
      tool_name: "send_outbound_email",
      params: { to: "a@b.com", opted_out: "true" },
    };
    const j = mockJudge(call, CHARTER);
    expect(j.action).toBe("BLOCK");
    expect(j.policy_ref.toLowerCase()).toContain("opted out");
  });

  it("APPROVEs an email to a contact who has not opted out", () => {
    const call: ToolCall = {
      tool_name: "send_outbound_email",
      params: { to: "a@b.com", opted_out: "false" },
    };
    expect(mockJudge(call, CHARTER).action).toBe("APPROVE");
  });
});

describe("mockJudge — general", () => {
  it("APPROVEs an action with no governing policy", () => {
    const call: ToolCall = { tool_name: "enrich_contact", params: { domain: "acme.com" } };
    expect(mockJudge(call, CHARTER).action).toBe("APPROVE");
  });

  it("is reproducible: same input yields identical output", () => {
    const call: ToolCall = { tool_name: "apply_discount", params: { discount_percent: 30 } };
    expect(mockJudge(call, CHARTER)).toEqual(mockJudge(call, CHARTER));
  });
});

describe("judge — falls back to mock when ANTHROPIC_API_KEY is unset", () => {
  it("uses the deterministic mock with no key", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const call: ToolCall = { tool_name: "apply_discount", params: { discount_percent: 30 } };
      expect((await judge(call, CHARTER)).action).toBe("BLOCK");
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
