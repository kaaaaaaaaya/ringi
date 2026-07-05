import { readFile } from "fs/promises";
import { join } from "path";
import { DEMO_CHARTER_MD } from "./demo-charter-md";

/**
 * Ringi reads the company's policy document and returns it as the Charter.
 * Source: the local policy document (data/sales-policy.md), which stands in for
 * the Notion / doc pipeline (ARCHITECT.md §3) — editing that file changes the
 * judgment with no code change. Falls back to the bundled constant if the file
 * is unavailable, so it always runs.
 */
export async function loadCharter(): Promise<string> {
  try {
    const text = await readFile(join(process.cwd(), "data", "sales-policy.md"), "utf8");
    return text.trim() || DEMO_CHARTER_MD;
  } catch {
    return DEMO_CHARTER_MD;
  }
}
