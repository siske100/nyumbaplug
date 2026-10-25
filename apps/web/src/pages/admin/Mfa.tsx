import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api";
import { Ambient } from "@/components/layout/Ambient";
import { Button } from "@/components/ui/Button";
import { CodeField } from "@/components/ui/CodeField";
import { Panel } from "@/components/ui/Panel";
import { ErrorNote } from "@/components/ui/PageHead";
import { qk } from "@/lib/queryKeys";

/** Admin access needs a code from an authenticator app. The database refuses admin actions without it. */
export function AdminMfa() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const begin = useQuery({ queryKey: ["mfa-begin"], queryFn: () => api.mfaBegin(), staleTime: Infinity, gcTime: 0, retry: false });
  const verify = useMutation({
    mutationFn: () => api.mfaVerify(begin.data!.factorId, code),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: qk.session }); },
  });
  const m = begin.data;
  return (
    <>
      <Ambient />
      <main className="mx-auto grid min-h-[100dvh] max-w-md place-items-center px-4">
        <Panel tone="hero" className="w-full p-8">
          <h1 className="text-3xl">{m?.mode === "enroll" ? "Set up your authenticator" : "Enter your code"}</h1>
          {begin.isPending && <div className="skeleton mt-6 h-40" />}
          <ErrorNote error={begin.error} />
          {m?.mode === "enroll" && (
            <div className="mt-4 grid gap-3">
              <p className="text-graphite-300">Scan this with Google Authenticator, Authy or a similar app, then enter the 6-digit code it shows.</p>
              <img src={m.qr} alt="Authenticator QR code" className="mx-auto size-44 rounded-xl bg-white p-2" />
              <p className="break-all text-center text-sm text-graphite-400">Cannot scan? Enter this key: <span className="text-bone">{m.secret}</span></p>
            </div>
          )}
          {m?.mode === "challenge" && <p className="mt-2 text-graphite-300">Open your authenticator app and enter the current 6-digit code.</p>}
          {m && (
            <form className="mt-5 grid gap-4" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) verify.mutate(); }}>
              <CodeField label="Authenticator code" value={code} onChange={setCode} />
              <ErrorNote error={verify.error} />
              <Button type="submit" loading={verify.isPending} disabled={code.length !== 6}>Continue</Button>
            </form>
          )}
        </Panel>
      </main>
    </>
  );
}
