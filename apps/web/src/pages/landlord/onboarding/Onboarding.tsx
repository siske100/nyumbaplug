import { Check } from "lucide-react";
import { Ambient } from "@/components/layout/Ambient";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import type { LandlordState, Session } from "@/api/types";
import { useSignOut } from "@/features/auth/useSession";
import { cn } from "@/lib/cn";
import { ActivateStep } from "./ActivateStep";
import { DocumentsStep } from "./DocumentsStep";
import { EmailStep } from "./EmailStep";
import { PhoneStep } from "./PhoneStep";

const STEPS = ["Email", "Phone", "Documents", "Review", "Activate"] as const;
const INDEX: Partial<Record<LandlordState, number>> = { pending_email: 0, pending_phone: 1, pending_kyc: 2, kyc_submitted: 3, kyc_approved: 4 };

export function Onboarding({ session }: { session: Session }) {
  const state = session.landlordState ?? "pending_email";
  const current = INDEX[state] ?? 0;
  const signOut = useSignOut();

  return (
    <>
      <Ambient />
      <main className="mx-auto max-w-xl px-4 py-8 sm:py-12">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl">Welcome, {session.name}</h1>
          <Button variant="ghost" size="sm" onClick={() => signOut.mutate()}>Sign out</Button>
        </header>

        <ol className="mb-6 grid grid-cols-5 gap-1.5" aria-label="Setup progress">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === current ? "step" : undefined} className="text-center">
              <div className={cn("mx-auto grid size-8 place-items-center rounded-full border text-sm", i < current ? "border-ember-500 bg-ember-500 text-graphite-950" : i === current ? "border-ember-400 text-ember-300" : "border-white/15 text-graphite-400")}>
                {i < current ? <Check className="size-4" aria-hidden /> : i + 1}
              </div>
              <p className={cn("mt-1.5 text-xs", i === current ? "text-bone" : "text-graphite-400")}>{label}</p>
            </li>
          ))}
        </ol>

        <Panel tone="hero" className="p-6 sm:p-8">
          {state === "pending_email" && <EmailStep />}
          {state === "pending_phone" && <PhoneStep session={session} verifyPhone={false} />}
          {state === "pending_kyc" && <DocumentsStep />}
          {state === "kyc_submitted" && (
            <div className="grid gap-2">
              <h2 className="text-2xl">We are reviewing your documents</h2>
              <p className="text-graphite-300">This usually takes a short while. You will get an email and a text as soon as it is done.</p>
            </div>
          )}
          {state === "kyc_approved" && <ActivateStep />}
        </Panel>
      </main>
    </>
  );
}
