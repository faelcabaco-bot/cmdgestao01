import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money, dateTime, PAY_LABEL } from "@/lib/format";
import { useMe } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/caixa")({
  head: () => pageMeta("Caixa", "Abertura, sangria, suprimento e fechamento de caixa."),
  component: Caixa,
});

type RegisterRow = { id: string; opened_at: string; closed_at: string | null; opening_amount: number; expected_amount: number | null; counted_amount: number | null };
type SaleRow = { id: string; number: number; created_at: string; status: string; total: number; change_amount: number; sale_payments: { method: string; amount: number }[] };
type CashMovementRow = { id: string; type: string; amount: number; reason: string };
type CreditPaymentRow = { id: string; amount: number; method: string; created_at: string; customers: { name: string } | null };
type RegisterData = { reg: RegisterRow | null; history: RegisterRow[]; sales: SaleRow[]; movs: CashMovementRow[]; creditPayments: CreditPaymentRow[] };

function Caixa() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [opening, setOpening] = useState("100");
  const [movDlg, setMovDlg] = useState<null | "sangria" | "suprimento">(null);
  const [movAmt, setMovAmt] = useState("");
  const [movReason, setMovReason] = useState("");
  const [closeDlg, setCloseDlg] = useState(false);
  const [counted, setCounted] = useState("");
  const [cancelSale, setCancelSale] = useState<{ id: string; number: number } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelPwd, setCancelPwd] = useState("");
  const [pwdDlg, setPwdDlg] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");

  const { data: hasPwd } = useQuery({
    queryKey: ["cancel-pwd-set"],
    enabled: !!me?.isManager,
    queryFn: async () => (await supabase.rpc("has_cancel_password")).data ?? false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["register-detail", me?.user.id],
    enabled: !!me,
    queryFn: async () => {
      const { data: reg } = await supabase.from("cash_registers").select("*").eq("user_id", me!.user.id).eq("status", "aberto").maybeSingle();
      const history = (await supabase.from("cash_registers").select("*").eq("status", "fechado").order("closed_at", { ascending: false }).limit(20)).data ?? [];
      if (!reg) return { reg: null, history, sales: [], movs: [], creditPayments: [] };
      const [sales, movs, creditPayments] = await Promise.all([
        supabase.from("sales").select("*, sale_payments(*)").eq("register_id", reg.id).order("created_at", { ascending: false }),
        supabase.from("cash_movements").select("*").eq("register_id", reg.id).order("created_at", { ascending: false }),
        supabase.from("customer_credit_payments").select("*, customers(name)").eq("register_id", reg.id).order("created_at", { ascending: false }),
      ]);
      return { reg, history, sales: sales.data ?? [], movs: movs.data ?? [], creditPayments: creditPayments.data ?? [] };
    },
  });
  const refresh = () => ["register-detail", "my-register", "dashboard", "products"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const open = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("cash_registers").insert({ user_id: me!.user.id, opening_amount: Number(opening) || 0 });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Caixa aberto"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const addMov = useMutation({
    mutationFn: async () => {
      if (!movReason.trim()) throw new Error("Informe o motivo");
      const { error } = await supabase.from("cash_movements").insert({ register_id: data!.reg!.id, type: movDlg!, amount: Number(movAmt), reason: movReason, user_id: me!.user.id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Registrado"); setMovDlg(null); setMovAmt(""); setMovReason(""); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_register", { _register_id: data!.reg!.id, _counted: Number(counted), _notes: "" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Caixa fechado"); setCloseDlg(false); setCounted(""); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: async () => {
      const { data: res, error } = await supabase.rpc("cancel_sale_authorized", { _sale_id: cancelSale!.id, _reason: cancelReason, _password: cancelPwd });
      if (error) throw error;
      if (res === "senha_incorreta") throw new Error("Senha incorreta");
      if (res === "bloqueado") throw new Error("Muitas tentativas erradas. Aguarde 5 minutos e tente de novo.");
      if (res === "sem_senha") throw new Error("O gerente ainda não definiu a senha de cancelamento. Use o botão “Senha de cancelamento”.");
    },
    onSuccess: () => { toast.success("Venda cancelada e estoque estornado"); closeCancel(); refresh(); },
    onError: (e: Error) => { setCancelPwd(""); toast.error(e.message); },
  });
  const savePwd = useMutation({
    mutationFn: async () => {
      if (hasPwd && !currentPwd) throw new Error("Informe a senha atual");
      if (newPwd.trim().length < 4) throw new Error("A senha precisa ter pelo menos 4 caracteres");
      if (newPwd !== newPwd2) throw new Error("As senhas não conferem");
      const { error } = await supabase.rpc("set_cancel_password", { _current_password: currentPwd, _password: newPwd });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Senha de cancelamento salva"); setPwdDlg(false); setCurrentPwd(""); setNewPwd(""); setNewPwd2(""); qc.invalidateQueries({ queryKey: ["cancel-pwd-set"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  function closeCancel() { setCancelSale(null); setCancelReason(""); setCancelPwd(""); }

  if (isLoading || !data) return <p className="text-muted-foreground">Carregando…</p>;

  const { reg, sales, movs, history, creditPayments } = data as RegisterData;
  const done = sales.filter((s) => s.status === "concluida");
  const byMethod: Record<string, number> = {};
  done.forEach((s) => s.sale_payments.forEach((p) => { byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount); }));
  creditPayments.forEach((p) => { byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount); });
  const change = done.reduce((t, s) => t + Number(s.change_amount), 0);
  const creditCash = creditPayments.filter((p) => p.method === "dinheiro").reduce((t, p) => t + Number(p.amount), 0);
  const sup = movs.filter((m) => m.type === "suprimento").reduce((t, m) => t + Number(m.amount), 0);
  const sang = movs.filter((m) => m.type === "sangria").reduce((t, m) => t + Number(m.amount), 0);
  const saleCash = done.reduce((t, s) => t + s.sale_payments.filter((p) => p.method === "dinheiro").reduce((n, p) => n + Number(p.amount), 0), 0);
  const expected = reg ? Number(reg.opening_amount) + saleCash + creditCash - change + sup - sang : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Caixa" subtitle={reg ? `Aberto em ${dateTime(reg.opened_at)}` : "Nenhum caixa aberto"}>
        {me?.isManager && <Button variant="outline" onClick={() => setPwdDlg(true)}><KeyRound className="h-4 w-4" />Senha de cancelamento</Button>}
        {reg && <>
          <Button variant="outline" onClick={() => setMovDlg("suprimento")}>Suprimento</Button>
          <Button variant="outline" onClick={() => setMovDlg("sangria")}>Sangria</Button>
          <Button onClick={() => { setCounted(expected.toFixed(2)); setCloseDlg(true); }}>Fechar caixa</Button>
        </>}
      </PageHeader>

      {!reg ? (
        <Card className="max-w-sm p-6 space-y-3">
          <h2 className="text-2xl font-semibold">Abrir caixa</h2>
          <Label>Fundo de troco (R$)</Label>
          <Input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} />
          <Button className="w-full" onClick={() => open.mutate()} disabled={open.isPending}>Abrir caixa</Button>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Fundo inicial" value={money(reg.opening_amount)} />
            <Stat label="Vendas" value={money(done.reduce((t, s) => t + Number(s.total), 0))} sub={`${done.length} vendas`} />
            <Stat label="Sangria / Suprimento" value={`-${money(sang)} / +${money(sup)}`} />
            <Stat label="Dinheiro esperado" value={money(expected)} highlight />
          </div>
          <Card className="p-5">
            <h3 className="text-xl font-semibold mb-2">Por forma de pagamento</h3>
            <div className="flex flex-wrap gap-2">{Object.entries(byMethod).map(([k, v]) => <Badge key={k} variant="secondary" className="text-sm py-1">{PAY_LABEL[k]}: {money(v)}</Badge>)}{!Object.keys(byMethod).length && <span className="text-sm text-muted-foreground">Sem vendas ainda.</span>}</div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="text-xl font-semibold mb-2">Vendas deste caixa</h3>
              <div className="divide-y text-sm">
                {sales.length === 0 && <p className="text-muted-foreground">Nenhuma venda.</p>}
                {sales.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2 gap-2">
                    <div><b>#{s.number}</b> · {dateTime(s.created_at)} {s.status === "cancelada" && <Badge variant="destructive">Cancelada</Badge>}</div>
                    <div className="flex items-center gap-2">
                      <span className={s.status === "cancelada" ? "line-through text-muted-foreground" : "font-semibold"}>{money(s.total)}</span>
                      {s.status === "concluida" && me?.isManager && <Button size="sm" variant="ghost" onClick={() => setCancelSale({ id: s.id, number: s.number })}>Cancelar</Button>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="text-xl font-semibold mb-2">Sangrias e suprimentos</h3>
              <div className="divide-y text-sm">
                {movs.length === 0 && <p className="text-muted-foreground">Nenhum registro.</p>}
                {movs.map((m) => <div key={m.id} className="flex justify-between py-2"><span>{m.type === "sangria" ? "Sangria" : "Suprimento"} · {m.reason}</span><b className={m.type === "sangria" ? "text-destructive" : "text-success"}>{money(m.amount)}</b></div>)}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="text-xl font-semibold mb-2">Recebimentos de fiado</h3>
              <div className="divide-y text-sm">
                {creditPayments.length === 0 && <p className="text-muted-foreground">Nenhum recebimento neste caixa.</p>}
                {creditPayments.map((p) => <div key={p.id} className="flex justify-between gap-3 py-2"><span className="min-w-0 truncate">{p.customers?.name} · {dateTime(p.created_at)} · {PAY_LABEL[p.method]}</span><b>{money(p.amount)}</b></div>)}
              </div>
            </Card>
          </div>
        </>
      )}

      <Card className="p-5">
        <h3 className="text-xl font-semibold mb-2">Histórico de fechamentos</h3>
        <div className="divide-y text-sm">
          {history.length === 0 && <p className="text-muted-foreground">Nenhum caixa fechado ainda.</p>}
          {history.map((h) => {
            const diff = Number(h.counted_amount) - Number(h.expected_amount);
            return (
              <div key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{dateTime(h.opened_at)} → {h.closed_at && dateTime(h.closed_at)}</span>
                <span>Esperado {money(h.expected_amount)} · Contado {money(h.counted_amount)} · <b className={diff < 0 ? "text-destructive" : diff > 0 ? "text-success" : ""}>{diff === 0 ? "Sem diferença" : diff > 0 ? `Sobra ${money(diff)}` : `Falta ${money(-diff)}`}</b></span>
              </div>
            );
          })}
        </div>
      </Card>

      <Dialog open={!!movDlg} onOpenChange={(o) => !o && setMovDlg(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-2xl">{movDlg === "sangria" ? "Sangria (retirada)" : "Suprimento (entrada)"}</DialogTitle></DialogHeader>
          <Label>Valor</Label><Input type="number" step="0.01" value={movAmt} onChange={(e) => setMovAmt(e.target.value)} />
          <Label>Motivo *</Label><Input value={movReason} onChange={(e) => setMovReason(e.target.value)} />
          <Button onClick={() => addMov.mutate()} disabled={addMov.isPending || !(Number(movAmt) > 0)}>Confirmar</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDlg} onOpenChange={setCloseDlg}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-2xl">Fechar caixa</DialogTitle></DialogHeader>
          <p className="text-sm">Dinheiro esperado: <b>{money(expected)}</b></p>
          <Label>Valor contado em dinheiro</Label>
          <Input type="number" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
          {counted !== "" && (() => { const d = Number(counted) - expected; return <p className={`text-sm font-semibold ${d < 0 ? "text-destructive" : d > 0 ? "text-success" : ""}`}>{Math.abs(d) < 0.005 ? "Sem diferença" : d > 0 ? `Sobra de ${money(d)}` : `Falta de ${money(-d)}`}</p>; })()}
          <Button onClick={() => close.mutate()} disabled={close.isPending}>Confirmar fechamento</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelSale} onOpenChange={(o) => !o && closeCancel()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-2xl">Cancelar venda #{cancelSale?.number}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Os produtos voltam para o estoque. Esta ação fica registrada.</p>
          <Label>Motivo *</Label><Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <Label>Senha de autorização do gerente *</Label>
          <Input type="password" autoComplete="off" value={cancelPwd} onChange={(e) => setCancelPwd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && cancelReason.trim() && cancelPwd && !cancel.isPending && cancel.mutate()} />
          {hasPwd === false && <p className="text-xs text-destructive">Nenhuma senha definida ainda. Clique em “Senha de cancelamento” no topo da tela para criar.</p>}
          <Button variant="destructive" disabled={!cancelReason.trim() || !cancelPwd || cancel.isPending} onClick={() => cancel.mutate()}>Cancelar venda</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={pwdDlg} onOpenChange={(o) => { setPwdDlg(o); if (!o) { setCurrentPwd(""); setNewPwd(""); setNewPwd2(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-2xl">Senha de cancelamento</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {hasPwd ? "Confirme a senha atual para definir uma nova." : "Defina a senha que será exigida para cancelar qualquer venda."}
            {" "}Ela fica guardada de forma protegida e não pode ser consultada depois.
          </p>
          {hasPwd && <><Label>Senha atual</Label><Input type="password" autoComplete="current-password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} /></>}
          <Label>Nova senha</Label><Input type="password" autoComplete="new-password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          <Label>Repita a senha</Label><Input type="password" autoComplete="new-password" value={newPwd2} onChange={(e) => setNewPwd2(e.target.value)} />
          <Button disabled={savePwd.isPending || (hasPwd === true && !currentPwd) || !newPwd || !newPwd2} onClick={() => savePwd.mutate()}>Salvar senha</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={`p-4 ${highlight ? "bg-brand text-primary-foreground" : ""}`}>
      <div className={`text-xs uppercase tracking-wider ${highlight ? "opacity-90" : "text-muted-foreground"}`}>{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs opacity-70">{sub}</div>}
    </Card>
  );
}
