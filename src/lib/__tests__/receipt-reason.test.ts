import { describe, it, expect } from "vitest";
import { receiptReasonFrom } from "../receipt-reason";

describe("receiptReasonFrom", () => {
  it("folds a non-empty policy_ref into the reason", () => {
    const r = receiptReasonFrom({
      reason: "apply_discount: 30% exceeds the 20% limit.",
      policy_ref: "Discounts over 20% require manager approval.",
    });
    expect(r).toBe(
      "apply_discount: 30% exceeds the 20% limit. (policy: Discounts over 20% require manager approval.)"
    );
  });

  it("leaves the reason unchanged when policy_ref is empty", () => {
    expect(receiptReasonFrom({ reason: "No policy blocks this.", policy_ref: "" })).toBe(
      "No policy blocks this."
    );
  });

  it("treats whitespace-only policy_ref as empty", () => {
    expect(receiptReasonFrom({ reason: "ok", policy_ref: "   " })).toBe("ok");
  });
});
