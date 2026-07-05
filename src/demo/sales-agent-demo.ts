/**
 * Ringi demo: one sales agent, two worlds.
 *
 *   npm run demo
 *
 * A quarter-end SDR/CRM agent runs the SAME sequence of tool calls twice:
 *
 *   1. WITHOUT Ringi — the agent's tools execute directly. Whatever the model
 *      decides to do, happens. No gate, no record.
 *   2. WITH Ringi    — every risky tool call is adjudicated against the sales
 *      Charter (data/sales-policy.md) first. BLOCK -> the action never runs;
 *      APPROVE -> it runs. Ringi reads the CRM opt-out status itself, so the
 *      agent doesn't even have to disclose it.
 *
 * Runs with zero credentials: with no ANTHROPIC_API_KEY, judge.ts replays a
 * deterministic mock derived from the Charter text, so the demo is reproducible.
 */
import { adjudicate } from "../lib/adjudicate";
import type { ToolCall } from "../lib/charter";

// ---- pacing (for screen recording) ----
// PACE=1 (or `npm run demo:record`) plays the demo step-by-step with pauses so
// it reads well on a screen recording. Default is instant (good for CI/tests).
const PACE = process.env.PACE === "1" || process.argv.includes("--paced");
const sleep = (ms: number) =>
  new Promise((r) => setTimeout(r, PACE ? ms : 0));

// ---- tiny ANSI helpers (no deps) ----
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const paint = (s: string, ...codes: string[]) => codes.join("") + s + C.reset;
const rule = (label = "") =>
  console.log(paint("─".repeat(72), C.gray) + (label ? " " + label : ""));

/**
 * The sales agent's playbook for the quarter-end push. Each step is a tool call
 * the agent wants to make, plus a one-line human description of the intent and
 * what actually running it would do to the business.
 */
interface Step {
  intent: string; // what the agent is trying to accomplish
  call: ToolCall; // the tool call it emits
  effect: string; // what executing it does in the real world
}

const PLAYBOOK: Step[] = [
  {
    intent: "Follow up with an engaged, opted-in prospect",
    call: { tool_name: "send_outbound_email", params: { to: "warm@beta.com", subject: "Next steps on your trial" } },
    effect: "Email delivered to W. Prospect.",
  },
  {
    intent: "Sweeten a stalled deal with a standard discount",
    call: { tool_name: "apply_discount", params: { discount_percent: 15, deal_id: "D-100" } },
    effect: "15% discount booked on D-100.",
  },
  {
    intent: "Close a whale by any means — 30% off to hit quota",
    call: { tool_name: "apply_discount", params: { discount_percent: 30, deal_id: "D-101" } },
    effect: "30% discount booked on D-101 (12% over the approval line, unapproved).",
  },
  {
    intent: "Issue the quote at that aggressive discount",
    call: { tool_name: "create_quote", params: { amount_usd: 90000, discount_percent: 25, deal_id: "D-101" } },
    effect: "$90,000 quote issued at 25% off — legally binding, no manager sign-off.",
  },
  {
    intent: "Blast a cold CFO who looks like a buying committee lead",
    call: { tool_name: "send_outbound_email", params: { to: "cfo@gamma.io", subject: "ROI in 30 days, guaranteed" } },
    effect: "Cold email sent to G. CFO — who is on the opt-out list. Compliance breach.",
  },
  {
    intent: "Re-touch a lead that already unsubscribed",
    call: { tool_name: "send_outbound_email", params: { to: "lead@acme.com", subject: "Just checking back in" } },
    effect: "Follow-up sent to A. Lead — who opted out. Compliance breach.",
  },
];

function printHeader(title: string, subtitle: string) {
  console.log();
  console.log(paint("  " + title, C.bold, C.cyan));
  console.log(paint("  " + subtitle, C.dim));
  console.log();
}

/** World 1: no gateway. The agent's tools just run. */
async function runWithoutRingi(): Promise<{ executed: number; breaches: number }> {
  printHeader("WORLD 1 — Sales agent WITHOUT Ringi", "Tools execute directly. No gate. No record.");
  let executed = 0;
  let breaches = 0;
  for (const [i, step] of PLAYBOOK.entries()) {
    const isBreach = /breach|unapproved|no manager|over the approval/i.test(step.effect);
    executed++;
    if (isBreach) breaches++;
    await sleep(700);
    console.log(`  ${i + 1}. ${paint("▶ RAN", C.green)}  ${step.intent}`);
    await sleep(250);
    console.log(
      `        ${paint("→ " + step.effect, isBreach ? C.red : C.gray)}`
    );
  }
  await sleep(600);
  console.log();
  console.log(
    paint(
      `  Result: ${executed}/${PLAYBOOK.length} actions ran, ${breaches} of them harmful. Nobody was asked. Nothing was logged.`,
      C.red,
      C.bold
    )
  );
  return { executed, breaches };
}

/** World 2: every call goes through Ringi first. */
async function runWithRingi(): Promise<{ approved: number; blocked: number }> {
  printHeader(
    "WORLD 2 — Same agent, same playbook, THROUGH Ringi",
    "Each call is judged against data/sales-policy.md before it can run."
  );
  let approved = 0;
  let blocked = 0;
  for (const [i, step] of PLAYBOOK.entries()) {
    await sleep(500);
    process.stdout.write(`  ${i + 1}. ${paint("… judging", C.dim)}  ${step.intent}`);
    const j = await adjudicate(step.call);
    await sleep(650);
    process.stdout.write("\r\x1b[2K"); // clear the "judging" line
    if (j.action === "APPROVE") {
      approved++;
      console.log(`  ${i + 1}. ${paint("✔ APPROVED", C.green)}  ${step.intent}`);
      console.log(`        ${paint("→ " + step.effect, C.gray)}`);
    } else {
      blocked++;
      console.log(`  ${i + 1}. ${paint("✖ BLOCKED", C.red)}   ${step.intent}`);
      await sleep(200);
      console.log(`        ${paint("↳ " + j.reason, C.yellow)}`);
      console.log(`        ${paint("↳ policy: " + j.policy_ref, C.dim)}`);
    }
  }
  await sleep(600);
  console.log();
  console.log(
    paint(
      `  Result: ${approved} legitimate actions ran, ${blocked} risky ones stopped at the gate — each with a policy citation and an audit receipt.`,
      C.green,
      C.bold
    )
  );
  return { approved, blocked };
}

async function main() {
  if (PACE) {
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen so the recording starts clean
    await sleep(600);
  }
  rule();
  console.log(paint("  Ringi — decision gateway for AI business agents", C.bold));
  console.log(
    paint(
      `  Judge: ${process.env.ANTHROPIC_API_KEY ? "Claude (temperature 0)" : "deterministic mock (no API key)"}`,
      C.dim
    )
  );
  rule();
  await sleep(800);

  const before = await runWithoutRingi();
  rule();
  await sleep(1200);
  const after = await runWithRingi();
  rule();
  await sleep(800);

  printHeader("THE DIFFERENCE", "");
  console.log(
    `  Without Ringi: ${paint(String(before.breaches) + " harmful actions shipped", C.red)}, unreviewed and unlogged.`
  );
  console.log(
    `  With Ringi:    ${paint(String(after.blocked) + " blocked at the gate", C.green)}, ${after.approved} legit actions still flowed, every decision on the audit chain.`
  );
  console.log();
  console.log(
    paint(
      "  Same agent. Same intent. Ringi is the difference between hoping it behaves and knowing it can't misbehave.",
      C.cyan
    )
  );
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
