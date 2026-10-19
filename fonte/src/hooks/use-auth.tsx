import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "gerente" | "vendedor";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      const list = (roles ?? []).map((r) => r.role as Role);
      const role: Role = list.includes("admin") ? "admin" : list.includes("gerente") ? "gerente" : "vendedor";
      return { user, profile, role, isAdmin: role === "admin", isManager: role !== "vendedor" };
    },
    staleTime: 60_000,
  });
}
