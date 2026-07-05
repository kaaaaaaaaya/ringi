import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgres://ringi:ringi@localhost:5432/ringi",
    });
  }
  return pool;
}
