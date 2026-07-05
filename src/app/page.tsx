import { getPool } from "@/lib/db";
import { listReceipts, type ReceiptRecord } from "@/lib/receipt";

export const dynamic = "force-dynamic";

export default async function Home() {
  let receipts: ReceiptRecord[] = [];
  let dbError = false;
  try {
    receipts = (await listReceipts(getPool())).slice().reverse();
  } catch {
    dbError = true;
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Ringi — Audit Console</h1>
      <p style={{ color: "#55645d", marginTop: 0 }}>
        Every agent action judged against the Charter, left as a tamper-evident receipt.
      </p>
      {dbError && <p style={{ color: "#d92d3f" }}>Database unavailable.</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #dbe8e1" }}>
            <th style={{ padding: "8px 6px" }}>#</th>
            <th style={{ padding: "8px 6px" }}>Action</th>
            <th style={{ padding: "8px 6px" }}>Reason</th>
            <th style={{ padding: "8px 6px" }}>Hash</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.seq} style={{ borderBottom: "1px solid #eef4f0" }}>
              <td style={{ padding: "8px 6px" }}>{r.seq}</td>
              <td style={{ padding: "8px 6px", fontWeight: 700, color: r.action === "BLOCK" ? "#d92d3f" : "#14875a" }}>
                {r.action}
              </td>
              <td style={{ padding: "8px 6px" }}>{r.reason}</td>
              <td style={{ padding: "8px 6px", fontFamily: "monospace", color: "#55645d" }}>{r.hash.slice(0, 12)}</td>
            </tr>
          ))}
          {receipts.length === 0 && !dbError && (
            <tr>
              <td colSpan={4} style={{ padding: "16px 6px", color: "#55645d" }}>
                No receipts yet. Call POST /api/judge or run an agent.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
