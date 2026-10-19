import { pageMeta } from "@/lib/page-meta";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { money, dateOnly, PAY_LABEL } from "@/lib/format";
import { useMe } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => pageMeta("Painel", "Resumo de vendas e alertas da loja."),
  component: Dashboard,
});

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Dashboard() {
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const [sales, products, batches, register] = await Promise.all([
        supabase.from("sales").select("id,total,created_at,sale_items(name,quantity,total,unit_cost),sale_payments(method,amount)").eq("status", "concluida").gte("created_at", since),
        supabase.from("products").select("id,name,variant,stock,min_stock").eq("active", true),
        supabase.from("stock_batches").select("expires_at,lot,quantity,products(name,variant)").not("expires_at", "is", null).lte("expires_at", new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10)).gt("quantity", 0).order("expires_at"),
        supabase.from("cash_registers").select("*").eq("status", "aberto").eq("user_id", me!.user.id).maybeSingle(),
      ]);
      return { sales: sales.data ?? [], products: products.data ?? [], batches: batches.data ?? [], register: register.data };
    },
    enabled: !!me,
  });

  if (isLoading || !data) return <div className="grid gap-4 md:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;

  const todayKey = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const dayKey = (d: string) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const month = new Date().toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
  const today = data.sales.filter((s) => dayKey(s.created_at) === todayKey);
  const monthSales = data.sales.filter((s) => dayKey(s.created_at).endsWith(month));
  const sum = (a: typeof data.sales) => a.reduce((t, s) => t + Number(s.total), 0);
  const profit = monthSales.reduce((t, s) => t + Number(s.total) - s.sale_items.reduce((c, i) => c + Number(i.unit_cost) * Number(i.quantity), 0), 0);

  const byDay = new Map<string, number>();
  for (let i = 29; i >= 0; i--) byDay.set(dayKey(new Date(Date.now() - i * 864e5).toISOString()).slice(0, 5), 0);
  data.sales.forEach((s) => { const k = dayKey(s.created_at).slice(0, 5); byDay.set(k, (byDay.get(k) ?? 0) + Number(s.total)); });
  const pay = new Map<string, number>();
  data.sales.forEach((s) => s.sale_payments.forEach((p) => pay.set(p.method, (pay.get(p.method) ?? 0) + Number(p.amount))));
  const top = new Map<string, number>();
  data.sales.forEach((s) => s.sale_items.forEach((i) => top.set(i.name, (top.get(i.name) ?? 0) + Number(i.quantity))));
  const topList = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const low = data.products.filter((p) => Number(p.stock) <= Number(p.min_stock));

  const stats = [
    { label: "Vendas hoje", value: money(sum(today)), sub: `${today.length} vendas` },
    { label: "Vendas no mês", value: money(sum(monthSales)), sub: `${monthSales.length} vendas` },
    { label: "Ticket médio", value: money(monthSales.length ? sum(monthSales) / monthSales.length : 0), sub: "no mês" },
    { label: "Lucro estimado", value: money(profit), sub: "no mês (sem taxas)" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={`Olá, ${me?.profile?.full_name?.split(" ")[0] ?? ""}`} subtitle={data.register ? "Seu caixa está aberto" : "Seu caixa está fechado"}>
        <Link to="/pdv" className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft">Abrir PDV</Link>
      </PageHeader>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4 md:p-5 shadow-soft">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="mt-2 font-display text-2xl md:text-3xl font-semibold">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.sub}</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-xl font-semibold mb-3">Vendas — últimos 30 dias</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={[...byDay.entries()].map(([d, v]) => ({ d, v }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="d" fontSize={10} interval={4} />
                <YAxis fontSize={10} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Bar dataKey="v" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-xl font-semibold mb-3">Formas de pagamento</h3>
          {pay.size === 0 ? <p className="text-sm text-muted-foreground">Nenhuma venda ainda.</p> : (
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={[...pay.entries()].map(([k, v]) => ({ name: PAY_LABEL[k], value: v }))} dataKey="value" innerRadius={50} outerRadius={90} label={(e) => e.name}>
                    {[...pay.keys()].map((_, i) => <Cell key={i} fill={COLORS[i % 5]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => money(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="text-xl font-semibold mb-3">Top 10 produtos</h3>
          {topList.length === 0 ? <p className="text-sm text-muted-foreground">Sem vendas nos últimos 30 dias.</p> :
            <ol className="space-y-1.5 text-sm">{topList.map(([n, q], i) => <li key={n} className="flex justify-between"><span>{i + 1}. {n}</span><span className="text-muted-foreground">{q}</span></li>)}</ol>}
        </Card>
        <Card className="p-5">
          <h3 className="text-xl font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />Estoque baixo</h3>
          {low.length === 0 ? <p className="text-sm text-muted-foreground">Tudo em ordem.</p> :
            <ul className="space-y-1.5 text-sm">{low.map((p) => <li key={p.id} className="flex justify-between"><span>{p.name} {p.variant}</span><span className="text-destructive font-semibold">{Number(p.stock)} / mín {Number(p.min_stock)}</span></li>)}</ul>}
        </Card>
        <Card className="p-5">
          <h3 className="text-xl font-semibold mb-3 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-gold" />Vencendo em 90 dias</h3>
          {data.batches.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum lote vencendo.</p> :
            <ul className="space-y-1.5 text-sm">{data.batches.map((b, i) => {
              const days = Math.ceil((new Date(b.expires_at!).getTime() - Date.now()) / 864e5);
              return <li key={i} className="flex justify-between gap-2"><span className="truncate">{b.products?.name} {b.products?.variant}</span><span className={days <= 30 ? "text-destructive font-semibold" : days <= 60 ? "text-warning" : "text-muted-foreground"}>{dateOnly(b.expires_at!)}</span></li>;
            })}</ul>}
        </Card>
      </div>
    </div>
  );
}
