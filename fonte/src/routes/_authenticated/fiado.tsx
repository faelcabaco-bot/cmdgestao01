import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BookOpen, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CustomerDialog, type Customer } from "@/components/CustomerDialog";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dateTime, money, PAY_LABEL } from "@/lib/format";
import { useMe } from "@/hooks/use-auth";

type Sale = {
  id: string;
  number: number;
  customer_id: string | null;
  created_at: string;
  status: string;
  total: number;
  sale_payments: { method: string; amount: number }[];
};
type CreditPayment = {
  id: string;
  sale_id: string;
  customer_id: string;
  amount: number;
  method: string;
  notes: string | null;
  created_at: string;
};
type CreditSale = Sale & { creditAmount: number; received: number; balance: number };

export const Route = createFileRoute("/_authenticated/fiado")({
  head: () => pageMeta("Fiado", "Contas a receber e histórico de pagamentos de clientes."),
  component: Fiado,
});

function Fiado() {
  const { data: me, isLoading: meLoading } = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showSettled, setShowSettled] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [paymentSale, setPaymentSale] = useState<CreditSale | null>(null);

  const { data: register } = useQuery({
    queryKey: ["my-register", me?.user.id],
    queryFn: async () => (await supabase.from("cash_registers").select("id").eq("user_id", me!.user.id).eq("status", "aberto").maybeSingle()).data,
    enabled: !!me?.isManager,
  });
  const { data: customers, isLoading: customersLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await supabase.from("customers").select("*").order("name")).data ?? [],
    enabled: !!me?.isManager,
  });
  const { data: sales, isLoading: salesLoading } = useQuery({
    queryKey: ["fiado-sales"],
    queryFn: async () => (await supabase.from("sales").select("*, sale_payments(*)").eq("status", "concluida").order("created_at", { ascending: false })).data ?? [],
    enabled: !!me?.isManager,
  });
  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: ["fiado-payments"],
    queryFn: async () => (await supabase.from("customer_credit_payments").select("*").order("created_at", { ascending: false })).data ?? [],
    enabled: !!me?.isManager,
  });

  const creditPaymentRows = (payments ?? []) as CreditPayment[];
  const paidBySale = new Map<string, number>();
  creditPaymentRows.forEach((payment) => paidBySale.set(payment.sale_id, (paidBySale.get(payment.sale_id) ?? 0) + Number(payment.amount)));
  const creditSales = ((sales ?? []) as Sale[]).map((sale): CreditSale => {
    const creditAmount = sale.sale_payments.filter((payment) => payment.method === "fiado").reduce((sum, payment) => sum + Number(payment.amount), 0);
    const received = paidBySale.get(sale.id) ?? 0;
    return { ...sale, creditAmount, received, balance: Math.max(0, creditAmount - received) };
  }).filter((sale) => sale.creditAmount > 0);

  const query = search.trim().toLowerCase();
  const customerRows = (customers ?? []) as Customer[];
  const rows = customerRows.map((customer) => {
    const entries = creditSales.filter((sale) => sale.customer_id === customer.id);
    return { customer, entries, balance: entries.reduce((sum, sale) => sum + sale.balance, 0), openCount: entries.filter((sale) => sale.balance > 0.005).length };
  }).filter((row) => (showSettled || row.balance > 0.005)
    && (!query || `${row.customer.name} ${row.customer.phone ?? ""} ${row.customer.cpf ?? ""}`.toLowerCase().includes(query)))
    .sort((a, b) => b.balance - a.balance || a.customer.name.localeCompare(b.customer.name));
  const totalOpen = rows.reduce((sum, row) => sum + row.balance, 0);
  const openCustomers = rows.filter((row) => row.balance > 0.005).length;
  const selectedCustomer = customerRows.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedSales = creditSales.filter((sale) => sale.customer_id === selectedCustomerId);
  const loading = customersLoading || salesLoading || paymentsLoading;

  const receive = useMutation({
    mutationFn: async ({ sale, amount, method, notes }: { sale: CreditSale; amount: number; method: string; notes: string }) => {
      const { error } = await supabase.rpc("receive_credit_payment", {
        _sale_id: sale.id, _amount: amount, _method: method, _notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pagamento registrado");
      setPaymentSale(null);
      ["fiado-sales", "fiado-payments", "register-detail", "my-register", "dashboard"].forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (meLoading) return <p className="text-muted-foreground">Carregando…</p>;
  if (!me?.isManager) return <Card className="p-8 text-center"><h2 className="text-xl font-semibold">Acesso restrito</h2><p className="mt-2 text-sm text-muted-foreground">O caderno de fiado está disponível para gerente e administrador.</p></Card>;

  return (
    <div>
      <PageHeader title="Caderno de fiado" subtitle="Saldos em aberto e recebimentos por cliente">
        <Button variant="outline" onClick={() => setShowSettled((value) => !value)}>{showSettled ? "Mostrar em aberto" : "Incluir quitados"}</Button>
        <Button onClick={() => setCustomerDialogOpen(true)}><Plus className="h-4 w-4" />Novo cliente</Button>
      </PageHeader>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className="px-4 py-3"><div className="text-xs text-muted-foreground">Saldo total em aberto</div><div className="mt-1 text-2xl font-semibold">{money(totalOpen)}</div></Card>
        <Card className="px-4 py-3"><div className="text-xs text-muted-foreground">Clientes com saldo</div><div className="mt-1 text-2xl font-semibold">{openCustomers}</div></Card>
      </div>
      {!register && <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">Abra seu caixa para registrar recebimentos de fiado.</p>}
      <div className="relative mb-3 max-w-lg"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar cliente, telefone ou CPF/CNPJ" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <Card className="divide-y">
        {loading && <p className="p-4 text-sm text-muted-foreground">Carregando caderno…</p>}
        {!loading && rows.length === 0 && <div className="p-8 text-center"><BookOpen className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">{showSettled ? "Nenhum cliente encontrado." : "Nenhum saldo em aberto."}</p></div>}
        {!loading && rows.map(({ customer, balance, openCount }) => (
          <button key={customer.id} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => setSelectedCustomerId(customer.id)}>
            <span className="min-w-0"><span className="block truncate font-medium">{customer.name}</span><span className="block text-xs text-muted-foreground">{customer.phone || "Sem telefone"} · {openCount} venda(s) em aberto</span></span>
            <span className="shrink-0 text-right"><span className="block font-semibold">{money(balance)}</span><Badge variant={balance > 0 ? "destructive" : "secondary"}>{balance > 0 ? "Em aberto" : "Quitado"}</Badge></span>
          </button>
        ))}
      </Card>

      <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomerId(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">Caderninho · {selectedCustomer?.name}</DialogTitle></DialogHeader>
          {selectedCustomer && <div className="space-y-4">
            <div className="flex flex-wrap justify-between gap-2 rounded-md bg-muted p-3 text-sm"><span>{selectedCustomer.phone || "Sem telefone cadastrado"}</span><span>Saldo total <b>{money(selectedSales.reduce((sum, sale) => sum + sale.balance, 0))}</b></span></div>
            {selectedSales.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Este cliente ainda não tem vendas no fiado.</p>}
            {selectedSales.map((sale) => {
              const salePayments = creditPaymentRows.filter((payment) => payment.sale_id === sale.id);
              return <section key={sale.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="font-semibold">Venda #{sale.number} <span className="font-normal text-muted-foreground">· {dateTime(sale.created_at)}</span></div><div className="mt-1 text-sm text-muted-foreground">Fiado {money(sale.creditAmount)} · recebido {money(sale.received)}</div></div>
                  <div className="text-right"><div className="font-semibold">Saldo {money(sale.balance)}</div>{sale.balance > 0.005 && <Button size="sm" className="mt-2" disabled={!register} onClick={() => setPaymentSale(sale)}>Receber pagamento</Button>}</div>
                </div>
                {salePayments.length > 0 && <div className="mt-3 border-t pt-2"><div className="mb-1 text-xs font-semibold text-muted-foreground">RECEBIMENTOS</div>{salePayments.map((payment) => <div key={payment.id} className="flex justify-between gap-3 py-1 text-sm"><span>{dateTime(payment.created_at)} · {PAY_LABEL[payment.method] ?? payment.method}{payment.notes ? ` · ${payment.notes}` : ""}</span><b>{money(payment.amount)}</b></div>)}</div>}
              </section>;
            })}
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentSale} onOpenChange={(open) => !open && setPaymentSale(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-2xl">Receber fiado · #{paymentSale?.number}</DialogTitle></DialogHeader>
          {paymentSale && <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            receive.mutate({ sale: paymentSale, amount: Number(form.get("amount")), method: String(form.get("method")), notes: String(form.get("notes") ?? "") });
          }}>
            <div className="rounded-md bg-muted p-3 text-sm">Saldo devedor: <b>{money(paymentSale.balance)}</b></div>
            <div className="space-y-1"><Label>Valor recebido</Label><Input name="amount" type="number" min="0.01" max={paymentSale.balance} step="0.01" defaultValue={paymentSale.balance.toFixed(2)} required /></div>
            <div className="space-y-1"><Label>Forma de recebimento</Label><Select name="method" defaultValue="dinheiro"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dinheiro">Dinheiro</SelectItem><SelectItem value="pix">PIX</SelectItem><SelectItem value="debito">Débito</SelectItem><SelectItem value="credito">Crédito</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label>Observação</Label><Input name="notes" placeholder="Opcional" /></div>
            <Button className="w-full" disabled={receive.isPending || !register}>{receive.isPending ? "Registrando…" : "Registrar recebimento"}</Button>
          </form>}
        </DialogContent>
      </Dialog>
      <CustomerDialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen} onSaved={(customer) => { setSelectedCustomerId(customer.id); qc.invalidateQueries({ queryKey: ["customers"] }); }} />
    </div>
  );
}
