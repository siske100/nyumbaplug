import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api";
import type { Session } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { CodeField } from "@/components/ui/CodeField";
import { Field } from "@/components/ui/Field";
import { useCooldown } from "@/lib/useCooldown";
import { ApiError } from "@/lib/queryClient";
import { qk } from "@/lib/queryKeys";
import { kenyanPhone } from "@/lib/validation";

export function PhoneStep({ session, canChange = true, verifyPhone = true }: { session: Session; canChange?: boolean; verifyPhone?: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(!session.phone);
  const [phone, setPhone] = useState(session.phone ?? "");
  const [phoneError, setPhoneError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const cooldown = useCooldown();
  const refresh = () => qc.invalidateQueries({ queryKey: qk.session });

  const save = useMutation({ mutationFn: (p: string) => api.setMyPhone(p), onSuccess: async () => { setEditing(false); setSent(false); await refresh(); } });
  const send = useMutation({ mutationFn: () => api.sendPhoneCode(), onSuccess: () => { setSent(true); setWrong(false); setCode(""); cooldown.start(60); } });
  const verify = useMutation({
    mutationFn: () => api.verifyPhoneCode(code),
    onSuccess: async (ok) => { if (ok) await refresh(); else { setWrong(true); setCode(""); } },
  });

  const savePhone = () => {
    const parsed = kenyanPhone.safeParse(phone);
    if (!parsed.success) { setPhoneError(parsed.error.issues[0]?.message); return; }
    setPhoneError(undefined);
    save.mutate(parsed.data);
  };
  const failure = [save.error, send.error, verify.error].find(Boolean);

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl">{verifyPhone ? "Confirm your phone" : "Add your phone"}</h2>
        <p className="mt-1 text-graphite-300">
        {verifyPhone
          ? "We text a 6-digit code to the number below. It expires in 5 minutes."
          : "Add a number for M-Pesa prompts and account messages. We will not send a verification code."}
        </p>
      </div>

      {editing ? (
        <div className="grid gap-3">
          <Field label="Phone number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} error={phoneError} />
          <div className="flex gap-2">
            <Button loading={save.isPending} onClick={savePhone}>{verifyPhone ? "Save number" : "Save and continue"}</Button>
            {session.phone && <Button variant="ghost" onClick={() => { setEditing(false); setPhone(session.phone ?? ""); setPhoneError(undefined); }}>Cancel</Button>}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/4 px-4 py-3">
          <span className="font-display text-xl">{session.phone}</span>
          {canChange && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Change</Button>}
        </div>
      )}

      {verifyPhone && !editing && (
        <>
          {!sent ? (
            <Button loading={send.isPending} onClick={() => send.mutate()}>Send me a code</Button>
          ) : (
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) verify.mutate(); }}>
              <CodeField label="Code from the SMS" value={code} onChange={setCode} error={wrong ? "That code is not right. Try again." : undefined} />
              <Button type="submit" loading={verify.isPending} disabled={code.length !== 6}>Confirm phone</Button>
              <Button variant="ghost" disabled={cooldown.left > 0 || send.isPending} onClick={() => send.mutate()}>
                {cooldown.left > 0 ? `Send again in ${cooldown.left}s` : "Send a new code"}
              </Button>
            </form>
          )}
        </>
      )}
      {failure instanceof ApiError && <p role="alert" className="text-sm text-danger">{failure.message}</p>}
    </div>
  );
}
