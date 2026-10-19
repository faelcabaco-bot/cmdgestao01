import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { money, margin } from "@/lib/format";
import { useMe } from "@/hooks/use-auth";
import { useCatalog } from "@/hooks/use-catalog";

export const Route = createFileRoute("/_authenticated/produtos")({
  head: () => pageMeta("Produtos", "Cadastro de produtos e variações."),
  component: Produtos,
});

type Form = {
  id?: string; name: string; variant: string; sku: string; barcode: string; brand_id: string; category_id: string; supplier_id: string;
  cost_price: string; sale_price: string; min_stock: string; unit: string; description: string; active: boolean;
};
const empty: Form = { name: "", variant: "", sku: "", barcode: "", brand_id: "", category_id: "", supplier_id: "", cost_price: "0", sale_price: "0", min_stock: "3", unit: "un", description: "", active: true };

function Produtos() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: cat } = useCatalog();
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("all");
  const [fBrand, setFBrand] = useState("all");
  const [form, setForm] = useState<Form | null>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*, brands(name), categories(name)").order("name")).data ?? [],
  });

  const list = (products ?? []).filter((p) => {
    const t = q.toLowerCase();
    return (!t || p.name.toLowerCase().includes(t) || p.sku?.toLowerCase().includes(t) || p.barcode?.includes(t))
      && (fCat === "all" || p.category_id === fCat) && (fBrand === "all" || p.brand_id === fBrand);
  });

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const row = {
        name: f.name, variant: f.variant || null, sku: f.sku || null, barcode: f.barcode || null,
        brand_id: f.brand_id || null, category_id: f.category_id || null, supplier_id: f.supplier_id || null,
        cost_price: Number(f.cost_price), sale_price: Number(f.sale_price), min_stock: Number(f.min_stock),
        unit: f.unit, description: f.description || null, active: f.active, updated_at: new Date().toISOString(),
      };
      const { error } = f.id ? await supabase.from("products").update(row).eq("id", f.id) : await supabase.from("products").insert(row);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Produto salvo"); setForm(null); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "SKU já existe" : e.message),
  });

  function exportCsv() {
    const head = ["nome", "variacao", "sku", "ean", "marca", "categoria", "custo", "venda", "estoque", "minimo"];
    const rows = list.map((p) => [p.name, p.variant ?? "", p.sku ?? "", p.barcode ?? "", p.brands?.name ?? "", p.categories?.name ?? "", p.cost_price, p.sale_price, p.stock, p.min_stock]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = "produtos.csv"; a.click();
  }

  const set = (k: keyof Form, v: string | boolean) => setForm((f) => f && { ...f, [k]: v });

  return (
    <div>
      <PageHeader title="Produtos" subtitle={`${products?.length ?? 0} itens cadastrados`}>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" />Exportar CSV</Button>
        {me?.isManager && <Button onClick={() => setForm(empty)}><Plus className="h-4 w-4" />Novo produto</Button>}
      </PageHeader>

      <div className="mb-4 grid gap-2 md:grid-cols-[1fr_180px_180px]">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar por nome, SKU ou código de barras" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select value={fCat} onValueChange={setFCat}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas categorias</SelectItem>{cat?.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
        <Select value={fBrand} onValueChange={setFBrand}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas marcas</SelectItem>{cat?.brands.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
      </div>

      {isLoading ? <p className="text-muted-foreground">Carregando…</p> : list.length === 0 ? <Card className="p-10 text-center text-muted-foreground">Nenhum produto encontrado.</Card> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const low = Number(p.stock) <= Number(p.min_stock);
            return (
              <Card key={p.id} className={`p-4 ${me?.isManager ? "cursor-pointer hover:shadow-soft" : ""} transition`} onClick={() => me?.isManager && setForm({
                id: p.id, name: p.name, variant: p.variant ?? "", sku: p.sku ?? "", barcode: p.barcode ?? "", brand_id: p.brand_id ?? "", category_id: p.category_id ?? "",
                supplier_id: p.supplier_id ?? "", cost_price: String(p.cost_price), sale_price: String(p.sale_price), min_stock: String(p.min_stock), unit: p.unit, description: p.description ?? "", active: p.active,
              })}>
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name} {p.variant && <span className="text-muted-foreground font-normal">· {p.variant}</span>}</div>
                    <div className="text-xs text-muted-foreground">{p.brands?.name} · {p.categories?.name} · {p.sku}</div>
                  </div>
                  {!p.active && <Badge variant="secondary">Inativo</Badge>}
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="font-display text-2xl font-semibold">{money(p.sale_price)}</div>
                    <div className="text-xs text-muted-foreground">custo {money(p.cost_price)} · margem {margin(Number(p.cost_price), Number(p.sale_price)).toFixed(0)}%</div>
                  </div>
                  <Badge variant={low ? "destructive" : "outline"}>{Number(p.stock)} {p.unit}</Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">{form?.id ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader>
          {form && (
            <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <div className="col-span-2 space-y-1"><Label>Nome</Label><Input required value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="space-y-1"><Label>Variação (cor, tom, ml)</Label><Input value={form.variant} onChange={(e) => set("variant", e.target.value)} /></div>
              <div className="space-y-1"><Label>Unidade</Label><Input value={form.unit} onChange={(e) => set("unit", e.target.value)} /></div>
              <div className="space-y-1"><Label>SKU</Label><Input value={form.sku} onChange={(e) => set("sku", e.target.value)} /></div>
              <div className="space-y-1"><Label>Código de barras</Label><Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} /></div>
              <div className="space-y-1"><Label>Marca</Label>
                <Select value={form.brand_id} onValueChange={(v) => set("brand_id", v)}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{cat?.brands.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Categoria</Label>
                <Select value={form.category_id} onValueChange={(v) => set("category_id", v)}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{cat?.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="col-span-2 space-y-1"><Label>Fornecedor</Label>
                <Select value={form.supplier_id} onValueChange={(v) => set("supplier_id", v)}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{cat?.suppliers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Preço de custo</Label><Input type="number" step="0.01" min="0" value={form.cost_price} onChange={(e) => set("cost_price", e.target.value)} /></div>
              <div className="space-y-1"><Label>Preço de venda</Label><Input type="number" step="0.01" min="0" value={form.sale_price} onChange={(e) => set("sale_price", e.target.value)} /></div>
              <div className="col-span-2 rounded-lg bg-muted px-3 py-2 text-sm">Margem de lucro: <b>{margin(Number(form.cost_price), Number(form.sale_price)).toFixed(1)}%</b></div>
              <div className="space-y-1"><Label>Estoque mínimo</Label><Input type="number" min="0" value={form.min_stock} onChange={(e) => set("min_stock", e.target.value)} /></div>
              <div className="flex items-center gap-2 pt-6"><Switch checked={form.active} onCheckedChange={(v) => set("active", v)} /><Label>Ativo</Label></div>
              <div className="col-span-2 space-y-1"><Label>Descrição</Label><Input value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
              {!form.id && <p className="col-span-2 text-xs text-muted-foreground">O estoque inicial é lançado na tela Estoque → Entrada.</p>}
              <Button className="col-span-2" disabled={save.isPending}>Salvar</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
