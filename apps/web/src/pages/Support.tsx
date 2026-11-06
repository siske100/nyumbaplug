import { api } from "@/api";
import { SupportForm } from "@/components/shared/SupportForm";
import { Chip } from "@/components/ui/Chip";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useSession } from "@/features/auth/useSession";
import { useLive } from "@/features/live";
import { fmtDate } from "@/lib/format";

export default function Support() {
  const session = useSession().data;
  const scope = session?.role ?? "tenant";
  const requests = useLive(scope, "support-requests", () => api.support.mine(), { refetchInterval: 30_000 });

  return (
    <div className="grid gap-4">
      <PageHead title="Help & support" sub="Paste your issue below. The admin team will review your message." />
      <Panel className="p-4 sm:p-5"><SupportForm scope={scope} /></Panel>
      <section className="grid gap-3">
        <h2 className="text-lg font-bold text-slate-900">Your previous issues</h2>
        <ErrorNote error={requests.error} />
        {requests.isPending && <div className="skeleton h-24" />}
        {requests.data?.length === 0 && <Panel className="p-4 text-sm text-slate-500">You have not sent any issues yet.</Panel>}
        {requests.data?.map((request) => (
          <Panel key={request.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
            <div className="grid gap-3">
              <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{request.message}</p>
              {request.adminResponse && (
                <div className="grid gap-1 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-xs font-bold text-emerald-800">Response from the admin team</p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-emerald-950">{request.adminResponse}</p>
                  {request.adminRespondedAt && <p className="text-xs text-emerald-700">{fmtDate(request.adminRespondedAt)}</p>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 sm:flex-col sm:items-end">
              <Chip tone={request.status === "resolved" ? "ok" : "ember"}>{request.status === "resolved" ? "Resolved" : "Open"}</Chip>
              <span className="text-xs text-slate-500">{fmtDate(request.createdAt)}</span>
            </div>
          </Panel>
        ))}
      </section>
    </div>
  );
}
