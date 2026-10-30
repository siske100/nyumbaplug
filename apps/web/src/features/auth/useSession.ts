import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import type { Role } from "@/api/types";
import { qk } from "@/lib/queryKeys";

export const homeFor = (role: Role) => (role === "landlord" ? "/landlord" : role === "admin" ? "/admin" : "/tenant");

export function useSession() {
  return useQuery({ queryKey: qk.session, queryFn: () => api.getSession(), staleTime: 5 * 60_000, retry: false });
}

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.signOut(),
    onSettled: () => {
      qc.clear(); // nothing from this account may survive in memory
      navigate("/sign-in", { replace: true });
    },
  });
}
