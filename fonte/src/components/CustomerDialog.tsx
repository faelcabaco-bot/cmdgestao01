import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatCpfCnpj, formatPhone, isValidDocument, onlyDigits } from "@/lib/documents";

export type Customer = Tables<"customers">;

type Form = { name: string; phone: string; cpf: string; email: string; birthday: string; address: string; notes: string };
const empty: Form = { name: "", phone: "", cpf: "", email: "", birthday: "", address: "", notes: "" };

function toForm(c?: Customer | null): Form {
  if (!c) return empty;
  return {
    name: c.name, phone: c.phone ? formatPhone(c.phone) : "", cpf: c.cpf ? formatCpfCnpj(c.cpf) : "",
    email: c.email ?? "", birthday: c.birthday ?? "", address: c.address ?? "", notes: c.notes ?? "",
  };
}

function validate(f: Form): string | null {
  if (f.name.trim().length < 2) return "Informe o nome do cliente";
  if (f.phone && ![10, 11].includes(onlyDigits(f.phone).length)) return "Telefone inválido (use DDD + número)";
  if (f.cpf && !isValidDocument(f.cpf)) return "CPF/CNPJ inválido";
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "E-mail inválido";
  return null;
}

export function CustomerDialog({ open, onOpenChange, customer, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; customer?: Customer | null; onSaved?: (c: Customer) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { if (open) setForm(toForm(customer)); }, [open, customer]);

  const save = useMutation({
    mutationFn: async () => {
      const problem = validate(form);
      if (problem) throw new Error(problem);
      const cpf = form.cpf ? formatCpfCnpj(form.cpf) : null;

      if (cpf) {
        const { data: dup } = await supabase.from("customers").select("id, name").eq("cpf", cpf).limit(1);
        if (dup?.[0] && dup[0].id !== customer?.id) throw new Error(`Este CPF/CNPJ já está cadastrado para ${dup[0].name}`);
      }

      const row = {
        name: form.name.trim(),
        phone: form.phone ? formatPhone(form.phone) : null,
        cpf,
        email: form.email.trim() || null,
        birthday: form.birthday || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      };
      const q = customer
        ? supabase.from("customers").update(row).eq("id", customer.id)
        : supabase.from("customers").insert(row);
      const { data, error } = await q.select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (c) => {
      toast.success(customer ? "Cliente atualizado" : "Cliente cadastrado");
      qc.invalidateQueries({ queryKey: ["customers"] });
      onOpenChange(false);
      onSaved?.(c);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{customer ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>Só o nome é obrigatório. Os outros campos ajudam em fiado, recibo e contato.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Nome *</Label>
            <Input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label>Telefone / WhatsApp</Label>
            <Input inputMode="tel" placeholder="(00) 00000-0000" value={form.phone} onChange={(e) => set("phone", formatPhone(e.target.value))} />
          </div>
          <div>
            <Label>CPF / CNPJ</Label>
            <Input inputMode="numeric" placeholder="000.000.000-00" value={form.cpf} onChange={(e) => set("cpf", formatCpfCnpj(e.target.value))} />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <Label>Data de nascimento</Label>
            <Input type="date" value={form.birthday} onChange={(e) => set("birthday", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Endereço</Label>
            <Input placeholder="Rua, número, bairro, cidade" value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Observações</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <Button size="lg" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Salvando…" : customer ? "Salvar alterações" : "Cadastrar cliente"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
