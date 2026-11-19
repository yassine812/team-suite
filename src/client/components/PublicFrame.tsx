import type { ReactNode } from "react";

/** The frame for pages people outside the team open. */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh overflow-y-auto">
      <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-10 md:py-16">{children}</main>
    </div>
  );
}
