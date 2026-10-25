import { Lock, SearchX, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Panel } from "./Panel";

const icons = { lock: Lock, forbidden: ShieldAlert, missing: SearchX };

export function Notice({ icon, title, body, action }: { icon: keyof typeof icons; title: string; body: string; action?: { to: string; label: string } }) {
  const Icon = icons[icon];
  return (
    <div className="mx-auto grid min-h-[70dvh] max-w-md place-items-center px-4">
      <Panel tone="hero" className="w-full p-8 text-center">
        <Icon className="mx-auto mb-4 size-8 text-ember-400" aria-hidden />
        <h1 className="text-2xl">{title}</h1>
        <p className="mt-2 text-graphite-200">{body}</p>
        {action && <Link to={action.to} className="mt-6 inline-block rounded-[10px] bg-ember-500 px-4 py-2.5 font-semibold text-graphite-950 hover:bg-ember-400">{action.label}</Link>}
      </Panel>
    </div>
  );
}
