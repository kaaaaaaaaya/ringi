/**
 * Notion -> Charter extractor (ARCHITECT.md §3, "Charter preparation").
 *
 * Turns a Notion page's prose into the Charter Markdown that loadCharter()
 * reads, so editing the source policy in Notion changes Ringi's judgment with
 * no code change. This is a BUILD-TIME one-shot: text in (stdin or --in),
 * Charter Markdown out (data/sales-policy.md or --out). Ringi does NOT fetch
 * Notion at runtime — the page is pulled out-of-band (e.g. the Notion MCP) and
 * piped in.
 *
 *   Notion page text --stdin--> [extract] --§3 Charter.md--> data/sales-policy.md
 *                                  │                                │
 *                        key set: Claude (JUDGE_MODEL, temp0)       ▼
 *                        no key : mockExtract (deterministic)   judge.ts reads it
 *
 * Reproducible with no ANTHROPIC_API_KEY (deterministic mockExtract), pinned to
 * the same model as the judge (src/lib/model.ts) so extraction and judgment
 * never drift. Load-bearing contract: the extracted Facts MUST keep numeric
 * thresholds (N%, USD amounts) and opt-out words INLINE, or the deterministic
 * judge (mockJudge) can no longer read them. mockExtract preserves this by
 * quoting the original line verbatim; the live prompt is told to do the same.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { JUDGE_MODEL } from "../lib/model";

export interface ExtractOptions {
  documentId?: string;
  documentTitle?: string;
  /** Fixed for reproducibility; override with RINGI_EXTRACTED_AT if needed. */
  extractedAt?: string;
}

const FALLBACK_EXTRACTED_AT = "2026-07-05T00:00:00Z";

/** Lines carrying an enforceable rule the judge can act on. Keeping these
 * inline (thresholds, opt-out language) is the contract with mockJudge. */
const RULE_LINE =
  /(\d[\d.,]*\s*%)|(\d[\d,]*\s*USD)|\$\s?\d|(opt[-\s]?out|unsubscrib|do not contact|declin|must not)/i;

function firstHeading(input: string): string | undefined {
  const m = input.match(/^#{1,6}\s+(.+)$/m);
  return m?.[1]?.trim();
}

function resolveExtractedAt(opts: ExtractOptions): string {
  return opts.extractedAt ?? process.env.RINGI_EXTRACTED_AT ?? FALLBACK_EXTRACTED_AT;
}

function renderCharter(
  title: string,
  facts: string[],
  opts: ExtractOptions
): string {
  const frontmatter = [
    "---",
    "source: notion",
    `document_id: ${opts.documentId ?? "unknown"}`,
    `document_title: ${title}`,
    `extracted_at: ${resolveExtractedAt(opts)}`,
    "---",
  ].join("\n");
  const body = facts.length
    ? facts.map((f) => `- ${f}`).join("\n")
    : "";
  return `${frontmatter}\n\n# ${title}\n\n## Facts\n\n${body}\n`;
}

/**
 * Deterministic, key-free extraction (the replayed fixture). Scans the page
 * for lines that state an enforceable rule and emits each as a Fact with the
 * original sentence quoted verbatim — which is exactly what keeps the numeric
 * threshold / opt-out word inline for the judge.
 */
export function mockExtract(input: string, opts: ExtractOptions = {}): string {
  const title = opts.documentTitle ?? firstHeading(input) ?? "Sales Policy";
  const facts = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^#{1,6}\s/.test(l)) // drop headings, keep rules
    .filter((l) => RULE_LINE.test(l))
    .map((l) => `${l} (source: "${l}")`);
  return renderCharter(title, facts, opts);
}

const EXTRACT_PROMPT = `You convert a Notion policy page into a Charter for an AI decision gateway.
Output Markdown ONLY, in exactly this shape, no prose before or after:

---
source: notion
document_id: {document_id}
document_title: {title}
extracted_at: {extracted_at}
---

# {title}

## Facts

- <one enforceable rule> (source: "<the original sentence quoted verbatim>")

Rules:
- One Fact per enforceable policy statement. Attach the verbatim original sentence as the (source: "...") quote.
- MUST keep numeric thresholds (e.g. "20%", "10000 USD") and opt-out words (opt out, unsubscribe, do not contact) INLINE in the Fact and its quote — do not paraphrase them away.
- Omit Notion decorations, tables of contents, and navigation. Do not copy the whole page.

Notion page:
{page}`;

async function extractWithClaude(
  apiKey: string,
  input: string,
  opts: ExtractOptions
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const title = opts.documentTitle ?? firstHeading(input) ?? "Sales Policy";
  const prompt = EXTRACT_PROMPT.replace(/{document_id}/g, opts.documentId ?? "unknown")
    .replace(/{title}/g, title)
    .replace(/{extracted_at}/g, resolveExtractedAt(opts))
    .replace("{page}", input);
  const message = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Extractor returned no text content");
  }
  const md = textBlock.text.trim();
  if (countFacts(md) === 0) {
    throw new Error("Extractor produced no Facts");
  }
  return md;
}

/**
 * Read the policy doc and return the Charter. Uses Claude when a key is set;
 * otherwise (or on any failure) falls back to the deterministic mockExtract so
 * ingestion never dies mid-run.
 */
export async function extractCharter(
  input: string,
  opts: ExtractOptions = {}
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return mockExtract(input, opts);
  try {
    return await extractWithClaude(apiKey, input, opts);
  } catch {
    return mockExtract(input, opts);
  }
}

/** Number of Fact bullets in a Charter — used to refuse writing an empty one. */
export function countFacts(md: string): number {
  return (md.match(/^-\s+/gm) ?? []).length;
}

// --- CLI ---------------------------------------------------------------

function parseArgs(argv: string[]): {
  inFile?: string;
  outFile: string;
  documentId?: string;
  documentTitle?: string;
} {
  let inFile: string | undefined;
  let outFile = join(process.cwd(), "data", "sales-policy.md");
  let documentId: string | undefined;
  let documentTitle: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") inFile = argv[++i];
    else if (a === "--out") outFile = argv[++i];
    else if (a === "--doc-id") documentId = argv[++i];
    else if (a === "--title") documentTitle = argv[++i];
  }
  return { inFile, outFile, documentId, documentTitle };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const { inFile, outFile, documentId, documentTitle } = parseArgs(process.argv.slice(2));
  const input = (inFile ? await readFile(inFile, "utf8") : await readStdin()).trim();
  if (!input) {
    process.stderr.write("No input (pass a Notion page via stdin or --in <file>).\n");
    process.exit(1);
  }
  const charter = await extractCharter(input, { documentId, documentTitle });
  // Guard: never overwrite the governing Charter with an empty one.
  if (countFacts(charter) === 0) {
    process.stderr.write(
      "Extraction found no enforceable rules; refusing to write an empty Charter.\n"
    );
    process.exit(1);
  }
  await writeFile(outFile, charter, "utf8");
  process.stderr.write(`Wrote ${countFacts(charter)} Facts to ${outFile}\n`);
}

// Run only as a script, not when imported by tests.
if (process.argv[1] && /notion-to-charter\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`Ingest failed: ${String(err)}\n`);
    process.exit(1);
  });
}
