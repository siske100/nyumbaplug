import type { ReactNode } from "react";

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-3xl">{title}</h1>{sub && <p className="mt-1 max-w-2xl text-graphite-300">{sub}</p>}</div>
      {action}
    </header>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="text-sm text-danger">{error instanceof Error ? error.message : "Something went wrong. Please try again."}</p>;
}
