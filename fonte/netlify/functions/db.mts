import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.NETLIFY_DB_URL;
    if (!connectionString) throw new Error("Netlify Database não está provisionado ou NETLIFY_DB_URL não foi definido");
    pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
  }
  return pool;
}
