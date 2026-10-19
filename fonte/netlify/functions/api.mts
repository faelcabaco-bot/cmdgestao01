import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { getPool } from "./db.mjs";

class ApiError extends Error {}
type Actor = { id: string; email: string; tenant_id: string; role: "admin" | "gerente" | "vendedor" };
type Relation = { table: string; kind: "one" | "many"; key: string };

const TABLE_COLUMNS: Record<string, string[]> = {
  audit_logs: ["id", "tenant_id", "user_id", "action", "entity", "entity_id", "details", "created_at"],
  brands: ["id", "tenant_id", "name"],
  cash_movements: ["id", "tenant_id", "register_id", "user_id", "type", "amount", "reason", "created_at"],
  cash_registers: ["id", "tenant_id", "user_id", "status", "opening_amount", "expected_amount", "counted_amount", "notes", "opened_at", "closed_at"],
  cancel_authorization: ["id", "tenant_id", "password_hash", "failed_attempts", "locked_until", "updated_by", "updated_at"],
  categories: ["id", "tenant_id", "name"],
  customer_credit_payments: ["id", "tenant_id", "sale_id", "customer_id", "register_id", "user_id", "amount", "method", "notes", "created_at"],
  customers: ["id", "tenant_id", "name", "cpf", "phone", "email", "address", "birthday", "notes", "points", "created_at"],
  products: ["id", "tenant_id", "name", "variant", "description", "sku", "barcode", "brand_id", "category_id", "supplier_id", "unit", "cost_price", "sale_price", "stock", "min_stock", "image_url", "active", "created_at", "updated_at"],
  profiles: ["id", "tenant_id", "full_name", "email", "active", "created_at"],
  sale_items: ["id", "tenant_id", "sale_id", "product_id", "name", "quantity", "unit_price", "unit_cost", "discount", "total"],
  sale_payments: ["id", "tenant_id", "sale_id", "method", "amount", "installments"],
  sales: ["id", "tenant_id", "number", "register_id", "user_id", "customer_id", "status", "subtotal", "discount", "total", "change_amount", "cancel_reason", "canceled_at", "canceled_by", "created_at"],
  settings: ["id", "tenant_id", "store_name", "cnpj", "address", "phone", "receipt_footer", "block_no_stock", "default_min_stock", "points_per_real"],
  stock_batches: ["id", "tenant_id", "product_id", "lot", "expires_at", "quantity", "created_at"],
  stock_movements: ["id", "tenant_id", "product_id", "type", "quantity", "reason", "invoice_number", "supplier_id", "unit_cost", "sale_id", "user_id", "created_at"],
  suppliers: ["id", "tenant_id", "name", "cnpj", "contact", "email", "phone", "payment_terms_days", "created_at"],
  user_roles: ["id", "tenant_id", "user_id", "role"],
};

const PERMISSIONS: Record<string, [string, string, string, string]> = {
  audit_logs: ["manager", "no", "no", "no"],
  brands: ["staff", "manager", "manager", "manager"],
  cash_movements: ["staff", "staff", "no", "no"],
  cash_registers: ["staff", "staff", "no", "no"],
  categories: ["staff", "manager", "manager", "manager"],
  customer_credit_payments: ["staff", "no", "no", "no"],
  customers: ["staff", "staff", "staff", "manager"],
  products: ["staff", "manager", "manager", "manager"],
  profiles: ["staff", "no", "admin", "no"],
  sale_items: ["staff", "no", "no", "no"],
  sale_payments: ["staff", "no", "no", "no"],
  sales: ["staff", "no", "no", "no"],
  settings: ["staff", "no", "manager", "no"],
  stock_batches: ["staff", "staff", "manager", "no"],
  stock_movements: ["staff", "staff", "no", "no"],
  suppliers: ["staff", "manager", "manager", "manager"],
  user_roles: ["staff", "admin", "admin", "admin"],
};

const RELATIONS: Record<string, Record<string, Relation>> = {
  customer_credit_payments: { customers: { table: "customers", kind: "one", key: "customer_id" } },
  products: {
    brands: { table: "brands", kind: "one", key: "brand_id" },
    categories: { table: "categories", kind: "one", key: "category_id" },
  },
  sale_items: { products: { table: "products", kind: "one", key: "product_id" } },
  sales: {
    sale_items: { table: "sale_items", kind: "many", key: "sale_id" },
    sale_payments: { table: "sale_payments", kind: "many", key: "sale_id" },
    customers: { table: "customers", kind: "one", key: "customer_id" },
  },
  stock_batches: { products: { table: "products", kind: "one", key: "product_id" } },
  stock_movements: { products: { table: "products", kind: "one", key: "product_id" } },
};

const TABLE_ACCESS: Record<string, [string, string, string, string]> = {
  select: ["read", "insert", "update", "delete"],
};
const OPERATIONS: string[] = TABLE_ACCESS.select;
const r2 = (value: unknown) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const uuid = () => crypto.randomUUID();
const fail = (message: string): never => { throw new ApiError(message); };
const normalizeBcryptHash = (hash: string) => hash.replace(/^\$2y\$/, "$2b$");

function json(data: unknown, error: string | null = null, cookie?: string): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify({ data, error }), { status: 200, headers });
}

function sessionCookie(uid: string, secure: boolean): string {
  const secret = process.env.NETLIFY_SESSION_SECRET;
  if (!secret || secret.length < 32) fail("Configure NETLIFY_SESSION_SECRET nas variáveis da Netlify");
  const payload = `${uid}.${Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `cmdsess=${payload}.${signature}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function clearSessionCookie(secure: boolean): string {
  return `cmdsess=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function sessionUid(request: Request): string | null {
  const secret = process.env.NETLIFY_SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("cmdsess="))?.slice(8);
  if (!raw) return null;
  const [uid, expires, signature] = raw.split(".");
  if (!uid || !expires || !signature || Number(expires) < Date.now() / 1000) return null;
  const payload = `${uid}.${expires}`;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes) ? uid : null;
}

async function actorFor(request: Request): Promise<Actor | null> {
  const uid = sessionUid(request);
  if (!uid) return null;
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; email: string; active: boolean; role: Actor["role"] }>(
    `SELECT u.id, u.email, u.tenant_id, COALESCE(p.active, TRUE) AS active,
      CASE WHEN BOOL_OR(ur.role = 'admin') THEN 'admin'
           WHEN BOOL_OR(ur.role = 'gerente') THEN 'gerente' ELSE 'vendedor' END AS role
     FROM users u LEFT JOIN profiles p ON p.id = u.id
     LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id WHERE u.id = $1
     GROUP BY u.id, p.active`, [uid],
  );
  if (!rows[0]?.active) return null;
  return rows[0] ? { id: rows[0].id, email: rows[0].email, tenant_id: rows[0].tenant_id, role: rows[0].role } : null;
}

function requireUser(actor: Actor | null): Actor {
  if (!actor) fail("Sessão expirada. Entre novamente.");
  return actor;
}

function requireManager(actor: Actor | null): Actor {
  const user = requireUser(actor);
  if (user.role === "vendedor") fail("Sem permissão para esta ação");
  return user;
}

function requireAdmin(actor: Actor | null): Actor {
  const user = requireUser(actor);
  if (user.role !== "admin") fail("Somente administradores podem fazer isso");
  return user;
}

async function auth(action: string, body: Record<string, unknown>, request: Request): Promise<{ data: unknown; cookie?: string }> {
  const pool = getPool();
  const secure = new URL(request.url).protocol === "https:";
  if (action === "me") {
    const user = await actorFor(request);
    if (!user) return { data: { user: null } };
    const tenant = await pool.query<{ name: string }>("SELECT name FROM tenants WHERE id=$1", [user.tenant_id]);
    return { data: { user: { id: user.id, email: user.email, tenant_id: user.tenant_id, tenant_name: tenant.rows[0]?.name ?? "" } } };
  }
  if (action === "login") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const { rows } = await pool.query<{ id: string; tenant_id: string; password_hash: string; active: boolean }>(
      "SELECT u.id, u.tenant_id, u.password_hash, COALESCE(p.active, TRUE) AS active FROM users u LEFT JOIN profiles p ON p.id = u.id AND p.tenant_id=u.tenant_id WHERE u.email = $1", [email],
    );
    const user = rows[0];
    const hash = user ? normalizeBcryptHash(user.password_hash) : "";
    if (!user || !await bcrypt.compare(password, hash)) fail("E-mail ou senha inválidos");
    if (!user.active) fail("Usuário desativado");
    return { data: { user: { id: user.id, email } }, cookie: sessionCookie(user.id, secure) };
  }
  if (action === "signup") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const tenantName = String(body.company_name ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("E-mail inválido");
    if (password.length < 6) fail("A senha precisa ter pelo menos 6 caracteres");
    if (!tenantName || tenantName.length > 190) fail("Informe o nome da loja (até 190 caracteres)");
    if (!process.env.NETLIFY_SESSION_SECRET || process.env.NETLIFY_SESSION_SECRET.length < 32) {
      fail("Configure NETLIFY_SESSION_SECRET nas variáveis da Netlify");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if ((await client.query("SELECT 1 FROM users WHERE email = $1", [email])).rowCount) fail("Este e-mail já está cadastrado");
      const id = uuid();
      const tenantId = uuid();
      await client.query("INSERT INTO tenants (id,name) VALUES ($1,$2)", [tenantId, tenantName]);
      await client.query("INSERT INTO settings (tenant_id,id,store_name,receipt_footer) VALUES ($1,1,$2,'Obrigado pela preferência!')", [tenantId, tenantName]);
      await client.query("INSERT INTO users (id,tenant_id,email,password_hash) VALUES ($1,$2,$3,$4)", [id, tenantId, email, await bcrypt.hash(password, 12)]);
      await client.query("INSERT INTO profiles (id,tenant_id,full_name,email,active) VALUES ($1,$2,$3,$4,TRUE)", [id, tenantId, fullName || email.split("@")[0], email]);
      await client.query("INSERT INTO user_roles (id,tenant_id,user_id,role) VALUES ($1,$2,$3,'admin')", [uuid(), tenantId, id]);
      await client.query("COMMIT");
      return { data: { user: { id, email } } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  if (action === "create_user") {
    const actor = requireAdmin(await actorFor(request));
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "vendedor");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("E-mail inválido");
    if (password.length < 8) fail("A senha inicial precisa ter pelo menos 8 caracteres");
    if (!fullName) fail("Informe o nome do funcionário");
    if (!["gerente", "vendedor"].includes(role)) fail("Perfil inválido para novo funcionário");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if ((await client.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount) fail("Este e-mail já está cadastrado");
      const id = uuid();
      await client.query("INSERT INTO users (id,tenant_id,email,password_hash) VALUES ($1,$2,$3,$4)", [id, actor.tenant_id, email, await bcrypt.hash(password, 12)]);
      await client.query("INSERT INTO profiles (id,tenant_id,full_name,email,active) VALUES ($1,$2,$3,$4,TRUE)", [id, actor.tenant_id, fullName, email]);
      await client.query("INSERT INTO user_roles (id,tenant_id,user_id,role) VALUES ($1,$2,$3,$4)", [uuid(), actor.tenant_id, id, role]);
      await client.query("COMMIT");
      return { data: { user: { id, email } } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  if (action === "logout") return { data: null, cookie: clearSessionCookie(secure) };
  if (action === "reset_request") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const apiKey = process.env.RESEND_API_KEY;
    const mailFrom = process.env.MAIL_FROM;
    const appUrl = process.env.APP_URL;
    if (!apiKey || !mailFrom || !appUrl) fail("Configure RESEND_API_KEY, MAIL_FROM e APP_URL na Netlify");
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email]);
    if (rows[0]) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await pool.query("DELETE FROM password_resets WHERE user_id=$1 OR expires_at < NOW()", [rows[0].id]);
      await pool.query("INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')", [tokenHash, rows[0].id]);
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: mailFrom, to: [email], subject: "Redefinir senha - CMD Gestão", text: `Para criar uma nova senha, acesse:\n\n${appUrl.replace(/\/$/, "")}/reset-password?token=${token}\n\nO link expira em 1 hora.` }),
      });
      if (!sent.ok) fail("Não foi possível enviar o e-mail de recuperação");
    }
    return { data: true };
  }
  if (action === "update_password") {
    const password = String(body.password ?? "");
    if (password.length < 6) fail("A senha precisa ter pelo menos 6 caracteres");
    const token = String(body.token ?? "");
    let uid: string;
    if (token) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const { rows } = await pool.query<{ user_id: string }>("SELECT user_id FROM password_resets WHERE token_hash=$1 AND expires_at>NOW()", [tokenHash]);
      if (!rows[0]) fail("Link inválido ou expirado. Peça um novo.");
      uid = rows[0].user_id;
      await pool.query("DELETE FROM password_resets WHERE user_id=$1", [uid]);
    } else uid = requireUser(await actorFor(request)).id;
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [await bcrypt.hash(password, 12), uid]);
    return { data: true, cookie: sessionCookie(uid, secure) };
  }
  fail("Rota de autenticação inválida");
}

function splitTop(value: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) { result.push(current.trim()); current = ""; }
    else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function parseSelect(value: string): { columns: string[]; relations: Record<string, string> } {
  const columns: string[] = [];
  const relations: Record<string, string> = {};
  for (const part of splitTop(value || "*")) {
    const match = part.match(/^(\w+)(?:!\w+)?\((.*)\)$/s);
    if (match) relations[match[1]] = match[2];
    else columns.push(part);
  }
  return { columns: columns.length ? columns : ["*"], relations };
}

function project(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  if (columns.includes("*")) return row;
  return Object.fromEntries(columns.filter((column) => Object.hasOwn(row, column)).map((column) => [column, row[column]]));
}

async function embed(client: PoolClient, table: string, rows: Record<string, unknown>[], relations: Record<string, string>, tenantId: string): Promise<Record<string, unknown>[]> {
  for (const [name, selection] of Object.entries(relations)) {
    const relation = RELATIONS[table]?.[name];
    if (!relation) fail(`Relação inválida: ${name}`);
    const nested = parseSelect(selection);
    if (relation.kind === "one") {
      const ids = [...new Set(rows.map((row) => row[relation.key]).filter((value): value is string => typeof value === "string"))];
      const map = new Map<string, Record<string, unknown>>();
      if (ids.length) {
        const related = (await client.query(`SELECT * FROM ${quote(relation.table)} WHERE tenant_id=$1 AND id = ANY($2::text[])`, [tenantId, ids])).rows as Record<string, unknown>[];
        const embedded = await embed(client, relation.table, related, nested.relations, tenantId);
        embedded.forEach((row) => map.set(String(row.id), project(row, [...nested.columns, ...Object.keys(nested.relations)])));
      }
      rows.forEach((row) => { row[name] = map.get(String(row[relation.key])) ?? null; });
    } else {
      const ids = rows.map((row) => String(row.id));
      const map = new Map<string, Record<string, unknown>[]>();
      if (ids.length) {
        const order = TABLE_COLUMNS[relation.table].includes("created_at") ? " ORDER BY created_at ASC" : "";
        const related = (await client.query(`SELECT * FROM ${quote(relation.table)} WHERE tenant_id=$1 AND ${quote(relation.key)} = ANY($2::text[])${order}`, [tenantId, ids])).rows as Record<string, unknown>[];
        const embedded = await embed(client, relation.table, related, nested.relations, tenantId);
        embedded.forEach((row) => {
          const key = String(row[relation.key]);
          map.set(key, [...(map.get(key) ?? []), project(row, [...nested.columns, ...Object.keys(nested.relations)])]);
        });
      }
      rows.forEach((row) => { row[name] = map.get(String(row.id)) ?? []; });
    }
  }
  return rows;
}

function quote(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) fail("Identificador inválido");
  return `"${identifier}"`;
}

function addFilters(table: string, filters: Record<string, unknown>[], params: unknown[]): string[] {
  const clauses: string[] = [];
  const columns = TABLE_COLUMNS[table];
  for (const filter of filters) {
    const col = String(filter.col ?? "");
    if (!columns.includes(col)) fail(`Coluna inválida: ${col}`);
    let op = String(filter.op ?? "eq");
    const negated = op === "not";
    if (negated) op = String(filter.sub ?? "eq");
    const value = filter.val;
    const column = quote(col);
    if (op === "is") {
      if (value === null) clauses.push(`${column} IS ${negated ? "NOT " : ""}NULL`);
      else {
        params.push(value);
        clauses.push(`${column} IS ${negated ? "NOT " : ""}$${params.length}`);
      }
      continue;
    }
    if (op === "in") {
      const values = Array.isArray(value) ? value : [];
      if (!values.length) clauses.push(negated ? "TRUE" : "FALSE");
      else { params.push(values); clauses.push(`${column} ${negated ? "<> ALL" : "= ANY"}($${params.length})`); }
      continue;
    }
    const operators: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    let sqlOp = operators[op];
    if (!sqlOp) fail("Filtro inválido");
    if (negated) sqlOp = ({ "=": "<>", "<>": "=", ">": "<=", ">=": "<", "<": ">=", "<=": ">" } as Record<string, string>)[sqlOp];
    if (value === null) clauses.push(`${column} IS ${sqlOp === "=" ? "" : "NOT "}NULL`);
    else { params.push(value); clauses.push(`${column} ${sqlOp} $${params.length}`); }
  }
  return clauses;
}

function permission(actor: Actor, table: string, op: string): void {
  const index = OPERATIONS.indexOf(op);
  const level = PERMISSIONS[table]?.[index];
  if (!level || level === "no") fail("Operação não permitida");
  if (level === "manager") requireManager(actor);
  else if (level === "admin") requireAdmin(actor);
}

async function insertRow(client: PoolClient, table: string, input: Record<string, unknown>, actor: Actor): Promise<Record<string, unknown>> {
  const columns = TABLE_COLUMNS[table];
  let row = { ...input };
  if (columns.includes("tenant_id")) row.tenant_id = actor.tenant_id;
  const tenantReferences: Record<string, Record<string, string>> = {
    products: { brand_id: "brands", category_id: "categories", supplier_id: "suppliers" },
    stock_batches: { product_id: "products" },
    cash_movements: { register_id: "cash_registers" },
    user_roles: { user_id: "users" },
  };
  for (const [column, target] of Object.entries(tenantReferences[table] ?? {})) {
    if (row[column] != null && !(await client.query(`SELECT 1 FROM ${quote(target)} WHERE tenant_id=$1 AND id=$2`, [actor.tenant_id, row[column]])).rowCount) {
      fail("Referência inválida para esta empresa");
    }
  }
  if (table === "cash_registers") {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor.id]);
    if ((await client.query("SELECT 1 FROM cash_registers WHERE tenant_id=$1 AND user_id=$2 AND status='aberto'", [actor.tenant_id, actor.id])).rowCount) fail("Você já tem um caixa aberto");
    row = { tenant_id: actor.tenant_id, user_id: actor.id, status: "aberto", opening_amount: Math.max(0, r2(row.opening_amount)) };
  }
  if (table === "cash_movements") {
    const { rows } = await client.query("SELECT * FROM cash_registers WHERE tenant_id=$1 AND id=$2 AND status='aberto'", [actor.tenant_id, row.register_id]);
    if (!rows[0] || (rows[0].user_id !== actor.id && actor.role === "vendedor")) fail("Caixa não encontrado ou fechado");
    if (!["sangria", "suprimento"].includes(String(row.type))) fail("Tipo inválido");
    if (r2(row.amount) <= 0) fail("Valor inválido");
    row.user_id = actor.id;
  }
  if (table === "stock_movements") {
    row.user_id = actor.id;
    delete row.sale_id;
    if (["venda", "estorno"].includes(String(row.type))) fail("Tipo inválido");
    if (!(await client.query("SELECT 1 FROM products WHERE tenant_id=$1 AND id=$2", [actor.tenant_id, row.product_id])).rowCount) fail("Produto não encontrado");
    if (!Number(row.quantity)) fail("Quantidade inválida");
  }
  if (table === "user_roles" && !["admin", "gerente", "vendedor"].includes(String(row.role))) fail("Perfil inválido");

  const data = Object.fromEntries(Object.entries(row).filter(([key, value]) => columns.includes(key) && value !== undefined));
  if (columns.includes("id") && !data.id) data.id = uuid();
  const names = Object.keys(data);
  if (!names.length) fail("Nenhum dado para inserir");
  const values = names.map((name) => data[name]);
  const sql = `INSERT INTO ${quote(table)} (${names.map(quote).join(",")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`;
  const inserted = (await client.query(sql, values)).rows[0] as Record<string, unknown>;
  if (table === "stock_movements") {
    await client.query("UPDATE products SET stock=stock+$1, updated_at=NOW() WHERE tenant_id=$2 AND id=$3", [data.quantity, actor.tenant_id, data.product_id]);
    if (data.type === "entrada" && data.unit_cost) await client.query("UPDATE products SET cost_price=$1 WHERE tenant_id=$2 AND id=$3", [data.unit_cost, actor.tenant_id, data.product_id]);
  }
  return inserted;
}

async function queryTable(body: Record<string, unknown>, actor: Actor): Promise<unknown> {
  const table = String(body.table ?? "");
  const op = String(body.op ?? "select");
  if (!TABLE_COLUMNS[table] || !PERMISSIONS[table]) fail("Tabela inválida");
  permission(actor, table, op);
  const pool = getPool();
  const client = await pool.connect();
  try {
    if (op === "insert") {
      await client.query("BEGIN");
      try {
        const input = body.values;
        const values = Array.isArray(input) ? input : input ? [input] : [];
        const inserted: Record<string, unknown>[] = [];
        for (const row of values) inserted.push(await insertRow(client, table, row as Record<string, unknown>, actor));
        await client.query("COMMIT");
        if (body.single && inserted.length !== 1) fail("Registro não encontrado");
        return body.single ? inserted[0] : inserted;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    const params: unknown[] = [];
    const clauses = addFilters(table, (body.filters as Record<string, unknown>[] | undefined) ?? [], params);
    params.push(actor.tenant_id);
    clauses.push(`"tenant_id"=$${params.length}`);
    if (actor.role === "vendedor" && ["cash_registers", "sales", "cash_movements", "customer_credit_payments"].includes(table)) {
      params.push(actor.id);
      clauses.push(`"user_id" = $${params.length}`);
    }
    if (table === "profiles" && op === "update" && actor.role !== "admin") fail("Sem permissão");
    if (op === "update") {
      if (!clauses.length) fail("Atualização sem filtro");
      const rawChanges = (body.values ?? {}) as Record<string, unknown>;
      for (const [column, target] of Object.entries({ ...(table === "products" ? { brand_id: "brands", category_id: "categories", supplier_id: "suppliers" } : {}), ...(table === "stock_batches" ? { product_id: "products" } : {}), ...(table === "cash_movements" ? { register_id: "cash_registers" } : {}), ...(table === "user_roles" ? { user_id: "users" } : {}) })) {
        if (rawChanges[column] != null && !(await client.query(`SELECT 1 FROM ${quote(target)} WHERE tenant_id=$1 AND id=$2`, [actor.tenant_id, rawChanges[column]])).rowCount) fail("Referência inválida para esta empresa");
      }
      const changes = Object.entries(rawChanges).filter(([key, value]) => TABLE_COLUMNS[table].includes(key) && !["id", "tenant_id", "number"].includes(key) && value !== undefined);
      if (!changes.length) return [];
      const set = changes.map(([key], index) => `${quote(key)}=$${index + 1}`);
      const values = changes.map(([, value]) => value);
      const where = clauses.map((clause) => clause.replace(/\$(\d+)/g, (_, number) => `$${Number(number) + values.length}`));
      await client.query(`UPDATE ${quote(table)} SET ${set.join(", ")} WHERE ${where.join(" AND ")}`, [...values, ...params]);
      return [];
    }
    if (op === "delete") {
      if (!clauses.length) fail("Exclusão sem filtro");
      await client.query(`DELETE FROM ${quote(table)} WHERE ${clauses.join(" AND ")}`, params);
      return [];
    }
    if (op !== "select") fail("Operação inválida");
    const orderBy = ((body.order as { col?: string; asc?: boolean }[] | undefined) ?? []).map((order) => {
      const col = String(order.col ?? "");
      if (!TABLE_COLUMNS[table].includes(col)) fail("Ordenação inválida");
      return `${quote(col)} ${order.asc === false ? "DESC" : "ASC"}`;
    });
    const single = body.single === "single" || body.single === "maybe";
    const requestedLimit = Number(body.limit) || (single ? 2 : 0);
    const limit = requestedLimit > 0 ? ` LIMIT ${Math.max(1, Math.min(requestedLimit, 5000))}` : "";
    const sql = `SELECT * FROM ${quote(table)}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}${orderBy.length ? ` ORDER BY ${orderBy.join(", ")}` : ""}${limit}`;
    const rows = (await client.query(sql, params)).rows as Record<string, unknown>[];
    const selection = parseSelect(String(body.select ?? "*"));
    await embed(client, table, rows, selection.relations, actor.tenant_id);
    const projected = rows.map((row) => project(row, [...selection.columns, ...Object.keys(selection.relations)]));
    if (body.single === "single") {
      if (projected.length !== 1) fail("Registro não encontrado");
      return projected[0];
    }
    if (body.single === "maybe") {
      if (projected.length > 1) fail("Mais de um registro encontrado");
      return projected[0] ?? null;
    }
    return projected;
  } finally { client.release(); }
}

async function finalizeSale(payload: Record<string, unknown>, actor: Actor): Promise<string> {
  const items = (payload.items ?? []) as Record<string, unknown>[];
  const payments = (payload.payments ?? []) as Record<string, unknown>[];
  if (!items.length) fail("Carrinho vazio");
  if (!payments.length) fail("Informe o pagamento");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const register = (await client.query("SELECT * FROM cash_registers WHERE tenant_id=$1 AND user_id=$2 AND status='aberto' FOR UPDATE", [actor.tenant_id, actor.id])).rows[0];
    if (!register) fail("Abra o caixa antes de vender");
    const settings = (await client.query("SELECT * FROM settings WHERE tenant_id=$1 AND id=1", [actor.tenant_id])).rows[0] ?? { block_no_stock: true, points_per_real: 1 };
    let subtotal = 0;
    const lines: { product: Record<string, unknown>; qty: number; price: number; discount: number; total: number }[] = [];
    for (const item of items) {
      const product = (await client.query("SELECT * FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [actor.tenant_id, item.product_id])).rows[0] as Record<string, unknown> | undefined;
      if (!product) fail("Produto não encontrado");
      const qty = Number(item.quantity);
      if (qty <= 0) fail("Quantidade inválida");
      if (settings.block_no_stock && Number(product.stock) < qty) fail(`Estoque insuficiente: ${product.name}${product.variant ? ` ${product.variant}` : ""}`);
      const price = r2(item.unit_price ?? product.sale_price);
      const discount = Math.max(0, r2(item.discount ?? 0));
      const total = r2(qty * price - discount);
      subtotal += total;
      lines.push({ product, qty, price, discount, total });
    }
    subtotal = r2(subtotal);
    const discount = Math.min(subtotal, Math.max(0, r2(payload.discount ?? 0)));
    const total = r2(subtotal - discount);
    let paid = 0; let cash = 0;
    for (const payment of payments) {
      if (!["dinheiro", "pix", "debito", "credito", "fiado"].includes(String(payment.method))) fail("Forma de pagamento inválida");
      paid += r2(payment.amount);
      if (payment.method === "dinheiro") cash += r2(payment.amount);
      if (payment.method === "fiado" && !payload.customer_id) fail("Venda fiado exige cliente");
    }
    paid = r2(paid);
    if (paid + 0.001 < total) fail("Pagamento menor que o total");
    const change = r2(Math.min(Math.max(0, paid - total), cash));
    if (paid - total > cash + 0.001) fail("Troco só pode sair do dinheiro");
    const customerId = payload.customer_id ? String(payload.customer_id) : null;
    if (customerId && !(await client.query("SELECT id FROM customers WHERE tenant_id=$1 AND id=$2", [actor.tenant_id, customerId])).rowCount) fail("Cliente não encontrado");
    const saleId = uuid();
    await client.query("INSERT INTO sales (id,tenant_id,register_id,user_id,customer_id,status,subtotal,discount,total,change_amount) VALUES ($1,$2,$3,$4,$5,'concluida',$6,$7,$8,$9)", [saleId, actor.tenant_id, register.id, actor.id, customerId, subtotal, discount, total, change]);
    for (const line of lines) {
      const product = line.product;
      const name = `${product.name}${product.variant ? ` ${product.variant}` : ""}`;
      await client.query("INSERT INTO sale_items (id,tenant_id,sale_id,product_id,name,quantity,unit_price,unit_cost,discount,total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [uuid(), actor.tenant_id, saleId, product.id, name, line.qty, line.price, product.cost_price, line.discount, line.total]);
      await client.query("UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3", [line.qty, actor.tenant_id, product.id]);
      await client.query("INSERT INTO stock_movements (id,tenant_id,product_id,type,quantity,reason,sale_id,user_id) VALUES ($1,$2,$3,'venda',$4,'Venda',$5,$6)", [uuid(), actor.tenant_id, product.id, -line.qty, saleId, actor.id]);
      let left = line.qty;
      const batches = await client.query("SELECT id,quantity FROM stock_batches WHERE tenant_id=$1 AND product_id=$2 AND quantity>0 ORDER BY expires_at ASC NULLS LAST, created_at ASC FOR UPDATE", [actor.tenant_id, product.id]);
      for (const batch of batches.rows) {
        if (left <= 0) break;
        const take = Math.min(left, Number(batch.quantity));
        await client.query("UPDATE stock_batches SET quantity=quantity-$1 WHERE tenant_id=$2 AND id=$3", [take, actor.tenant_id, batch.id]);
        left -= take;
      }
    }
    for (const payment of payments) await client.query("INSERT INTO sale_payments (id,tenant_id,sale_id,method,amount,installments) VALUES ($1,$2,$3,$4,$5,$6)", [uuid(), actor.tenant_id, saleId, payment.method, r2(payment.amount), Math.max(1, Math.trunc(Number(payment.installments ?? 1)))]);
    if (customerId) await client.query("UPDATE customers SET points=points+FLOOR($1*COALESCE((SELECT points_per_real FROM settings WHERE tenant_id=$2 AND id=1),1)) WHERE tenant_id=$2 AND id=$3", [total, actor.tenant_id, customerId]);
    await client.query("COMMIT");
    return saleId;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function cancelSale(id: string, reason: string, actor: Actor): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const sale = (await client.query("SELECT * FROM sales WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [actor.tenant_id, id])).rows[0];
    if (!sale) fail("Venda não encontrada");
    if (sale.status !== "concluida") fail("Venda já cancelada");
    await client.query("UPDATE sales SET status='cancelada',cancel_reason=$1,canceled_at=NOW(),canceled_by=$2 WHERE tenant_id=$3 AND id=$4", [reason || null, actor.id, actor.tenant_id, id]);
    const items = await client.query("SELECT * FROM sale_items WHERE tenant_id=$1 AND sale_id=$2", [actor.tenant_id, id]);
    for (const item of items.rows) {
      await client.query("UPDATE products SET stock=stock+$1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3", [item.quantity, actor.tenant_id, item.product_id]);
      await client.query("INSERT INTO stock_movements (id,tenant_id,product_id,type,quantity,reason,sale_id,user_id) VALUES ($1,$2,$3,'estorno',$4,$5,$6,$7)", [uuid(), actor.tenant_id, item.product_id, item.quantity, `Cancelamento da venda #${sale.number}`, id, actor.id]);
    }
    if (sale.customer_id) await client.query("UPDATE customers SET points=GREATEST(0,points-FLOOR($1*COALESCE((SELECT points_per_real FROM settings WHERE tenant_id=$2 AND id=1),1))) WHERE tenant_id=$2 AND id=$3", [sale.total, actor.tenant_id, sale.customer_id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function receiveCreditPayment(saleId: string, amount: number, method: string, notes: string, actor: Actor): Promise<string> {
  amount = r2(amount);
  if (amount <= 0) fail("Informe um valor maior que zero");
  if (!["dinheiro", "pix", "debito", "credito"].includes(method)) fail("Forma de recebimento inválida");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const register = (await client.query("SELECT * FROM cash_registers WHERE tenant_id=$1 AND user_id=$2 AND status='aberto' FOR UPDATE", [actor.tenant_id, actor.id])).rows[0];
    if (!register) fail("Abra o caixa antes de receber um pagamento");
    const sale = (await client.query("SELECT * FROM sales WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [actor.tenant_id, saleId])).rows[0];
    if (!sale || sale.status !== "concluida") fail("Venda não encontrada ou cancelada");
    if (!sale.customer_id) fail("Venda sem cliente vinculado");
    const debt = Number((await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM sale_payments WHERE tenant_id=$1 AND sale_id=$2 AND method='fiado'", [actor.tenant_id, saleId])).rows[0].total);
    const received = Number((await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM customer_credit_payments WHERE tenant_id=$1 AND sale_id=$2", [actor.tenant_id, saleId])).rows[0].total);
    const balance = r2(debt - received);
    if (balance <= 0) fail("Esta venda não tem saldo em aberto");
    if (amount - balance > 0.001) fail(`O valor excede o saldo devedor de R$ ${balance.toFixed(2).replace(".", ",")}`);
    const id = uuid();
    await client.query("INSERT INTO customer_credit_payments (id,tenant_id,sale_id,customer_id,register_id,user_id,amount,method,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, actor.tenant_id, saleId, sale.customer_id, register.id, actor.id, amount, method, notes.trim() || null]);
    await client.query("COMMIT");
    return id;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function closeRegister(id: string, counted: number, notes: string, actor: Actor): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const register = (await client.query("SELECT * FROM cash_registers WHERE tenant_id=$1 AND id=$2 AND status='aberto' FOR UPDATE", [actor.tenant_id, id])).rows[0];
    if (!register) fail("Caixa não encontrado ou já fechado");
    if (register.user_id !== actor.id && actor.role === "vendedor") fail("Sem permissão");
    const cash = Number((await client.query("SELECT COALESCE(SUM(p.amount),0) AS total FROM sale_payments p JOIN sales s ON s.tenant_id=p.tenant_id AND s.id=p.sale_id WHERE s.tenant_id=$1 AND s.register_id=$2 AND s.status='concluida' AND p.method='dinheiro'", [actor.tenant_id, id])).rows[0].total);
    const creditCash = Number((await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM customer_credit_payments WHERE tenant_id=$1 AND register_id=$2 AND method='dinheiro'", [actor.tenant_id, id])).rows[0].total);
    const change = Number((await client.query("SELECT COALESCE(SUM(change_amount),0) AS total FROM sales WHERE tenant_id=$1 AND register_id=$2 AND status='concluida'", [actor.tenant_id, id])).rows[0].total);
    const supply = Number((await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM cash_movements WHERE tenant_id=$1 AND register_id=$2 AND type='suprimento'", [actor.tenant_id, id])).rows[0].total);
    const withdrawal = Number((await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM cash_movements WHERE tenant_id=$1 AND register_id=$2 AND type='sangria'", [actor.tenant_id, id])).rows[0].total);
    const expected = r2(Number(register.opening_amount) + cash + creditCash - change + supply - withdrawal);
    await client.query("UPDATE cash_registers SET status='fechado',closed_at=NOW(),counted_amount=$1,expected_amount=$2,notes=$3 WHERE tenant_id=$4 AND id=$5", [r2(counted), expected, notes || null, actor.tenant_id, id]);
    await client.query("COMMIT");
    return r2(counted - expected);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function rpc(name: string, args: Record<string, unknown>, actor: Actor): Promise<unknown> {
  const pool = getPool();
  switch (name) {
    case "finalize_sale": return finalizeSale((args.payload ?? {}) as Record<string, unknown>, actor);
    case "receive_credit_payment": return receiveCreditPayment(String(args._sale_id ?? ""), Number(args._amount), String(args._method ?? ""), String(args._notes ?? ""), actor);
    case "close_register": return closeRegister(String(args._register_id ?? ""), Number(args._counted), String(args._notes ?? ""), actor);
    case "has_cancel_password":
      requireUser(actor);
      return Boolean((await pool.query("SELECT id FROM cancel_authorization WHERE tenant_id=$1 AND id=1", [actor.tenant_id])).rowCount);
    case "set_cancel_password": {
      requireManager(actor);
      const password = String(args._password ?? "");
      if (password.trim().length < 4) fail("A senha precisa ter pelo menos 4 caracteres");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor.tenant_id]);
        const current = (await client.query("SELECT password_hash FROM cancel_authorization WHERE tenant_id=$1 AND id=1 FOR UPDATE", [actor.tenant_id])).rows[0];
        if (current && !await bcrypt.compare(String(args._current_password ?? ""), normalizeBcryptHash(current.password_hash))) fail("Senha atual incorreta");
        await client.query("INSERT INTO cancel_authorization (tenant_id,id,password_hash,failed_attempts,locked_until,updated_by,updated_at) VALUES ($1,1,$2,0,NULL,$3,NOW()) ON CONFLICT (tenant_id,id) DO UPDATE SET password_hash=EXCLUDED.password_hash,failed_attempts=0,locked_until=NULL,updated_by=EXCLUDED.updated_by,updated_at=NOW()", [actor.tenant_id, await bcrypt.hash(password, 12), actor.id]);
        await client.query("COMMIT");
        return null;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    case "cancel_sale_authorized": {
      requireManager(actor);
      const saleId = String(args._sale_id ?? "");
      const reason = String(args._reason ?? "").trim();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const record = (await client.query("SELECT * FROM cancel_authorization WHERE tenant_id=$1 AND id=1 FOR UPDATE", [actor.tenant_id])).rows[0];
        if (!record) { await client.query("COMMIT"); return "sem_senha"; }
        if (record.locked_until && new Date(record.locked_until).getTime() > Date.now()) { await client.query("COMMIT"); return "bloqueado"; }
        if (!await bcrypt.compare(String(args._password ?? ""), normalizeBcryptHash(record.password_hash))) {
          if (Number(record.failed_attempts) + 1 >= 5) await client.query("UPDATE cancel_authorization SET failed_attempts=0,locked_until=NOW()+INTERVAL '5 minutes' WHERE tenant_id=$1 AND id=1", [actor.tenant_id]);
          else await client.query("UPDATE cancel_authorization SET failed_attempts=failed_attempts+1 WHERE tenant_id=$1 AND id=1", [actor.tenant_id]);
          await client.query("COMMIT");
          return Number(record.failed_attempts) + 1 >= 5 ? "bloqueado" : "senha_incorreta";
        }
        await client.query("UPDATE cancel_authorization SET failed_attempts=0,locked_until=NULL WHERE tenant_id=$1 AND id=1", [actor.tenant_id]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      await cancelSale(saleId, reason, actor);
      return "ok";
    }
    default: fail("Função inválida");
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json(null, "Método inválido");
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const route = new URL(request.url).searchParams.get("r") ?? "";
    const actor = await actorFor(request);
    if (route.startsWith("auth/")) {
      const result = await auth(route.slice(5), body, request);
      return json(result.data, null, result.cookie);
    }
    if (route === "query") return json(await queryTable(body, requireUser(actor)));
    if (route === "rpc") return json(await rpc(String(body.fn ?? ""), (body.args ?? {}) as Record<string, unknown>, requireUser(actor)));
    fail("Rota inválida");
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro no servidor. Confira a configuração do Netlify Database.";
    return json(null, message);
  }
}

export const config = { path: "/api/index.php" };
