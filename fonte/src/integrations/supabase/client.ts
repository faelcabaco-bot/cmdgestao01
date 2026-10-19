// Mantém a interface usada pelas telas e envia as requisições para o backend do ambiente.
const API = "/api/index.php";

type Err = { message: string } | null;
type Res<T = any> = { data: T; error: Err };

async function call(path: string, body: unknown): Promise<Res> {
  try {
    const r = await fetch(`${API}?r=${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const j = await r.json().catch(() => null);
    if (!j) return { data: null, error: { message: "Resposta inválida do servidor" } };
    return { data: j.data ?? null, error: j.error ? { message: j.error } : null };
  } catch {
    return { data: null, error: { message: "Sem conexão com o servidor" } };
  }
}

class Q implements PromiseLike<Res> {
  private p: any = { table: "", op: "select", select: "*", filters: [], order: [], limit: null, single: null, values: null };
  constructor(table: string) { this.p.table = table; }
  select(s = "*") { this.p.select = s; return this; }
  insert(v: any) { this.p.op = "insert"; this.p.values = v; return this; }
  update(v: any) { this.p.op = "update"; this.p.values = v; return this; }
  delete() { this.p.op = "delete"; return this; }
  private f(op: string, col: string, val?: any) { this.p.filters.push({ op, col, val }); return this; }
  eq(c: string, v: any) { return this.f("eq", c, v); }
  neq(c: string, v: any) { return this.f("neq", c, v); }
  gt(c: string, v: any) { return this.f("gt", c, v); }
  gte(c: string, v: any) { return this.f("gte", c, v); }
  lt(c: string, v: any) { return this.f("lt", c, v); }
  lte(c: string, v: any) { return this.f("lte", c, v); }
  in(c: string, v: any[]) { return this.f("in", c, v); }
  is(c: string, v: any) { return this.f("is", c, v); }
  not(c: string, op: string, v: any) { this.p.filters.push({ op: "not", sub: op, col: c, val: v }); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.p.order.push({ col: c, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.p.limit = n; return this; }
  single() { this.p.single = "single"; return this; }
  maybeSingle() { this.p.single = "maybe"; return this; }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null) {
    return call("query", this.p).then(ok, ko);
  }
}

type Listener = (event: string, session: any) => void;
const listeners = new Set<Listener>();
const emit = (e: string, s: any = null) => listeners.forEach((l) => { try { l(e, s); } catch { /* */ } });

export const supabase = {
  from: (table: string) => new Q(table),
  rpc: (fn: string, args?: any) => call("rpc", { fn, args: args ?? {} }),
  auth: {
    async getUser() {
      const r = await call("auth/me", {});
      return { data: { user: r.data?.user ?? null }, error: r.error };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const r = await call("auth/login", { email, password });
      if (!r.error) emit("SIGNED_IN", r.data);
      return { data: r.data, error: r.error };
    },
    async signUp({ email, password, options }: any) {
      const r = await call("auth/signup", {
        email,
        password,
        full_name: options?.data?.full_name ?? "",
        company_name: options?.data?.company_name ?? "",
      });
      return { data: r.data, error: r.error };
    },
    async createUser({ email, password, full_name, role }: { email: string; password: string; full_name: string; role: string }) {
      const r = await call("auth/create_user", { email, password, full_name, role });
      return { data: r.data, error: r.error };
    },
    async signOut() {
      await call("auth/logout", {});
      emit("SIGNED_OUT");
      return { error: null };
    },
    async resetPasswordForEmail(email: string, _options?: { redirectTo?: string }) {
      const r = await call("auth/reset_request", { email });
      return { data: r.data, error: r.error };
    },
    async updateUser({ password }: { password: string }) {
      const token = new URLSearchParams(window.location.search).get("token");
      const r = await call("auth/update_password", { password, token });
      if (!r.error) emit("USER_UPDATED");
      return { data: r.data, error: r.error };
    },
    onAuthStateChange(cb: Listener) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
  },
};
