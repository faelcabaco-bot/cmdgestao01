import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Eye, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateTime, money, PAY_LABEL } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/vendas")({
  head: () => pageMeta("Vendas", "Histórico detalhado de vendas."),
  component: Vendas,
});

type Sale = {
  id: string;
  number: number;
  created_at: string;
  user_id: string;
  total: number;
  subtotal: number;
  discount: number;
  change_amount: number;
  status: string;
  cancel_reason: string | null;
  customers: { name: string; phone: string | null } | null;
  sale_items: { id: string; name: string; quantity: number; unit_price: number; discount: number; total: number }[];
  sale_payments: { id: string; method: string; amount: number; installments: number }[];
};
type OperatorProfile = { id: string; full_name: string };

function Vendas() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Sale | null>(null);

  const { data: sales, isLoading } = useQuery({
    queryKey: ["sales-history"],
    queryFn: async () => (await supabase.from("sales").select("*, sale_items(*), sale_payments(*), customers(name,phone)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: profiles } = useQuery({
    queryKey: ["sales-history-profiles"],
    queryFn: async () => (await supabase.from("profiles").select("id,full_name")).data ?? [],
  });
  const operators = Object.fromEntries(((profiles ?? []) as OperatorProfile[]).map((p) => [p.id, p.full_name]));
  const query = search.trim().toLowerCase();
  const filtered = ((sales ?? []) as Sale[]).filter((sale) => {
    const day = sale.created_at.slice(0, 10);
    const terms = `${sale.number} ${sale.customers?.name ?? ""} ${sale.customers?.phone ?? ""}`.toLowerCase();
    return (!query || terms.includes(query))
      && (status === "all" || sale.status === status)
      && (!from || day >= from)
      && (!to || day <= to);
  });
  const completed = filtered.filter((sale) => sale.status === "concluida");
  const completedTotal = completed.reduce((sum, sale) => sum + Number(sale.total), 0);
  const canceledCount = filtered.filter((sale) => sale.status === "cancelada").length;

  return (
    <div>
      <PageHeader title="Histórico de vendas" subtitle={`${filtered.length} vendas encontradas`} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Summary label="Vendas concluídas" value={String(completed.length)} />
        <Summary label="Total vendido" value={money(completedTotal)} />
        <Summary label="Canceladas" value={String(canceledCount)} />
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_160px_170px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar nº, cliente ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Input aria-label="Data inicial" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input aria-label="Data final" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os status</SelectItem><SelectItem value="concluida">Concluídas</SelectItem><SelectItem value="cancelada">Canceladas</SelectItem></SelectContent></Select>
      </div>
      <Card>
        {isLoading ? <p className="p-6 text-sm text-muted-foreground">Carregando vendas…</p> : filtered.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma venda encontrada para esses filtros.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Venda</TableHead><TableHead>Data</TableHead><TableHead>Cliente</TableHead><TableHead>Operador</TableHead><TableHead>Pagamento</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{filtered.map((sale) => (
              <TableRow key={sale.id}>
                <TableCell className="font-semibold">#{sale.number}</TableCell>
                <TableCell className="whitespace-nowrap">{dateTime(sale.created_at)}</TableCell>
                <TableCell>{sale.customers?.name ?? "Consumidor não identificado"}</TableCell>
                <TableCell>{operators[sale.user_id] ?? "—"}</TableCell>
                <TableCell>{[...new Set(sale.sale_payments.map((p) => PAY_LABEL[p.method] ?? p.method))].join(", ") || "—"}</TableCell>
                <TableCell className="text-right font-semibold">{money(sale.total)}</TableCell>
                <TableCell><Badge variant={sale.status === "cancelada" ? "destructive" : "secondary"}>{sale.status === "cancelada" ? "Cancelada" : "Concluída"}</Badge></TableCell>
                <TableCell><Button size="icon" variant="ghost" title="Ver detalhes" onClick={() => setSelected(sale)}><Eye className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Card>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">Venda #{selected?.number}</DialogTitle></DialogHeader>
          {selected && <SaleDetails sale={selected} operator={operators[selected.user_id] ?? "—"} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <Card className="px-4 py-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></Card>;
}

function SaleDetails({ sale, operator }: { sale: Sale; operator: string }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div><span className="text-muted-foreground">Data</span><div className="font-medium">{dateTime(sale.created_at)}</div></div>
        <div><span className="text-muted-foreground">Operador</span><div className="font-medium">{operator}</div></div>
        <div><span className="text-muted-foreground">Cliente</span><div className="font-medium">{sale.customers?.name ?? "Consumidor não identificado"}</div></div>
        <div><span className="text-muted-foreground">Situação</span><div className="font-medium">{sale.status === "cancelada" ? "Cancelada" : "Concluída"}</div></div>
      </div>
      {sale.status === "cancelada" && sale.cancel_reason && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">Motivo do cancelamento: {sale.cancel_reason}</p>}
      <section>
        <h3 className="mb-2 font-semibold">Itens</h3>
        <div className="divide-y rounded-md border">
          {sale.sale_items.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm"><div><div className="font-medium">{item.name}</div><div className="text-muted-foreground">{item.quantity} × {money(item.unit_price)}{Number(item.discount) > 0 ? ` · desconto ${money(item.discount)}` : ""}</div></div><b>{money(item.total)}</b></div>)}
        </div>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">Pagamentos</h3>
        <div className="divide-y rounded-md border">
          {sale.sale_payments.map((payment) => <div key={payment.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{PAY_LABEL[payment.method] ?? payment.method}{payment.method === "credito" && payment.installments > 1 ? ` · ${payment.installments}x` : ""}</span><b>{money(payment.amount)}</b></div>)}
          {sale.change_amount > 0 && <div className="flex justify-between px-3 py-2 text-sm"><span>Troco</span><b>{money(sale.change_amount)}</b></div>}
        </div>
      </section>
      <div className="grid gap-1 border-t pt-3 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
        <div className="flex justify-between"><span>Desconto</span><span>- {money(sale.discount)}</span></div>
        <div className="flex justify-between text-lg font-semibold"><span>Total</span><span>{money(sale.total)}</span></div>
      </div>
    </div>
  );
}
