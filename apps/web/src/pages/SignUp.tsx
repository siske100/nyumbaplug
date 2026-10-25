import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams, Link } from "react-router-dom";
import { api } from "@/api";
import { Ambient } from "@/components/layout/Ambient";
import { Button } from "@/components/ui/Button";
import { CodeField } from "@/components/ui/CodeField";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { useSession } from "@/features/auth/useSession";
import { useCooldown } from "@/lib/useCooldown";
import { ApiError } from "@/lib/queryClient";
import { qk } from "@/lib/queryKeys";
import { landlordSignUpSchema } from "@/lib/validation";

export default function SignUp() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("confirm") ?? "");
  const [step, setStep] = useState<"form" | "code">(params.get("confirm") ? "code" : "form");
  const [form, setForm] = useState({ name: "", phone: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const cooldown = useCooldown();

  const create = useMutation({ mutationFn: () => api.signUpLandlord({ ...(landlordSignUpSchema.parse({ ...form, email })) }), onSuccess: () => { setStep("code"); cooldown.start(60); } });
  const verify = useMutation({
    mutationFn: () => api.verifyEmailCode(email, code),
    onSuccess: (s) => { qc.setQueryData(qk.session, s); navigate("/landlord", { replace: true }); },
  });
  const resend = useMutation({ mutationFn: () => api.resendEmailCode(email), onSuccess: () => cooldown.start(60) });
  const google = useMutation({ mutationFn: () => api.signInWithGoogle() });

  if (session) return <Navigate to="/landlord" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = landlordSignUpSchema.safeParse({ ...form, email });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    create.mutate();
  };
  const failure = [create.error, verify.error, resend.error, google.error].find(Boolean);

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <Ambient />
      <Panel tone="hero" className="w-full max-w-md p-7 sm:p-9">
        {step === "form" ? (
          <>
            <h1 className="text-3xl">List your houses</h1>
            <p className="mt-1 text-graphite-300">Create a landlord account. Confirm your email, add a phone number for M-Pesa, then upload your documents.</p>
            <Button variant="glass" className="mt-6 w-full" loading={google.isPending} onClick={() => google.mutate()}>Continue with Google</Button>
            <div className="my-5 flex items-center gap-3 text-sm text-graphite-400"><span className="h-px flex-1 bg-white/10" />or use your email<span className="h-px flex-1 bg-white/10" /></div>
            <form onSubmit={submit} noValidate className="grid gap-4">
              <Field label="Full name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
              <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
              <Field label="Phone number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} hint="Used for M-Pesa prompts and account messages" />
              <Field label="Password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} hint="At least 10 characters, with letters and numbers" />
              {failure instanceof ApiError && <p role="alert" className="text-sm text-danger">{failure.message}</p>}
              <Button type="submit" loading={create.isPending}>Create account</Button>
            </form>
            <p className="mt-4 text-xs text-graphite-400">
              By continuing with Google or creating an account, you agree to the <Link to="/terms" className="underline underline-offset-4 hover:text-bone">Terms of Service</Link> and acknowledge the <Link to="/privacy" className="underline underline-offset-4 hover:text-bone">Privacy Policy</Link>.
            </p>
            <p className="mt-5 text-sm text-graphite-300">Already registered? <Link to="/sign-in" className="text-ember-300 underline-offset-4 hover:underline">Sign in</Link></p>
          </>
        ) : (
          <>
            <h1 className="text-3xl">Check your email</h1>
            <p className="mt-1 text-graphite-300">We sent a 6-digit code to <span className="text-bone">{email}</span>. It expires in 10 minutes.</p>
            <form className="mt-6 grid gap-4" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) verify.mutate(); }}>
              <CodeField label="Confirmation code" value={code} onChange={setCode} />
              {failure instanceof ApiError && <p role="alert" className="text-sm text-danger">{failure.message}</p>}
              <Button type="submit" loading={verify.isPending} disabled={code.length !== 6}>Confirm email</Button>
              <Button variant="ghost" disabled={cooldown.left > 0 || resend.isPending} onClick={() => resend.mutate()}>
                {cooldown.left > 0 ? `Send again in ${cooldown.left}s` : "Send the code again"}
              </Button>
            </form>
          </>
        )}
      </Panel>
    </div>
  );
}
