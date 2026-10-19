import { pageMeta } from "@/lib/page-meta";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, Trash2, Pause, Play, Printer, MessageCircle, X, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { money, dateTime, PAY_LABEL } from "@/lib/format";
import { cartTotals, lineTotal, paymentSummary, type CartItem, type Payment } from "@/lib/pos";
import { useMe } from "@/hooks/use-auth";
import { CustomerDialog, type Customer } from "@/components/CustomerDialog";

export const Route = createFileRoute("/_authenticated/pdv")({
  head: () => pageMeta("PDV", "Frente de caixa rápida."),
  component: PDV,
});

type Held = { id: number; items: CartItem[]; customer: string };

function PDV() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [disc, setDisc] = useState("0");
  const [discPct, setDiscPct] = useState(false);
  const [held, setHeld] = useState<Held[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [custOpen, setCustOpen] = useState(false);

  const { data: register, isLoading: regLoading } = useQuery({
    queryKey: ["my-register", me?.user.id],
    queryFn: async () => (await supabase.from("cash_registers").select("*").eq("user_id", me!.user.id).eq("status", "aberto").maybeSingle()).data,
    enabled: !!me,
  });
  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*, brands(name), categories(name)").order("name")).data ?? [],
  });
  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await supabase.from("customers").select("*").order("name")).data ?? [],
  });

  const active = (products ?? []).filter((p) => p.active);
  const results = q ? active.filter((p) => `${p.name} ${p.variant ?? ""} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase())) : active;
  const totals = cartTotals(cart, Number(disc) || 0, discPct);

  function add(p: (typeof active)[number]) {
    setCart((c) => {
      const ex = c.find((i) => i.product_id === p.id);
      if (ex) return c.map((i) => (i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...c, { product_id: p.id, name: `${p.name}${p.variant ? " " + p.variant : ""}`, unit_price: Number(p.sale_price), quantity: 1, discount: 0, stock: Number(p.stock) }];
    });
    setQ("");
    searchRef.current?.focus();
  }
  function onSearchEnter() {
    const exact = active.find((p) => p.barcode === q.trim() || p.sku?.toLowerCase() === q.trim().toLowerCase());
    if (exact) add(exact);
    else if (results.length === 1 && results[0]) add(results[0]);
    else if (q) toast.error("Produto não encontrado");
  }
  const qty = (id: string, d: number) => setCart((c) => c.flatMap((i) => (i.product_id !== id ? [i] : i.quantity + d <= 0 ? [] : [{ ...i, quantity: i.quantity + d }])));

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F4") { e.preventDefault(); if (cart.length) setPayOpen(true); }
      if (e.key === "Escape" && !payOpen && !receipt && cart.length) { setConfirmClear(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [cart.length, payOpen, receipt]);

  function hold() {
    if (!cart.length) return;
    setHeld((h) => [...h, { id: Date.now(), items: cart, customer }]);
    setCart([]); setCustomer(""); setDisc("0");
    toast("Venda colocada em espera");
  }
  function resume(h: Held) {
    if (cart.length) hold();
    setCart(h.items); setCustomer(h.customer);
    setHeld((x) => x.filter((i) => i.id !== h.id));
  }

  const finalize = useMutation({
    mutationFn: async (payments: Payment[]) => {
      const { data, error } = await supabase.rpc("finalize_sale", {
        payload: {
          customer_id: customer || null,
          discount: totals.discount,
          items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount })),
          payments,
        },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      setPayOpen(false); setCart([]); setCustomer(""); setDisc("0"); setReceipt(id);
      ["products", "dashboard", "sales"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (regLoading) return <p className="text-muted-foreground">Carregando…</p>;
  if (!register) return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <h2 className="text-3xl font-semibold">Caixa fechado</h2>
      <p className="mt-2 text-muted-foreground">Abra o seu caixa para começar a vender.</p>
      <Link to="/caixa" className="mt-6 inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">Ir para o Caixa</Link>
    </Card>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <div className="min-w-0">
        <div className="flex gap-2 mb-3">
          <Input ref={searchRef} autoFocus className="h-12 text-base" placeholder="F2 · Código de barras, SKU ou nome" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSearchEnter()} />
        </div>
        {held.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {held.map((h) => <Button key={h.id} size="sm" variant="secondary" onClick={() => resume(h)}><Play className="h-3 w-3" />Em espera · {h.items.length} itens</Button>)}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
          {results.slice(0, 40).map((p) => (
            <button key={p.id} onClick={() => add(p)} className="rounded-xl border bg-card p-3 text-left hover:border-primary hover:shadow-soft transition active:scale-[0.98]">
              <div className="text-sm font-semibold line-clamp-2">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.variant ?? p.brands?.name}</div>
              <div className="mt-2 flex items-end justify-between">
                <span className="font-display text-lg font-semibold text-primary">{money(p.sale_price)}</span>
                <span className={`text-xs ${Number(p.stock) <= 0 ? "text-destructive" : "text-muted-foreground"}`}>{Number(p.stock)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Card className="flex flex-col p-4 lg:sticky lg:top-4 lg:h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Venda atual</h2>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={hold} title="Pausar venda"><Pause className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => cart.length && setConfirmClear(true)} title="Cancelar (ESC)"><X className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="mt-3 flex-1 overflow-y-auto divide-y min-h-32">
          {cart.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Adicione produtos pelo leitor, busca ou clique.</p>}
          {cart.map((i) => (
            <div key={i.product_id} className="py-2">
              <div className="flex justify-between gap-2 text-sm"><span className="font-medium">{i.name}</span><span className="font-semibold">{money(lineTotal(i))}</span></div>
              <div className="mt-1 flex items-center gap-2">
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => qty(i.product_id, -1)}><Minus className="h-3 w-3" /></Button>
                <span className="w-6 text-center text-sm">{i.quantity}</span>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => qty(i.product_id, 1)}><Plus className="h-3 w-3" /></Button>
                <span className="text-xs text-muted-foreground">× {money(i.unit_price)}</span>
                {i.quantity > i.stock && <span className="text-xs text-destructive">sem estoque</span>}
                <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={() => setCart((c) => c.filter((x) => x.product_id !== i.product_id))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t pt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Desconto</Label>
            <Input type="number" min="0" step="0.01" className="h-8" value={disc} onChange={(e) => setDisc(e.target.value)} />
            <span className="text-xs">R$</span><Switch checked={discPct} onCheckedChange={setDiscPct} /><span className="text-xs">%</span>
          </div>
          {!me?.isManager && <p className="text-xs text-muted-foreground">Descontos acima de 10% exigem gerente.</p>}
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Desconto</span><span>- {money(totals.discount)}</span></div>
          <div className="flex justify-between items-end"><span className="font-semibold">Total</span><span className="font-display text-4xl font-semibold">{money(totals.total)}</span></div>
          <Button size="lg" className="w-full h-12 text-base" disabled={!cart.length} onClick={() => setPayOpen(true)}>Finalizar (F4)</Button>
        </div>
      </Card>

      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} total={totals.total} customers={customers ?? []} customer={customer} onCustomerChange={setCustomer} onAddCustomer={() => setCustOpen(true)} busy={finalize.isPending} onConfirm={(p) => finalize.mutate(p)} />
      <CustomerDialog open={custOpen} onOpenChange={setCustOpen} onSaved={(c) => setCustomer(c.id)} />
      <ReceiptDialog saleId={receipt} onClose={() => { setReceipt(null); searchRef.current?.focus(); }} />

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Cancelar esta venda?</AlertDialogTitle><AlertDialogDescription>Todos os itens serão removidos.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Voltar</AlertDialogCancel><AlertDialogAction onClick={() => { setCart([]); setDisc("0"); }}>Cancelar venda</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PaymentDialog({ open, onOpenChange, total, customers, customer, onCustomerChange, onAddCustomer, busy, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; total: number; customers: Customer[]; customer: string;
  onCustomerChange: (id: string) => void; onAddCustomer: () => void; busy: boolean; onConfirm: (p: Payment[]) => void;
}) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [method, setMethod] = useState<Payment["method"]>("dinheiro");
  const [amount, setAmount] = useState("");
  const [inst, setInst] = useState("1");
  const sum = useMemo(() => paymentSummary(total, payments), [total, payments]);

  useEffect(() => { if (open) { setPayments([]); setAmount(total.toFixed(2)); setMethod("dinheiro"); } }, [open, total]);

  function addPay() {
    const v = Number(amount);
    if (!(v > 0)) return;
    if (method === "fiado" && !customer) { toast.error("Selecione um cliente para vender fiado"); return; }
    const next = [...payments, { method, amount: v, installments: method === "credito" ? Number(inst) : 1 }];
    setPayments(next);
    setAmount(paymentSummary(total, next).remaining.toFixed(2));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display text-2xl">Pagamento · {money(total)}</DialogTitle></DialogHeader>
        <div className="space-y-1">
          <Label>Cliente da venda</Label>
          <div className="flex gap-2">
            <Select value={customer || "none"} onValueChange={(v) => onCustomerChange(v === "none" ? "" : v)}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Cliente (opcional)" /></SelectTrigger>
              <SelectContent><SelectItem value="none">Sem cliente</SelectItem>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="outline" title="Cadastrar novo cliente" onClick={onAddCustomer}><UserPlus className="h-4 w-4" /><span>Cadastrar</span></Button>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {(["dinheiro", "pix", "debito", "credito", "fiado"] as const).map((m) => (
            <Button key={m} size="sm" variant={method === m ? "default" : "outline"} onClick={() => setMethod(m)} className="px-1 text-xs">{PAY_LABEL[m]}</Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPay()} className="h-11 text-lg" />
          {method === "credito" && (
            <Select value={inst} onValueChange={setInst}><SelectTrigger className="w-24 h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 12 }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1}x</SelectItem>)}</SelectContent></Select>
          )}
          <Button variant="secondary" className="h-11" onClick={addPay}>Adicionar</Button>
        </div>
        <div className="space-y-1 text-sm">
          {payments.map((p, i) => (
            <div key={i} className="flex justify-between rounded-md bg-muted px-3 py-1.5">
              <span>{PAY_LABEL[p.method]}{p.method === "credito" && p.installments! > 1 ? ` ${p.installments}x` : ""}</span>
              <span className="flex items-center gap-2">{money(p.amount)}<button onClick={() => setPayments(payments.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button></span>
            </div>
          ))}
          <div className="flex justify-between pt-2"><span>Falta</span><b>{money(sum.remaining)}</b></div>
          {sum.change > 0 && <div className="flex justify-between text-lg"><span>Troco</span><b className="text-success">{money(sum.change)}</b></div>}
          {!sum.ok && sum.paid > total && <p className="text-xs text-destructive">Troco só é possível com pagamento em dinheiro.</p>}
        </div>
        <Button size="lg" disabled={!sum.ok || busy || payments.length === 0} onClick={() => onConfirm(payments)}>{busy ? "Finalizando…" : "Confirmar venda"}</Button>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["receipt", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const [s, st] = await Promise.all([
        supabase.from("sales").select("*, sale_items(*), sale_payments(*), customers(name,phone)").eq("id", saleId!).single(),
        supabase.from("settings").select("*").eq("id", 1).single(),
      ]);
      return { sale: s.data!, store: st.data! };
    },
  });

  function text() {
    if (!data) return "";
    const { sale, store } = data;
    return [
      store.store_name, `Venda nº ${sale.number} · ${dateTime(sale.created_at)}`, "",
      ...sale.sale_items.map((i) => `${i.quantity}x ${i.name}  ${money(i.total)}`), "",
      sale.discount > 0 ? `Desconto: -${money(sale.discount)}` : "", `TOTAL: ${money(sale.total)}`,
      ...sale.sale_payments.map((p) => `${PAY_LABEL[p.method]}: ${money(p.amount)}`),
      sale.change_amount > 0 ? `Troco: ${money(sale.change_amount)}` : "", "", store.receipt_footer ?? "",
    ].filter((l, idx, a) => l !== "" || a[idx - 1] !== "").join("\n");
  }

  function print() {
    const w = window.open("", "_blank", "width=380,height=600");
    if (!w) return;
    w.document.write(`<html><head><title>Recibo</title><style>@page{size:80mm auto;margin:4mm}body{font-family:monospace;font-size:12px;width:72mm;white-space:pre-wrap}</style></head><body>${text().replace(/</g, "&lt;")}</body></html>`);
    w.document.close(); w.focus(); w.print();
  }
  function whatsapp() {
    const phone = data?.sale.customers?.phone?.replace(/\D/g, "");
    window.open(`https://wa.me/${phone ? "55" + phone : ""}?text=${encodeURIComponent(text())}`, "_blank");
  }

  return (
    <Dialog open={!!saleId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display text-2xl">Venda concluída ✓</DialogTitle></DialogHeader>
        <pre className="max-h-80 overflow-y-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap font-mono">{data ? text() : "Carregando…"}</pre>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={print}><Printer className="h-4 w-4" />Imprimir</Button>
          <Button variant="outline" onClick={whatsapp}><MessageCircle className="h-4 w-4" />WhatsApp</Button>
        </div>
        <Button onClick={onClose}>Nova venda</Button>
      </DialogContent>
    </Dialog>
  );
}
