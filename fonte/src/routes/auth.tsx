import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, LoaderCircle, Mail, LockKeyhole, UserRound } from "lucide-react";
import { Brand } from "@/components/Brand";
import { pageMeta } from "@/lib/page-meta";
import cosmeticsPhoto from "@/assets/cmd-cosmetics.jpg";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => pageMeta("Entrar", "Acesse a CMD Gestão e gerencie estoque, vendas e caixa da sua loja de cosméticos."),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin, data: { full_name: name, company_name: companyName } },
        });
        if (error) throw error;
        toast.success("Loja cadastrada! Entre com seu e-mail e senha.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        toast.success("Enviamos um link para redefinir sua senha.");
        setMode("login");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      toast.error(msg.includes("Invalid login") ? "E-mail ou senha incorretos" : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1fr] bg-card">
      <section className="relative hidden lg:flex flex-col overflow-hidden bg-sidebar text-auth-foreground">
        <img src={cosmeticsPhoto} alt="Cosméticos e produtos de cuidados com a pele" width={1024} height={1536} className="auth-photo absolute inset-0 size-full object-cover" />
        <div className="auth-photo-overlay absolute inset-0" />
        <div className="relative z-10 p-10 xl:p-14"><Brand /></div>
        <div className="relative z-10 px-10 xl:px-14 pt-6">
          <div className="mb-5 flex items-center gap-3 text-xs font-medium"><span className="h-px w-8 bg-sidebar-primary" />SUA LOJA. SEU CONTROLE.</div>
          <h1 className="font-display text-5xl xl:text-6xl font-medium leading-[1.1]">CMD Gestão<span className="block mt-3 text-sidebar-primary text-3xl xl:text-4xl">Tudo em equilíbrio.</span></h1>
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-auth-foreground/80">Estoque, vendas e caixa conectados ao dia a dia da sua loja.</p>
        </div>
        <div className="relative z-10 mt-auto px-10 xl:px-14 pb-8 text-xs text-auth-foreground/70">Gestão para lojas de cosméticos</div>
      </section>
      <section className="min-h-screen flex flex-col px-6 sm:px-12 xl:px-20">
        <div className="py-7 lg:py-10 flex items-center justify-between"><div className="lg:hidden"><Brand /></div><span className="ml-auto text-xs text-muted-foreground">CMD Gestão / Acesso</span></div>
        <div className="flex flex-1 items-center justify-center py-10">
          <form onSubmit={submit} className="w-full max-w-[380px] space-y-6">
            <div className="mb-8">
              <span className="inline-flex size-11 items-center justify-center rounded-lg bg-accent text-primary mb-6"><LockKeyhole className="size-5" /></span>
              <h2 className="text-3xl font-semibold">{mode === "login" ? "Bem-vindo de volta" : mode === "signup" ? "Crie sua conta" : "Recuperar senha"}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{mode === "login" ? "Entre na sua conta para continuar." : mode === "signup" ? "Cadastre sua loja para começar." : "Informe seu e-mail para receber o link de recuperação."}</p>
            </div>
            {mode === "signup" && <div className="space-y-2"><Label htmlFor="auth-company">Nome da loja ou empresa</Label><Input id="auth-company" autoComplete="organization" placeholder="Nome da sua loja" className="h-11 bg-background/50" required maxLength={190} value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>}
            {mode === "signup" && <div className="space-y-2"><Label htmlFor="auth-name">Nome completo</Label><div className="relative"><UserRound className="absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input id="auth-name" autoComplete="name" placeholder="Seu nome" className="h-11 pl-10 bg-background/50" required value={name} onChange={(e) => setName(e.target.value)} /></div></div>}
            <div className="space-y-2"><Label htmlFor="auth-email">E-mail</Label><div className="relative"><Mail className="absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input id="auth-email" type="email" autoComplete="email" placeholder="seu@email.com" className="h-11 pl-10 bg-background/50" required value={email} onChange={(e) => setEmail(e.target.value)} /></div></div>
            {mode !== "forgot" && <div className="space-y-2"><div className="flex items-center justify-between gap-2"><Label htmlFor="auth-password">Senha</Label>{mode === "login" && <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setMode("forgot")}>Esqueci minha senha</Button>}</div><div className="relative"><LockKeyhole className="absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="Sua senha" className="h-11 pl-10 pr-11 bg-background/50" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /><Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 text-muted-foreground" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff /> : <Eye />}</Button></div></div>}
            <Button className="w-full h-11 font-semibold justify-between px-4" size="lg" disabled={busy}><span>{busy ? "Aguarde..." : mode === "login" ? "Entrar na minha conta" : mode === "signup" ? "Criar conta" : "Enviar link"}</span>{busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}</Button>
            <div className="border-t pt-6 text-center text-sm text-muted-foreground">{mode === "login" ? <>Ainda não tem uma conta? <Button type="button" variant="link" className="h-auto px-1 py-0 font-semibold" onClick={() => setMode("signup")}>Criar conta</Button></> : <Button type="button" variant="link" className="h-auto p-0" onClick={() => setMode("login")}>Voltar para entrar</Button>}</div>
          </form>
        </div>
        <footer className="py-6 text-center text-xs text-muted-foreground">CMD Gestão · Sua operação, em boas mãos.</footer>
      </section>
    </div>
  );
}
