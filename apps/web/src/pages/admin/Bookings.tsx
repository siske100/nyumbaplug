import { CalendarDays } from "lucide-react";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useAdminBookingStatuses } from "@/features/admin/hooks";

const labels = {
  new: "New",
  contacted: "Contacted",
  scheduled: "Scheduled",
  rescheduled: "Rescheduled",
  done: "Completed",
  no_show: "No-show",
  house_taken: "House taken",
  cancelled: "Cancelled",
} as const;

export default function AdminBookings() {
  const { data, isPending, error } = useAdminBookingStatuses();
  const total = (data ?? []).reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="grid gap-4">
      <PageHead title="Bookings" sub="Aggregate status totals for viewing requests submitted on landlord-listed houses. Landlords continue to manage each request from their own Viewings page." />
      <ErrorNote error={error} />
      <Panel className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">All landlord viewing requests</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{isPending ? "—" : total.toLocaleString("en-KE")}</p>
          </div>
          <span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
            <CalendarDays className="size-5" aria-hidden />
          </span>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(data ?? []).map(({ status, count }) => (
          <Panel key={status} className="flex items-center justify-between gap-3 p-4">
            <span className="text-sm text-slate-600">{labels[status]}</span>
            <span className="text-xl font-bold text-slate-900">{count.toLocaleString("en-KE")}</span>
          </Panel>
        ))}
        {isPending && Array.from({ length: 8 }, (_, index) => <Panel key={index} className="skeleton h-16" />)}
      </div>
      {!isPending && !error && data?.length === 0 && (
        <Panel className="p-5 text-sm text-slate-500">No viewing request statuses are available.</Panel>
      )}
      <p className="text-sm text-slate-500">Viewer names, phone numbers, and individual request details stay private to the landlord who manages that property.</p>
    </div>
  );
}
