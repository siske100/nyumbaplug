import type { ReactNode } from "react";

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 sm:items-end">
      <div className="min-w-0"><h1 className="text-2xl sm:text-3xl">{title}</h1>{sub && <p className="mt-1 max-w-2xl text-sm text-graphite-300 sm:text-base">{sub}</p>}</div>
      {action}
    </header>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="text-sm text-danger">{error instanceof Error ? error.message : "Something went wrong. Please try again."}</p>;
}
