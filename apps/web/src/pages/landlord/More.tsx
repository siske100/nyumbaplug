import { Link } from "react-router-dom";
import { Panel } from "@/components/ui/Panel";
import { PageHead } from "@/components/ui/PageHead";
import { LANDLORD_NAV } from "./LandlordLayout";

export default function More() {
  return (
    <div className="grid gap-4">
      <PageHead title="Everything" sub="All the parts of your account." />
      <div className="grid gap-3 sm:grid-cols-2">
        {LANDLORD_NAV.filter((i) => i.to !== "/landlord/more").map((i) => (
          <Link key={i.to} to={i.to}><Panel className="flex items-center gap-3 p-4 hover:bg-white/5"><i.icon className="size-5 text-ember-400" aria-hidden /><span>{i.label}</span></Panel></Link>
        ))}
      </div>
    </div>
  );
}
