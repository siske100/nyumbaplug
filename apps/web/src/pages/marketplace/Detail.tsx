import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useSession } from "@/features/auth/useSession";
import { useLive } from "@/features/live";
import { formatKes } from "@/lib/format";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function MarketplaceDetail() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { data: session } = useSession();
  const house = useLive("public", `marketplace-listing-${id}`, () => api.marketplace.publicListing(id));
  const [date, setDate] = useState(today);
  const [window, setWindow] = useState("Morning");
  const [message, setMessage] = useState<string>();
  const book = useMutation({
    mutationFn: async () => {
      const bookingId = await api.marketplace.createBooking(id, date, window);
      return api.marketplace.payViewingFee(bookingId, house.data!.viewingFee);
    },
    onSuccess: (result) => setMessage(result.message),
  });

  if (house.isPending) return <Panel className="skeleton h-64" />;
  if (house.isError || !house.data) return <Panel className="p-6"><PageHead title="This house is not available" sub="It may have been removed. Browse other paid viewing listings." /><Link to="/marketplace" className="text-ember-300 underline">Browse houses</Link></Panel>;
  const h = house.data;
  const canBook = session?.role === "client" && session.phoneVerified !== false;

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <Link to="/marketplace" className="text-sm text-graphite-300 hover:text-bone">← All viewing houses</Link>
      <Panel tone="hero" className="grid gap-4 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl">{h.title}</h1><Chip>{h.type}</Chip></div>
        <p className="text-graphite-300">{h.town}, {h.county} · Posted by {h.marketerName}</p>
        <p className="whitespace-pre-wrap text-graphite-200">{h.description}</p>
        <div className="grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
          <div><p className="font-display text-2xl">{formatKes(h.rent)}</p><p className="text-sm text-graphite-300">Monthly rent</p></div>
          <div><p className="font-display text-2xl text-ember-300">{formatKes(h.viewingFee)}</p><p className="text-sm text-graphite-300">One-time fee to book this in-person viewing</p></div>
        </div>
      </Panel>
      <Panel className="grid gap-4 p-5 sm:p-6">
        <h2 className="text-2xl">Book an in-person viewing</h2>
        <p className="text-sm text-graphite-300">Pay the marketer’s viewing fee on M-Pesa. After the viewing, confirm it in your client account. Only client-confirmed viewings are eligible for marketer payout.</p>
        {canBook ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Preferred date" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
              <SelectField label="Preferred time" value={window} onChange={(e) => setWindow(e.target.value)}>
                {["Morning", "Afternoon", "Evening"].map((item) => <option key={item}>{item}</option>)}
              </SelectField>
            </div>
            <p className="text-sm text-graphite-400">The M-Pesa prompt will go to your verified account phone: {session.phone}.</p>
            {message && <p role="status" className="text-sm text-ok">{message} Then check <Link to="/client" className="underline">My bookings</Link> for the booking status.</p>}
            <ErrorNote error={book.error} />
            <Button loading={book.isPending} onClick={() => { setMessage(undefined); book.mutate(); }}>Book and pay {formatKes(h.viewingFee)}</Button>
          </>
        ) : session ? (
          <p role="status" className="text-sm text-graphite-300">{session.role === "client"
            ? <>Confirm your phone before booking. <Link to="/client" className="text-ember-300 underline">Open your client account</Link>.</>
            : "Sign in with a client account to book this viewing."}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Link to="/sign-in" state={{ from: location.pathname }}><Button variant="glass">Sign in to book</Button></Link>
            <Link to={`/sign-up?account=client&next=${encodeURIComponent(location.pathname)}`}><Button>Create a client account</Button></Link>
          </div>
        )}
      </Panel>
    </div>
  );
}
