import { Command } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Command className="size-5" strokeWidth={2.2} /></span>
      {!compact && <span className="font-display text-xl font-semibold">CMD <span className="font-normal opacity-75">Gestão</span></span>}
    </div>
  );
}