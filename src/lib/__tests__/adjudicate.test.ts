import { describe, it, expect } from "vitest";
import { adjudicate } from "../adjudicate";

describe("adjudicate — Ringi reads policy + data itself", () => {
  it("BLOCKs an email to an opted-out contact WITHOUT the agent passing opted_out (reads CRM)", async () => {
    const v = await adjudicate({ tool_name: "send_outbound_email", params: { to: "lead@acme.com" } });
    expect(v.action).toBe("BLOCK");
    expect(v.policy_ref.toLowerCase()).toContain("opted out");
  });

  it("APPROVEs an email to a contact not opted out", async () => {
    const v = await adjudicate({ tool_name: "send_outbound_email", params: { to: "warm@beta.com" } });
    expect(v.action).toBe("APPROVE");
  });

  it("BLOCKs a discount over the cap read from the policy document", async () => {
    const v = await adjudicate({ tool_name: "apply_discount", params: { discount_percent: 30 } });
    expect(v.action).toBe("BLOCK");
    expect(v.policy_ref).toContain("20%");
  });
});
