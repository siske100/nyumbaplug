import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import { Ambient } from "@/components/layout/Ambient";
import { HouseLoader } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { homeFor, useSession } from "@/features/auth/useSession";
import { qk } from "@/lib/queryKeys";
import { emailSchema, passwordSchema } from "@/lib/validation";

/** A tenant or caretaker opens the link their landlord sent, and creates their login. */
export default function InviteAccept() {
  const { token = "" } = useParams();
  const { data: session } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api.site.inviteInfo(token), retry: false, staleTime: Infinity });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errs, setErrs] = useState<{ email?: string; password?: string }>({});

  const accept = useMutation({
    mutationFn: async () => { await api.site.acceptInvite(token, email.trim(), password); return api.signInWithPassword(email.trim(), password); },
    onSuccess: (s) => { qc.setQueryData(qk.session, s); navigate(homeFor(s.role), { replace: true }); },
  });

  if (session) return <Navigate to={homeFor(session.role)} replace />;
  if (info.isPending) return <><Ambient /><HouseLoader label="Opening your invite" /></>;
  if (info.isError || !info.data) return <><Ambient /><Notice icon="missing" title="This invite link is not valid" body="It may have expired or already been used. Ask your landlord to send a new one." action={{ to: "/sign-in", label: "Sign in" }} /></>;
  const i = info.data;

  const submit = () => {
    const e = emailSchema.safeParse(email.trim()), p = passwordSchema.safeParse(password);
    setErrs({ email: e.success ? undefined : e.error.issues[0]?.message, password: p.success ? undefined : p.error.issues[0]?.message });
    if (e.success && p.success) accept.mutate();
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <Ambient />
      <Panel tone="hero" className="w-full max-w-md p-7 sm:p-9">
        <h1 className="text-3xl">{i.kind === "tenant" ? `Welcome${i.inviteeName ? `, ${i.inviteeName.split(" ")[0]}` : ""}` : "Join as a caretaker"}</h1>
        <p className="mt-2 text-graphite-300">{i.landlordName ?? "Your landlord"} invited you to {i.kind === "tenant" ? "pay rent and stay in touch for" : "help look after"} <span className="text-bone">{i.houseTitle}{i.unit ? `, unit ${i.unit}` : ""}</span>. We will text a code to {i.phoneHint} to confirm your phone.</p>
        <form className="mt-6 grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Field label="Your email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errs.email} />
          <Field label="Choose a password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errs.password} hint="At least 10 characters, with letters and numbers" />
          <ErrorNote error={accept.error} />
          <Button type="submit" magnetic loading={accept.isPending}>Create my login</Button>
        </form>
      </Panel>
    </main>
  );
}
