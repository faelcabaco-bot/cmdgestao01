import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe, type Role } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => pageMeta("Usuários", "Gestão de usuários e perfis de acesso."),
  component: Usuarios,
});

function Usuarios() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"gerente" | "vendedor">("vendedor");
  const { data } = useQuery({
    queryKey: ["users-admin"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const [p, r] = await Promise.all([supabase.from("profiles").select("*").order("full_name"), supabase.from("user_roles").select("*")]);
      return (p.data ?? []).map((u) => ({ ...u, role: (r.data ?? []).find((x) => x.user_id === u.id)?.role as Role | undefined }));
    },
  });
  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) => {
      const del = await supabase.from("user_roles").delete().eq("user_id", id);
      if (del.error) throw del.error;
      const ins = await supabase.from("user_roles").insert({ user_id: id, role });
      if (ins.error) throw ins.error;
    },
    onSuccess: () => { toast.success("Perfil atualizado"); qc.invalidateQueries({ queryKey: ["users-admin"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const createUser = useMutation({
    mutationFn: async () => {
      const result = await supabase.auth.createUser({ email, password, full_name: fullName, role });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      toast.success("Funcionário criado. Compartilhe a senha inicial com ele.");
      setFullName("");
      setEmail("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["users-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!me?.isAdmin) return <p className="text-muted-foreground">Somente administradores acessam esta tela.</p>;

  return (
    <div>
      <PageHeader title="Usuários" subtitle="Gerencie somente os acessos da sua empresa." />
      <Card className="mb-6 p-4">
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => { event.preventDefault(); createUser.mutate(); }}>
          <div className="space-y-2"><Label htmlFor="staff-name">Nome</Label><Input id="staff-name" required value={fullName} onChange={(event) => setFullName(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="staff-email">E-mail de acesso</Label><Input id="staff-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="staff-password">Senha inicial (mín. 8 caracteres)</Label><Input id="staff-password" type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="staff-role">Perfil</Label><Select value={role} onValueChange={(value) => setRole(value as "gerente" | "vendedor")}><SelectTrigger id="staff-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gerente">Gerente</SelectItem><SelectItem value="vendedor">Vendedor/Caixa</SelectItem></SelectContent></Select></div>
          <Button className="self-end" type="submit" disabled={createUser.isPending}>{createUser.isPending ? "Criando..." : "Adicionar funcionário"}</Button>
        </form>
      </Card>
      <Card className="divide-y">
        {data?.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div><div className="font-medium">{u.full_name}</div><div className="text-xs text-muted-foreground">{u.email}</div></div>
            <Select value={u.role ?? ""} disabled={u.id === me.user.id} onValueChange={(v) => updateRole.mutate({ id: u.id, role: v as Role })}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Sem perfil" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="gerente">Gerente</SelectItem>
                <SelectItem value="vendedor">Vendedor/Caixa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </Card>
    </div>
  );
}
