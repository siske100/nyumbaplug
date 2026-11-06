import { Check, RotateCcw, Send } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "@/api";
import type { SupportRequest } from "@/api/types";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { SupportForm } from "@/components/shared/SupportForm";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate } from "@/lib/format";

function SupportReply({ request }: { request: SupportRequest }) {
  const [response, setResponse] = useState(request.adminResponse ?? "");
  const reply = useLiveMutation("admin", (value: { id: string; response: string }) =>
    api.admin.replyToSupportRequest(value.id, value.response));
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = response.trim();
    if (!trimmed || trimmed.length > 5000) return;
    reply.mutate({ id: request.id, response: trimmed });
  };

  return (
    <form className="grid gap-2" onSubmit={send}>
      <label htmlFor={`support-reply-${request.id}`} className="text-sm font-semibold text-slate-700">
        {request.adminResponse ? "Update your reply" : "Reply to user"}
      </label>
      <textarea
        id={`support-reply-${request.id}`}
        rows={3}
        maxLength={5000}
        required
        value={response}
        onChange={(event) => setResponse(event.target.value)}
        placeholder="Write a response the user can see in Help & support."
        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-100"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ErrorNote error={reply.error} />
        <Button type="submit" size="sm" loading={reply.isPending} disabled={!response.trim() || response.trim().length > 5000}>
          <Send className="size-4" aria-hidden />{request.adminResponse ? "Update reply" : "Send reply"}
        </Button>
      </div>
      {reply.isSuccess && <p role="status" className="text-xs font-medium text-emerald-700">Reply sent to the user.</p>}
    </form>
  );
}

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
        <Panel key={request.id} className="grid gap-4 p-4 sm:p-5">
          <div className="grid content-start gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-slate-900">{request.name}</h2>
              <Chip>{request.role}</Chip>
              <Chip tone={request.status === "resolved" ? "ok" : "ember"}>{request.status === "resolved" ? "Resolved" : "Open"}</Chip>
            </div>
            <p className="text-xs text-slate-500">{request.email} · {fmtDate(request.createdAt)}</p>
            <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{request.message}</p>
            <SupportReply request={request} />
          </div>
          <div className="flex justify-end">
            <Button
              variant="glass"
              size="sm"
              loading={update.isPending && update.variables?.id === request.id}
              onClick={() => update.mutate({ id: request.id, status: request.status === "open" ? "resolved" : "open" })}
            >
              {request.status === "open" ? <><Check className="size-4" aria-hidden /> Mark resolved</> : <><RotateCcw className="size-4" aria-hidden /> Reopen</>}
            </Button>
          </div>
        </Panel>
      ))}
    </div>
  );
}
