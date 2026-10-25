import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { ViewingPatch } from "@/api/types";
import { useSession } from "@/features/auth/useSession";
import { qk } from "@/lib/queryKeys";

const useUid = () => useSession().data?.userId ?? "";
const opts = { staleTime: 10_000 };
export const useAdminPayouts = () => { const u = useUid(); return useQuery({ queryKey: [...qk.admin.all(u), "payouts"], queryFn: () => api.admin.payouts(), enabled: !!u, ...opts }); };

export const useAdminLandlords = () => { const u = useUid(); return useQuery({ queryKey: qk.admin.landlords(u), queryFn: () => api.admin.landlords(), enabled: !!u, ...opts }); };
export const useAdminKyc = () => { const u = useUid(); return useQuery({ queryKey: qk.admin.kyc(u), queryFn: () => api.admin.kycQueue(), enabled: !!u, ...opts }); };
export const useAdminPayments = () => { const u = useUid(); return useQuery({ queryKey: qk.admin.payments(u), queryFn: () => api.admin.payments(), enabled: !!u, ...opts }); };
export const useAdminCelcom = () => { const u = useUid(); return useQuery({ queryKey: qk.admin.celcom(u), queryFn: () => api.admin.celcom(), enabled: !!u, ...opts }); };
export const useAdminViewings = () => { const u = useUid(); return useQuery({ queryKey: qk.admin.viewings(u), queryFn: () => api.admin.viewings(), enabled: !!u, ...opts }); };

/** Signed links last one minute, so they are fetched only when the admin opens a submission. */
export const useKycFileUrl = (path: string | null) =>
  useQuery({ queryKey: ["admin", "kyc-file", path], queryFn: () => api.admin.kycFileUrl(path!), enabled: !!path, staleTime: 45_000, gcTime: 60_000 });

function useAdminMutation<V>(fn: (v: V) => Promise<void>, refresh: ("landlords" | "kyc" | "payments" | "celcom" | "viewings" | "payouts")[]) {
  const qc = useQueryClient();
  const u = useUid();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(refresh.map((k) => qc.invalidateQueries({ queryKey: k === "payouts" ? [...qk.admin.all(u), "payouts"] : qk.admin[k](u) }))),
  });
}

export const useReviewKyc = () => useAdminMutation((v: { id: string; approve: boolean; reason?: string }) => api.admin.reviewKyc(v.id, v.approve, v.reason), ["kyc", "landlords"]);
export const useSuspend = () => useAdminMutation((v: { id: string; reason: string }) => api.admin.suspend(v.id, v.reason), ["landlords"]);
export const useResume = () => useAdminMutation((v: { id: string; ref: string; amount: number }) => api.admin.resume(v.id, v.ref, v.amount), ["landlords", "payments"]);
export const useSendReminder = () => useAdminMutation((id: string) => api.admin.sendReminder(id), ["landlords", "celcom"]);
export const useTopup = () => useAdminMutation((v: { amount: number; ref: string }) => api.admin.celcomTopup(v.amount, v.ref), ["celcom"]);
export const useUpdateViewing = () => useAdminMutation((v: { id: string; patch: ViewingPatch }) => api.admin.updateViewing(v.id, v.patch), ["viewings"]);
export const useMarkPayoutPaid = () => useAdminMutation((v: { id: string; ref: string }) => api.admin.markPayoutPaid(v.id, v.ref), ["payouts"]);
