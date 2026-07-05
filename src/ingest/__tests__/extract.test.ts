import { describe, it, expect } from "vitest";
import { mockExtract, countFacts } from "../notion-to-charter";
import { mockJudge } from "../../lib/judge";
import type { ToolCall } from "../../lib/charter";

// A messy-ish "Notion page": headings + prose rules the extractor must find.
const NOTION_PAGE = `# Sales Outbound & Deal Policy

## Discounts
Discounts over 20% require manager approval and are blocked by default until approved.
Team lunches are on Fridays.

## Outbound
Outbound emails to contacts who have opted out must not be sent.
Remember to be friendly.`;

describe("mockExtract — §3 format", () => {
  it("emits frontmatter, a title, and a Facts section", () => {
    const md = mockExtract(NOTION_PAGE);
    expect(md).toContain("source: notion");
    expect(md).toContain("document_title: Sales Outbound & Deal Policy");
    expect(md).toContain("## Facts");
  });

  it("keeps the numeric threshold and opt-out language inline (the judge contract)", () => {
    const md = mockExtract(NOTION_PAGE);
    expect(md).toContain("20%");
    expect(md.toLowerCase()).toContain("opted out");
  });

  it("drops prose lines that state no enforceable rule", () => {
    const md = mockExtract(NOTION_PAGE);
    expect(md).not.toContain("Team lunches");
    expect(md).not.toContain("be friendly");
  });

  it("attaches the original sentence as a verbatim (source: ...) quote", () => {
    const md = mockExtract(NOTION_PAGE);
    expect(md).toContain(
      '(source: "Discounts over 20% require manager approval and are blocked by default until approved.")'
    );
  });

  it("is deterministic: same input yields identical output", () => {
    expect(mockExtract(NOTION_PAGE)).toBe(mockExtract(NOTION_PAGE));
  });

  it("produces no Facts for prose with no rules (guards the empty-Charter case)", () => {
    const md = mockExtract("# Notes\nWe had a nice offsite.\nCoffee is in the kitchen.");
    expect(countFacts(md)).toBe(0);
  });

  it("produces no Facts for empty input", () => {
    expect(countFacts(mockExtract(""))).toBe(0);
  });
});

// The load-bearing contract: whatever mockExtract emits must still be readable
// by the deterministic judge, so a Notion edit flips the verdict with no key.
describe("contract — mockExtract output feeds mockJudge", () => {
  const charter = mockExtract(NOTION_PAGE);

  it("BLOCKs a discount over the extracted 20% cap", () => {
    const call: ToolCall = { tool_name: "apply_discount", params: { discount_percent: 30 } };
    const j = mockJudge(call, charter);
    expect(j.action).toBe("BLOCK");
    expect(j.policy_ref).toContain("20%");
  });

  it("APPROVEs a discount at or under the extracted cap", () => {
    const call: ToolCall = { tool_name: "apply_discount", params: { discount_percent: 15 } };
    expect(mockJudge(call, charter).action).toBe("APPROVE");
  });

  it("BLOCKs an outbound email to an opted-out contact", () => {
    const call: ToolCall = {
      tool_name: "send_outbound_email",
      params: { to: "lead@acme.com", opted_out: "true" },
    };
    const j = mockJudge(call, charter);
    expect(j.action).toBe("BLOCK");
    expect(j.policy_ref.toLowerCase()).toContain("opted out");
  });

  it("flips APPROVE->BLOCK when the Notion policy tightens the cap (the demo cut)", () => {
    const loose = mockExtract("# P\nDiscounts over 40% require approval.");
    const tight = mockExtract("# P\nDiscounts over 10% require approval.");
    const call: ToolCall = { tool_name: "apply_discount", params: { discount_percent: 25 } };
    expect(mockJudge(call, loose).action).toBe("APPROVE");
    expect(mockJudge(call, tight).action).toBe("BLOCK");
  });
});
