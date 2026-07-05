import { readFile } from "fs/promises";
import { join } from "path";

interface Contact {
  email: string;
  name?: string;
  opted_out?: boolean;
}

/**
 * Ringi reads the CRM/contact data itself to decide facts the agent should not
 * be trusted to self-report — here, whether a contact has opted out. Backed by
 * data/contacts.json (stands in for a real CRM). Missing / unknown -> not
 * opted out.
 */
export async function lookupOptOut(email: string): Promise<boolean> {
  try {
    const raw = await readFile(join(process.cwd(), "data", "contacts.json"), "utf8");
    const contacts = JSON.parse(raw) as Contact[];
    const hit = contacts.find((c) => c.email.toLowerCase() === email.toLowerCase());
    return hit?.opted_out === true;
  } catch {
    return false;
  }
}
