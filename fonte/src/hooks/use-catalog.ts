import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: async () => {
      const [b, c, s] = await Promise.all([
        supabase.from("brands").select("*").order("name"),
        supabase.from("categories").select("*").order("name"),
        supabase.from("suppliers").select("*").order("name"),
      ]);
      return { brands: b.data ?? [], categories: c.data ?? [], suppliers: s.data ?? [] };
    },
  });
}

