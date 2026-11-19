import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { cancelBookingResponse } from "@/server/cancelBooking";
import { PageHeader } from "@/client/components/PageHeader";
import { PublicFrame } from "@/client/components/PublicFrame";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import { formatDay, formatTime } from "@/client/lib/format";
import { getBookingForCancel } from "@/serverFunctions/public";

export const Route = createFileRoute("/b/cancel/$token")({
  server: {
    handlers: {
      // Public: the token in the confirmation is the only key to the booking.
      POST: ({ params }: { params: { token: string } }) => cancelBookingResponse(params.token),
    },
  },
  loader: async ({ params }) => {
    const b = await getBookingForCancel({ data: { token: params.token } });
    if (!b) throw notFound();
    return b;
  },
  notFoundComponent: () => (
    <PublicFrame>
      <EmptyState kind="error" title="Booking not found" />
    </PublicFrame>
  ),
  component: CancelPage,
});

function CancelPage() {
  const b = Route.useLoaderData();
  const { token } = Route.useParams();
  const [cancelled, setCancelled] = useState(b.status === "cancelled");
  const [pending, setPending] = useState(false);
  return (
    <PublicFrame>
      <PageHeader title={b.title} description={`${b.name} · ${formatDay(b.start)} at ${formatTime(b.start)}`} />
      {cancelled ? (
        <p data-testid="booking-cancelled" className="text-sm">
          This booking is cancelled.
        </p>
      ) : (
        <Button
          variant="destructive"
          pending={pending}
          onClick={async () => {
            setPending(true);
            const res = await fetch(`/b/cancel/${token}`, { method: "POST" });
            setPending(false);
            if (res.ok) setCancelled(true);
          }}
        >
          Cancel booking
        </Button>
      )}
    </PublicFrame>
  );
}
