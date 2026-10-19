import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { money, dateTime } from "@/lib/format";
import { useMe } from "@/hooks/use-auth";
import { useCatalog } from "@/hooks/use-catalog";

export const Route = createFileRoute("/_authenticated/estoque")({
  head: () => pageMeta("Estoque", "Saldo, entradas, ajustes e histórico de estoque."),
  component: Estoque,
});

const TYPE_LABEL: Record<string, string> = {
  entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", perda: "Perda/avaria", devolucao: "Devolução",
  transferencia: "Transferência", venda: "Venda", estorno: "Estorno",
};

type Mov = { product_id: string; type: string; quantity: string; reason: string; invoice_number: string; supplier_id: string; unit_cost: string; lot: string; expires_at: string; counted?: string };

function Estoque() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: cat } = useCatalog();
  const [mov, setMov] = useState<Mov | null>(null);
  const [q, setQ] = useState("");

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*, brands(name), categories(name)").order("name")).data ?? [],
  });
  const { data: history } = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await supabase.from("stock_movements").select("*, products(name,variant)").order("created_at", { ascending: false }).limit(200)).data ?? [],
  });
  const { data: people } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => Object.fromEntries(((await supabase.from("profiles").select("id,full_name")).data ?? []).map((p) => [p.id, p.full_name])),
  });

  const save = useMutation({
    mutationFn: async (m: Mov) => {
      const p = products?.find((x) => x.id === m.product_id);
      if (!p) throw new Error("Escolha um produto");
      let qty = Number(m.quantity);
      if (m.type === "ajuste") qty = Number(m.counted) - Number(p.stock);
      else if (["perda", "saida", "transferencia"].includes(m.type)) qty = -Math.abs(qty);
      else qty = Math.abs(qty);
      if (!qty) throw new Error("Quantidade inválida");
      if (m.type !== "entrada" && !m.reason.trim()) throw new Error("Informe o motivo");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("stock_movements").insert({
        product_id: p.id, type: m.type, quantity: qty, reason: m.reason || null, invoice_number: m.invoice_number || null,
        supplier_id: m.supplier_id || null, unit_cost: m.unit_cost ? Number(m.unit_cost) : null, user_id: u.user!.id,
      });
      if (error) throw error;
      if (m.type === "entrada" && (m.lot || m.expires_at)) {
        await supabase.from("stock_batches").insert({ product_id: p.id, lot: m.lot || null, expires_at: m.expires_at || null, quantity: qty });
      }
      if (m.type === "entrada" && m.unit_cost) await supabase.from("products").update({ cost_price: Number(m.unit_cost) }).eq("id", p.id);
    },
    onSuccess: () => {
      toast.success("Movimentação registrada");
      setMov(null);
      ["products", "stock_movements", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (products ?? []).filter((p) => !q || `${p.name} ${p.variant ?? ""} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const totalCost = (products ?? []).reduce((s, p) => s + Number(p.stock) * Number(p.cost_price), 0);
  const totalSale = (products ?? []).reduce((s, p) => s + Number(p.stock) * Number(p.sale_price), 0);
  const blank: Mov = { product_id: "", type: "entrada", quantity: "", reason: "", invoice_number: "", supplier_id: "", unit_cost: "", lot: "", expires_at: "" };
  const set = (k: keyof Mov, v: string) => setMov((m) => m && { ...m, [k]: v });
  const sel = products?.find((p) => p.id === mov?.product_id);

  return (
    <div>
      <PageHeader title="Estoque" subtitle={`Valor em estoque: ${money(totalCost)} (custo) · ${money(totalSale)} (venda)`}>
        {me?.isManager && <>
          <Button variant="outline" onClick={() => setMov({ ...blank, type: "ajuste" })}><SlidersHorizontal className="h-4 w-4" />Ajuste / contagem</Button>
          <Button onClick={() => setMov(blank)}><ArrowDownToLine className="h-4 w-4" />Movimentação</Button>
        </>}
      </PageHeader>

      <Tabs defaultValue="saldo">
        <TabsList><TabsTrigger value="saldo">Saldo atual</TabsTrigger><TabsTrigger value="hist">Histórico</TabsTrigger></TabsList>
        <TabsContent value="saldo" className="mt-4">
          <Input className="mb-3" placeholder="Buscar produto…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Card className="divide-y">
            {list.map((p) => {
              const low = Number(p.stock) <= Number(p.min_stock);
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name} {p.variant && <span className="text-muted-foreground">· {p.variant}</span>}</div>
                    <div className="text-xs text-muted-foreground">{p.sku} · mín {Number(p.min_stock)}</div>
                  </div>
                  <Badge variant={low ? "destructive" : "secondary"} className="text-sm">{Number(p.stock)} {p.unit}</Badge>
                </div>
              );
            })}
          </Card>
        </TabsContent>
        <TabsContent value="hist" className="mt-4">
          <Card className="divide-y">
            {(history ?? []).length === 0 && <p className="p-6 text-center text-muted-foreground">Nenhuma movimentação.</p>}
            {history?.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{h.products?.name} {h.products?.variant}</div>
                  <div className="text-xs text-muted-foreground">{dateTime(h.created_at)} · {people?.[h.user_id ?? ""] ?? "—"}{h.reason ? ` · ${h.reason}` : ""}{h.invoice_number ? ` · NF ${h.invoice_number}` : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant="outline">{TYPE_LABEL[h.type]}</Badge>
                  <div className={`font-semibold ${Number(h.quantity) < 0 ? "text-destructive" : "text-success"}`}>{Number(h.quantity) > 0 ? "+" : ""}{Number(h.quantity)}</div>
                </div>
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!mov} onOpenChange={(o) => !o && setMov(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">{mov?.type === "ajuste" ? "Ajuste de inventário" : "Movimentação de estoque"}</DialogTitle></DialogHeader>
          {mov && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(mov); }}>
              <div className="space-y-1"><Label>Produto</Label>
                <Select value={mov.product_id} onValueChange={(v) => set("product_id", v)}><SelectTrigger><SelectValue placeholder="Escolha…" /></SelectTrigger>
                  <SelectContent>{products?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} {p.variant ?? ""} ({Number(p.stock)})</SelectItem>)}</SelectContent></Select></div>
              {mov.type !== "ajuste" && (
                <div className="space-y-1"><Label>Tipo</Label>
                  <Select value={mov.type} onValueChange={(v) => set("type", v)}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["entrada", "devolucao", "perda", "saida", "transferencia"].map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent></Select></div>
              )}
              {mov.type === "ajuste" ? (
                <div className="space-y-1"><Label>Quantidade contada {sel && <span className="text-muted-foreground">(sistema: {Number(sel.stock)})</span>}</Label>
                  <Input type="number" min="0" required value={mov.counted ?? ""} onChange={(e) => set("counted", e.target.value)} />
                  {sel && mov.counted !== undefined && mov.counted !== "" && <p className="text-xs">Divergência: <b>{Number(mov.counted) - Number(sel.stock)}</b></p>}
                </div>
              ) : (
                <div className="space-y-1"><Label>Quantidade</Label><Input type="number" min="0.001" step="any" required value={mov.quantity} onChange={(e) => set("quantity", e.target.value)} /></div>
              )}
              {mov.type === "entrada" && <>
                <div className="space-y-1"><Label>Fornecedor</Label>
                  <Select value={mov.supplier_id} onValueChange={(v) => set("supplier_id", v)}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{cat?.suppliers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Nº da NF</Label><Input value={mov.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} /></div>
                  <div className="space-y-1"><Label>Custo unitário</Label><Input type="number" step="0.01" value={mov.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} /></div>
                  <div className="space-y-1"><Label>Lote</Label><Input value={mov.lot} onChange={(e) => set("lot", e.target.value)} /></div>
                  <div className="space-y-1"><Label>Validade</Label><Input type="date" value={mov.expires_at} onChange={(e) => set("expires_at", e.target.value)} /></div>
                </div>
              </>}
              <div className="space-y-1"><Label>Motivo {mov.type !== "entrada" && "*"}</Label><Input value={mov.reason} onChange={(e) => set("reason", e.target.value)} /></div>
              <Button className="w-full" disabled={save.isPending}>Registrar</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
