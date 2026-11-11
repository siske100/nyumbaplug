import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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

/** A tenant opens the link their landlord sent, and creates their login. */
export default function InviteAccept() {
  const { token = "" } = useParams();
  const { data: session } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api.site.inviteInfo(token), retry: false, staleTime: Infinity });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errs, setErrs] = useState<{ email?: string; password?: string }>({});
  const claimStarted = useRef(false);

  const accept = useMutation({
    mutationFn: async () => { await api.site.acceptInvite(token, email.trim(), password); return api.signInWithPassword(email.trim(), password); },
    onSuccess: (s) => { qc.setQueryData(qk.session, s); navigate(homeFor(s.role), { replace: true }); },
  });
  const linkExisting = useMutation({
    mutationFn: async () => {
      await api.site.acceptInviteForCurrentUser(token);
      const s = await api.getSession();
      if (!s) throw new Error("Your session expired. Sign in and open the invite link again.");
      return s;
    },
    onSuccess: (s) => {
      qc.setQueryData(qk.session, s);
      navigate(homeFor(s.role), { replace: true });
    },
  });
  useEffect(() => {
    if (session?.role === "tenant" && info.data && !claimStarted.current) {
      claimStarted.current = true;
      linkExisting.mutate();
    }
  }, [session?.role, info.data]);
  const signOut = useMutation({
    mutationFn: () => api.signOut(),
    onSuccess: () => {
      qc.clear();
      navigate(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`, { replace: true });
    },
  });

  if (info.isPending) return <><Ambient /><HouseLoader label="Opening your invite" /></>;
  if (info.isError || !info.data) return <><Ambient /><Notice icon="missing" title="This invite link is not valid" body="It may have expired or already been used. Ask your landlord to send a new one." action={{ to: "/sign-in", label: "Sign in" }} /></>;
  const i = info.data;
  if (session) {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
        <Ambient />
        <Panel tone="hero" className="w-full max-w-md p-7 sm:p-9">
          <h1 className="text-3xl">Link your tenancy</h1>
          <p className="mt-2 text-graphite-300">{i.landlordName ?? "Your landlord"} invited you to join HousePlug Kenya for <span className="text-bone">{i.houseTitle}{i.unit ? `, unit ${i.unit}` : ""}</span>.</p>
          {session.role === "landlord" && <p className="mt-3 text-sm text-graphite-300">This will switch this account to tenant access. Landlord accounts with properties, KYC submissions, or subscription/payment history cannot be converted.</p>}
          {session.role === "tenant"
            ? <Button className="mt-6 w-full" loading={linkExisting.isPending} onClick={() => linkExisting.mutate()}>{linkExisting.isError ? "Try linking again" : "Linking your tenancy…"}</Button>
            : session.role === "landlord"
              ? <Button className="mt-6 w-full" loading={linkExisting.isPending} onClick={() => linkExisting.mutate()}>Link tenancy and continue</Button>
            : <p className="mt-6 text-sm text-danger">This account cannot accept a tenant invite. Sign in with a tenant account.</p>}
          <ErrorNote error={linkExisting.error} />
          <p className="mt-4 text-sm text-graphite-400">Signed in as {session.email ?? session.name}. <button type="button" className="text-ember-300 underline-offset-4 hover:underline" onClick={() => signOut.mutate()}>Use another account</button></p>
          <ErrorNote error={signOut.error} />
        </Panel>
      </main>
    );
  }

  const submit = () => {
    const e = emailSchema.safeParse(email.trim()), p = passwordSchema.safeParse(password);
    setErrs({ email: e.success ? undefined : e.error.issues[0]?.message, password: p.success ? undefined : p.error.issues[0]?.message });
    if (e.success && p.success) accept.mutate();
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <Ambient />
      <Panel tone="hero" className="w-full max-w-md p-7 sm:p-9">
        <h1 className="text-3xl">Welcome{i.inviteeName ? `, ${i.inviteeName.split(" ")[0]}` : ""}</h1>
        <p className="mt-2 text-graphite-300">{i.landlordName ?? "Your landlord"} invited you to manage rent and stay in touch for <span className="text-bone">{i.houseTitle}{i.unit ? `, unit ${i.unit}` : ""}</span>. The phone number {i.phoneHint} was provided by your landlord. No SMS verification is needed.</p>
        <form className="mt-6 grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Field label="Your email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errs.email} />
          <Field label="Choose a password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errs.password} hint="At least 10 characters, with letters and numbers" />
          <ErrorNote error={accept.error} />
          <Button type="submit" magnetic loading={accept.isPending}>Create my login</Button>
        </form>
        <p className="mt-5 text-sm text-graphite-300">Already have an account? <Link to={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`} className="text-ember-300 underline-offset-4 hover:underline">Sign in to link this tenancy</Link>.</p>
      </Panel>
    </main>
  );
}
