import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search, Pencil, Phone, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { CustomerDialog, type Customer } from "@/components/CustomerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { onlyDigits } from "@/lib/documents";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => pageMeta("Clientes", "Cadastro de clientes para vendas, fiado e contato."),
  component: Clientes,
});

function Clientes() {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await supabase.from("customers").select("*").order("name")).data ?? [],
  });

  const t = q.trim().toLowerCase();
  const digits = onlyDigits(q);
  const list = (customers ?? []).filter((c) =>
    !t || c.name.toLowerCase().includes(t) || c.email?.toLowerCase().includes(t)
      || (digits && (onlyDigits(c.phone ?? "").includes(digits) || onlyDigits(c.cpf ?? "").includes(digits))));

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(c: Customer) { setEditing(c); setOpen(true); }

  return (
    <div>
      <PageHeader title="Clientes" subtitle={`${customers?.length ?? 0} cadastrados`}>
        <Button onClick={openNew}><Plus className="h-4 w-4" />Novo cliente</Button>
      </PageHeader>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome, telefone, CPF/CNPJ ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card className="divide-y">
        {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && list.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">{customers?.length ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}</p>
        )}
        {list.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{c.name}</span>
                {c.points > 0 && <Badge variant="secondary">{c.points} pts</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {c.cpf && <span>{c.cpf}</span>}
                {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                {c.address && <span className="inline-flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" />{c.address}</span>}
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => openEdit(c)} title="Editar"><Pencil className="h-4 w-4" /></Button>
          </div>
        ))}
      </Card>

      <CustomerDialog open={open} onOpenChange={setOpen} customer={editing} />
    </div>
  );
}
