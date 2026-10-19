import { pageMeta } from "@/lib/page-meta";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  head: () => pageMeta("Nova senha", "Defina uma nova senha de acesso à CMD Gestão."),
  component: Reset,
});

function Reset() {
  const [pw, setPw] = useState("");
  const navigate = useNavigate();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { toast.error(error.message); return; }
    toast.success("Senha alterada!");
    navigate({ to: "/dashboard" });
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={save} className="w-full max-w-sm space-y-4">
        <h1 className="text-4xl font-semibold">Nova senha</h1>
        <Input type="password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nova senha" />
        <Button className="w-full">Salvar</Button>
      </form>
    </div>
  );
}
