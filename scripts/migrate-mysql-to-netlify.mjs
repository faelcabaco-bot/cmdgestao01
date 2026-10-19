import mysql from "mysql2/promise";
import pg from "pg";

const { Pool } = pg;
const sourceConfig = {
  host: process.env.MYSQL_HOST,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
};
const targetUrl = process.env.NETLIFY_DB_URL;
const required = [...Object.entries(sourceConfig).map(([name, value]) => [name, value]), ["NETLIFY_DB_URL", targetUrl]];
const missing = required.filter(([, value]) => !value).map(([name]) => name);
if (missing.length) throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(", ")}`);

const tables = [
  "tenants", "users", "password_resets", "profiles", "user_roles", "brands", "categories", "suppliers", "customers",
  "products", "stock_batches", "cash_registers", "cash_movements", "sales", "sale_items", "sale_payments",
  "customer_credit_payments", "stock_movements", "settings", "audit_logs", "cancel_authorization",
];
const booleanColumns = new Set(["profiles.active", "products.active", "settings.block_no_stock"]);
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

const source = await mysql.createConnection({ ...sourceConfig, dateStrings: true, supportBigNumbers: true });
const target = new Pool({ connectionString: targetUrl, max: 2 });
const client = await target.connect();

try {
  for (const table of tables.filter((name) => !["settings", "tenants"].includes(name))) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quote(table)}`);
    if (result.rows[0].count > 0) throw new Error(`O banco de destino já contém dados em ${table}; a importação foi cancelada.`);
  }
  const existingTenants = await client.query("SELECT id,name FROM tenants");
  const legacyTenant = existingTenants.rows.filter((tenant) => tenant.id === "00000000-0000-4000-8000-000000000001");
  if (existingTenants.rowCount !== legacyTenant.length) throw new Error("O banco de destino já contém empresas; a importação foi cancelada.");
  const existingSettings = (await client.query("SELECT store_name,receipt_footer FROM settings WHERE id=1")).rows[0];
  if (existingSettings && (existingSettings.store_name !== "CMD Cosméticos" || existingSettings.receipt_footer !== "Obrigado pela preferência!")) {
    throw new Error("As configurações do banco Netlify já foram alteradas; a importação foi cancelada para preservá-las.");
  }

  await client.query("BEGIN");
  const counts = [];
  for (const table of tables) {
    const [rows] = await source.query(`SELECT * FROM \`${table}\``);
    for (const sourceRow of rows) {
      const row = { ...sourceRow };
      for (const [key, value] of Object.entries(row)) {
        if (booleanColumns.has(`${table}.${key}`)) row[key] = Boolean(Number(value));
        if (table === "audit_logs" && key === "details" && typeof value === "string") row[key] = JSON.parse(value);
      }
      const columns = Object.keys(row);
      const values = Object.values(row);
      const conflict = table === "settings"
        ? ` ON CONFLICT (tenant_id,id) DO UPDATE SET ${columns.filter((key) => !["tenant_id", "id"].includes(key)).map((key) => `${quote(key)}=EXCLUDED.${quote(key)}`).join(",")}`
        : table === "tenants"
          ? ` ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`
        : "";
      await client.query(
        `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(",")})${conflict}`,
        values,
      );
    }
    counts.push(`${table}: ${rows.length}`);
  }
  await client.query("SELECT setval(pg_get_serial_sequence('sales','number'), GREATEST(COALESCE(MAX(number),1),1), COUNT(*)>0) FROM sales");
  await client.query("COMMIT");
  console.log(`Migração concluída. ${counts.join("; ")}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await target.end();
  await source.end();
}
