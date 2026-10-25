import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/api";
import type { Role, Session } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { homeFor, useSession } from "@/features/auth/useSession";
import { ApiError } from "@/lib/queryClient";
import { qk } from "@/lib/queryKeys";
import { signInSchema } from "@/lib/validation";

export default function SignIn() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onSuccess = (s: Session) => {
    qc.setQueryData(qk.session, s);
    navigate(from ?? homeFor(s.role), { replace: true });
  };

  const passwordLogin = useMutation({ mutationFn: () => api.signInWithPassword(email, password), onSuccess });
  const google = useMutation({ mutationFn: () => api.signInWithGoogle() });
  const dev = useMutation({ mutationFn: (role: Role) => api.devSignIn!(role), onSuccess });

  if (session) return <Navigate to={homeFor(session.role)} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    passwordLogin.mutate();
  };

  const failure = [passwordLogin.error, google.error, dev.error].find(Boolean);

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <div className="ambient" aria-hidden />
      <Panel tone="hero" className="w-full max-w-md p-7 sm:p-9">
        <h1 className="text-3xl">Sign in</h1>
        <p className="mt-1 text-graphite-300">Landlords, tenants and caretakers sign in here.</p>

        <Button variant="glass" className="mt-6 w-full" loading={google.isPending} onClick={() => google.mutate()}>
          <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8a6 6 0 1 1 0-12c1.9 0 3.2.8 3.9 1.5l2.7-2.6A9.9 9.9 0 0 0 12 2a10 10 0 1 0 0 20c5.8 0 9.6-4 9.6-9.8 0-.7-.1-1.2-.2-2z"/></svg>
          Continue with Google
        </Button>
        <div className="my-5 flex items-center gap-3 text-sm text-graphite-400"><span className="h-px flex-1 bg-white/10" />or use your email<span className="h-px flex-1 bg-white/10" /></div>

        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} />
          <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} />
          {failure instanceof ApiError && <p role="alert" className="text-sm text-danger">{failure.message}{failure.status === 403 && <> <Link to={`/sign-up?confirm=${encodeURIComponent(email)}`} className="text-ember-300 underline-offset-4 hover:underline">Enter your code</Link></>}</p>}
          <Button type="submit" loading={passwordLogin.isPending}>Sign in</Button>
        </form>

        <p className="mt-5 text-sm text-graphite-300">New landlord? <Link to="/sign-up" className="text-ember-300 underline-offset-4 hover:underline">Create an account</Link>. Tenant or caretaker? Use the invite link your landlord sent you.</p>
        <p className="mt-4 text-xs text-graphite-400">
          By continuing with Google or signing in, you acknowledge the <Link to="/privacy" className="underline underline-offset-4 hover:text-bone">Privacy Policy</Link> and agree to the <Link to="/terms" className="underline underline-offset-4 hover:text-bone">Terms of Service</Link>.
        </p>

        {import.meta.env.DEV && api.devSignIn && (
          <div className="mt-6 rounded-xl border border-dashed border-white/15 p-3">
            <p className="mb-2 text-xs text-graphite-400">Development only: skip sign-in as a demo account. This is removed from production builds.</p>
            <div className="flex flex-wrap gap-2">
              {(["landlord", "tenant", "admin"] as Role[]).map((r) => <Button key={r} variant="ghost" size="sm" onClick={() => dev.mutate(r)}>{r}</Button>)}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
