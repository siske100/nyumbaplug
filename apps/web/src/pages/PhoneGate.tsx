import { Ambient } from "@/components/layout/Ambient";
import { Panel } from "@/components/ui/Panel";
import type { Session } from "@/api/types";
import { PhoneStep } from "@/pages/landlord/onboarding/PhoneStep";

/** Tenants and caretakers confirm the phone number their landlord gave us before they can use their account. */
export function PhoneGate({ session }: { session: Session }) {
  return (
    <>
      <Ambient />
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-6 text-2xl">Welcome{session.name ? `, ${session.name.split(" ")[0]}` : ""}</h1>
        <Panel tone="hero" className="p-6 sm:p-8"><PhoneStep session={session} canChange={false} /></Panel>
      </main>
    </>
  );
}
