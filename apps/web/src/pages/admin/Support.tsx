import { Check, RotateCcw } from "lucide-react";
import { api } from "@/api";
import type { SupportRequest } from "@/api/types";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { SupportForm } from "@/components/shared/SupportForm";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate } from "@/lib/format";

export default function Support() {
  const requests = useLive("admin", "support-inbox", () => api.admin.supportRequests(), { refetchInterval: 30_000 });
  const update = useLiveMutation("admin", (value: { id: string; status: SupportRequest["status"] }) =>
    api.admin.updateSupportRequest(value.id, value.status));

  return (
    <div className="grid gap-4">
      <PageHead title="Help & support" sub="Issues submitted by signed-in users." />
      <Panel className="grid gap-3 p-4 sm:p-5">
        <div><h2 className="font-bold text-slate-900">Submit an issue</h2><p className="mt-1 text-sm text-slate-600">Paste your issue below. It will be added to this inbox.</p></div>
        <SupportForm scope="admin" />
      </Panel>
      <ErrorNote error={requests.error ?? update.error} />
      {requests.isPending && <div className="skeleton h-28" />}
      {requests.data?.length === 0 && <Panel className="p-5 text-sm text-slate-500">No support issues have been submitted.</Panel>}
      {requests.data?.map((request) => (
        <Panel key={request.id} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
          <div className="grid content-start gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-slate-900">{request.name}</h2>
              <Chip>{request.role}</Chip>
              <Chip tone={request.status === "resolved" ? "ok" : "ember"}>{request.status === "resolved" ? "Resolved" : "Open"}</Chip>
            </div>
            <p className="text-xs text-slate-500">{request.email} · {fmtDate(request.createdAt)}</p>
            <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{request.message}</p>
          </div>
          <Button
            variant="glass"
            size="sm"
            loading={update.isPending && update.variables?.id === request.id}
            onClick={() => update.mutate({ id: request.id, status: request.status === "open" ? "resolved" : "open" })}
          >
            {request.status === "open" ? <><Check className="size-4" aria-hidden /> Mark resolved</> : <><RotateCcw className="size-4" aria-hidden /> Reopen</>}
          </Button>
        </Panel>
      ))}
    </div>
  );
}
