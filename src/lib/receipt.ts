import { createHash } from "crypto";
import type { Pool } from "pg";
import type { Verdict } from "./charter";

export interface ReceiptRecord {
  seq: number;
  ts: string;
  rule_id: string;
  action: "APPROVE" | "BLOCK";
  reason: string;
  prev_hash: string;
  hash: string;
}

const GENESIS_HASH = "0".repeat(64);

function computeHash(input: {
  seq: number;
  ts: string;
  rule_id: string;
  action: string;
  reason: string;
  prev_hash: string;
}): string {
  const payload = JSON.stringify(input);
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Writes a Receipt as the next link in the hash chain.
 *
 * Concurrency: multiple agent tool-calls can land at the same instant, and
 * each needs the latest prev_hash before it can compute its own hash. This
 * function takes an explicit row lock (`receipt_chain_lock`) inside a
 * transaction to serialize writers — the second writer blocks until the
 * first commits, so no two receipts can ever be built from the same
 * prev_hash. See design doc "Architecture Notes" for the race this fixes.
 */
export async function writeReceipt(
  pool: Pool,
  verdict: Verdict
): Promise<ReceiptRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM receipt_chain_lock WHERE id = 1 FOR UPDATE");

    const prevResult = await client.query<{ hash: string }>(
      "SELECT hash FROM receipts ORDER BY seq DESC LIMIT 1"
    );
    const prevHash = prevResult.rows[0]?.hash ?? GENESIS_HASH;

    const seqResult = await client.query<{ next_seq: string }>(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM receipts"
    );
    const seq = Number(seqResult.rows[0].next_seq);
    const ts = new Date().toISOString();

    const hash = computeHash({
      seq,
      ts,
      rule_id: verdict.rule_id,
      action: verdict.action,
      reason: verdict.reason,
      prev_hash: prevHash,
    });

    await client.query(
      `INSERT INTO receipts (seq, ts, rule_id, action, reason, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [seq, ts, verdict.rule_id, verdict.action, verdict.reason, prevHash, hash]
    );

    await client.query("COMMIT");

    return { seq, ts, rule_id: verdict.rule_id, action: verdict.action, reason: verdict.reason, prev_hash: prevHash, hash };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listReceipts(pool: Pool): Promise<ReceiptRecord[]> {
  // node-pg returns BIGINT columns as strings by default; cast to int4 so
  // callers get a JS number (seq stays well under int4 range for MVP scale).
  const result = await pool.query<ReceiptRecord>(
    "SELECT seq::int AS seq, ts, rule_id, action, reason, prev_hash, hash FROM receipts ORDER BY seq ASC"
  );
  return result.rows;
}

/**
 * Detects tampering by recomputing each receipt's hash from its stored
 * fields and comparing against the persisted hash, and by verifying each
 * record's prev_hash matches the previous record's hash. This only catches
 * external/application-layer tampering — a DB administrator with write
 * access could recompute the entire chain consistently. See design doc
 * Success Criteria M2 "limitation" note.
 */
export function detectTamper(receipts: ReceiptRecord[]): { seq: number; reason: string }[] {
  const problems: { seq: number; reason: string }[] = [];
  let expectedPrevHash = GENESIS_HASH;

  for (const r of receipts) {
    const recomputed = computeHash({
      seq: r.seq,
      ts: r.ts,
      rule_id: r.rule_id,
      action: r.action,
      reason: r.reason,
      prev_hash: r.prev_hash,
    });
    if (recomputed !== r.hash) {
      problems.push({ seq: r.seq, reason: "hash mismatch (record may have been tampered with)" });
    }
    if (r.prev_hash !== expectedPrevHash) {
      problems.push({ seq: r.seq, reason: "prev_hash mismatch (chain fork or deletion suspected)" });
    }
    expectedPrevHash = r.hash;
  }
  return problems;
}
