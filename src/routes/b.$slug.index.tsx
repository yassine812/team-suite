import { useEffect, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/client/components/PageHeader";
import { PublicFrame } from "@/client/components/PublicFrame";
import { EmptyState } from "@/client/components/EmptyState";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";
import { formatDay, formatTime, localDate } from "@/client/lib/format";
import { getPublicPage } from "@/serverFunctions/public";

export const Route = createFileRoute("/b/$slug/")({
  loader: async ({ params }) => {
    const page = await getPublicPage({ data: { slug: params.slug } });
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.title ?? "Book a time" }] }),
  notFoundComponent: () => (
    <PublicFrame>
      <EmptyState kind="error" title="This booking page doesn't exist" />
    </PublicFrame>
  ),
  component: PublicBooking,
});

function PublicBooking() {
  const page = Route.useLoaderData();
  const [days, setDays] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ start: string; cancelUrl: string } | null>(null);

  useEffect(() => {
    const today = new Date();
    setDays(Array.from({ length: Math.min(page.horizonDays + 1, 21) }, (_, i) => localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i))));
  }, [page.horizonDays]);

  async function pick(d: string) {
    setDay(d);
    setSlot(null);
    setSlots(null);
    const res = await fetch(`/b/${page.slug}/slots?date=${d}`);
    setSlots(res.ok ? ((await res.json()) as { slots: string[] }).slots : []);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slot) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/b/${page.slug}/book`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: slot, name, email, note }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; start?: string; cancelUrl?: string };
    setPending(false);
    if (res.status === 201 && body.cancelUrl) setDone({ start: body.start!, cancelUrl: body.cancelUrl });
    else {
      setError(body.error ?? "That didn't work. Try again.");
      if (res.status === 409 && day) void pick(day);
    }
  }

  if (done)
    return (
      <PublicFrame>
        <div data-testid="booking-confirmed" className="space-y-4 rounded-lg border border-border bg-card p-6">
          <CheckCircle2 className="size-8 text-success" aria-hidden />
          <h1 className="text-xl font-semibold">You're booked</h1>
          <p className="text-sm">
            {page.title}, {formatDay(done.start)} at {formatTime(done.start)}.
          </p>
          <p className="text-sm text-muted-foreground">
            Can't make it?{" "}
            <a data-testid="cancel-link" href={done.cancelUrl} className="text-primary hover:underline">
              Cancel this booking
            </a>
          </p>
        </div>
      </PublicFrame>
    );

  return (
    <PublicFrame>
      <PageHeader title={page.title} description={`${page.duration} min with ${page.host} · times in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`} />
      {page.paused ? (
        <EmptyState title="Not taking bookings right now" />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {days.map((d) => (
              <Button key={d} data-testid={`day-${d}`} size="sm" variant={day === d ? "default" : "outline"} onClick={() => pick(d)}>
                {formatDay(new Date(`${d}T00:00:00`))}
              </Button>
            ))}
          </div>
          {day ? (
            slots === null ? (
              <Spinner />
            ) : slots.length ? (
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <Button key={s} data-testid="slot" size="sm" variant={slot === s ? "default" : "outline"} onClick={() => setSlot(s)}>
                    {formatTime(s)}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No free times that day.</p>
            )
          ) : null}
          {slot ? (
            <form onSubmit={submit} className="grid max-w-md gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="booker-name">Name</Label>
                <Input id="booker-name" data-testid="booker-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="booker-email">Email</Label>
                <Input id="booker-email" type="email" data-testid="booker-email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="booker-note">Note</Label>
                <Textarea id="booker-note" data-testid="booker-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <div>
                <Button type="submit" pending={pending}>
                  Book
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </PublicFrame>
  );
}
