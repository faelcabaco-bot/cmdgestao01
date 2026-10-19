import type { ReactNode } from "react";
import { Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Package, Boxes, ShoppingBag, Wallet, Users, UserRound, LogOut, ChevronRight, History, BookOpen } from "lucide-react";
import { Brand } from "@/components/Brand";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/pdv", label: "PDV", icon: ShoppingBag },
  { to: "/caixa", label: "Caixa", icon: Wallet },
  { to: "/vendas", label: "Vendas", icon: History },
  { to: "/fiado", label: "Fiado", icon: BookOpen, managerOnly: true },
  { to: "/clientes", label: "Clientes", icon: UserRound },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/estoque", label: "Estoque", icon: Boxes },
] as const;

const ROLE_LABEL = { admin: "Administrador", gerente: "Gerente", vendedor: "Vendedor/Caixa" };

export function AppShell() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPage = NAV.find((n) => n.to === location.pathname)?.label ?? "Usuários";
  const visibleNav = NAV.filter((n) => !("managerOnly" in n) || me?.isManager);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden md:flex md:w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground sticky top-0 h-screen">
        <div className="px-5 py-7">
          <Brand />
        </div>
        <div className="px-6 pt-5 pb-3 text-[10px] font-semibold text-sidebar-foreground/45">PRINCIPAL</div>
        <nav className="flex-1 space-y-1.5 px-3">
          {visibleNav.map((n) => (
            <Link key={n.to} to={n.to}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary font-semibold" }}>
              <n.icon className="h-4 w-4" />{n.label}
            </Link>
          ))}
          {me?.isAdmin && (
            <Link to="/usuarios" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary font-semibold" }}>
              <Users className="h-4 w-4" />Usuários
            </Link>
          )}
        </nav>
        <div className="border-t border-sidebar-border p-4 text-sm">
          <div className="flex items-center gap-3"><span className="size-9 shrink-0 rounded-full bg-sidebar-accent text-sidebar-primary flex items-center justify-center font-semibold">{me?.profile?.full_name?.slice(0, 1).toUpperCase() ?? "C"}</span><div className="min-w-0"><div className="font-semibold truncate">{me?.profile?.full_name}</div><div className="text-[11px] text-sidebar-foreground/50">{me ? ROLE_LABEL[me.role] : ""}</div></div></div>
          <Button variant="ghost" onClick={signOut} className="mt-3 w-full justify-start text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-primary"><LogOut />Sair da conta</Button>
        </div>
      </aside>

      <header className="md:hidden flex items-center justify-between bg-sidebar text-sidebar-foreground px-4 py-3">
        <Brand />
        <div className="flex items-center gap-1">
          {me?.isAdmin && <Link to="/usuarios"><Button size="icon" variant="ghost"><Users className="h-4 w-4" /></Button></Link>}
          <Button size="icon" variant="ghost" onClick={signOut} aria-label="Sair"><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>

      <div className="flex-1 min-w-0">
      <div className="hidden md:flex h-[73px] items-center justify-between border-b bg-card px-8"><div className="flex items-center gap-3 text-xs text-muted-foreground"><span>CMD Gestão</span><ChevronRight className="size-3" /><span className="font-semibold text-foreground">{currentPage}</span></div><div className="text-xs text-muted-foreground">{me ? ROLE_LABEL[me.role] : ""}</div></div>
      <main className="min-w-0 p-4 pb-28 md:p-8 md:pb-8 max-w-[1600px] mx-auto">
        <Outlet />
      </main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 sm:grid-cols-8 border-t bg-card">
        {visibleNav.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground"
            activeProps={{ className: "text-primary font-semibold" }}>
            <n.icon className="h-5 w-5" />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
