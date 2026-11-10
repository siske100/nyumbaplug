import { useState } from "react";
import type { Role } from "@/api/types";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/PageHead";
import { useLiveMutation } from "@/features/live";

export function SupportForm({ scope }: { scope: Role }) {
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const submit = useLiveMutation(scope, (value: string) => api.support.submit(value));
  const send = () => {
    const issue = message.trim();
    if (issue.length < 10 || issue.length > 5000) return;
    submit.mutate(issue, { onSuccess: () => { setMessage(""); setSent(true); } });
  };

  return (
    <form className="grid grid-cols-1 min-w-0 gap-3" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <label htmlFor="support-issue" className="text-sm text-slate-600">Paste or describe your issue</label>
      <textarea
        id="support-issue"
        rows={4}
        minLength={10}
        maxLength={5000}
        required
        value={message}
        onChange={(event) => { setMessage(event.target.value); setSent(false); }}
        placeholder="Tell us what happened and what you were trying to do."
        className="w-full min-w-0 max-w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Your message will be sent to the admin team.</p>
        <Button type="submit" loading={submit.isPending} disabled={message.trim().length < 10 || message.trim().length > 5000}>Send issue</Button>
      </div>
      {sent && <p role="status" className="text-sm font-medium text-emerald-700">Your issue was sent to the admin team.</p>}
      <ErrorNote error={submit.error} />
    </form>
  );
}
