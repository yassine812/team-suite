import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/client/components/AppShell";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { errorMessage, formatDay, formatTime } from "@/client/lib/format";
import { deletePage, getBookingPages, savePage, setPaused } from "@/serverFunctions/booking";

export const Route = createFileRoute("/booking")({
  loader: () => getBookingPages(),
  component: BookingPage,
});

type Data = Awaited<ReturnType<typeof getBookingPages>>;
type Page = Data["pages"][number];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function BookingPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<Page | "new" | null>(null);
  const [deleting, setDeleting] = useState<Page | null>(null);
  return (
    <AppShell>
      <PageHeader
        title="Booking pages"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            New booking page
          </Button>
        }
      />
      {data.pages.length ? (
        <div className="space-y-4">
          {data.pages.map((p) => (
            <Card key={p.id} data-testid="booking-page">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {p.title}
                  {p.paused ? <Badge variant="secondary">Paused</Badge> : null}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {p.duration} min · {p.availability.map((w) => DAYS[w.day]).join(", ")} · {p.availability[0]?.start}–{p.availability[0]?.end} ({p.timeZone})
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" render={<a href={`/b/${p.slug}`} target="_blank" rel="noreferrer" />} nativeButton={false}>
                    <ExternalLink />/b/{p.slug}
                  </Button>
                  <Button variant="outline" size="sm" onClick={async () => { await setPaused({ data: { id: p.id, paused: !p.paused } }); await router.invalidate(); }}>
                    {p.paused ? "Resume" : "Pause"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleting(p)}>
                    Delete
                  </Button>
                </div>
                {p.bookings.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                    {p.bookings.map((b) => (
                      <li key={b.id} data-testid="booking-row" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span>
                          <span className="font-medium">{b.name}</span> <span className="text-muted-foreground">{b.email}</span>
                          {b.note ? <span className="block text-muted-foreground">{b.note}</span> : null}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDay(b.start)} {formatTime(b.start)}
                          {b.status === "cancelled" ? " · cancelled" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No upcoming bookings.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No booking pages yet" description="Create one and share its link." />
      )}
      {editing ? <PageForm page={editing === "new" ? null : editing} calendars={data.calendars} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void router.invalidate(); }} /> : null}
      {deleting ? (
        <ConfirmDialog title={`Delete ${deleting.title}?`} confirmLabel="Delete" destructive onClose={() => setDeleting(null)} onConfirm={async () => { await deletePage({ data: { id: deleting.id } }); setDeleting(null); await router.invalidate(); }}>
          Its link stops working. Booked events stay on your calendar.
        </ConfirmDialog>
      ) : null}
    </AppShell>
  );
}

function PageForm({ page, calendars, onClose, onSaved }: { page: Page | null; calendars: Data["calendars"]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [duration, setDuration] = useState(String(page?.duration ?? 30));
  const [buffer, setBuffer] = useState(String(page?.buffer ?? 0));
  const [notice, setNotice] = useState(String(page?.minNotice ?? 60));
  const [horizon, setHorizon] = useState(String(page?.horizonDays ?? 30));
  const [days, setDays] = useState(new Set(page ? page.availability.map((w) => w.day) : [1, 2, 3, 4, 5]));
  const [start, setStart] = useState(page?.availability[0]?.start ?? "09:00");
  const [end, setEnd] = useState(page?.availability[0]?.end ?? "17:00");
  const [calendarId, setCalendarId] = useState(page?.calendarId ?? calendars.find((c) => c.isPrimary)?.id ?? calendars[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const r = await savePage({
        data: {
          id: page?.id,
          title,
          slug,
          duration: Number(duration),
          buffer: Number(buffer),
          minNotice: Number(notice),
          horizonDays: Number(horizon),
          calendarId,
          timeZone: page?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          availability: [...days].sort().map((day) => ({ day, start, end })),
        },
      });
      if (r.error) setError(r.error);
      else {
        toast.success("Booking page saved");
        onSaved();
      }
    } catch (e) {
      const msg = errorMessage(e);
      setError(/slug|lowercase/i.test(msg) ? "Use lowercase letters, numbers and dashes for the link." : /window|start/i.test(msg) ? "The end time must be after the start." : "Check the numbers and choose at least one day.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{page ? "Edit booking page" : "New booking page"}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto p-0.5">
          <Field label="Title" id="booking-title">
            <Input id="booking-title" data-testid="booking-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Link" id="booking-slug">
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">/b/</span>
              <Input id="booking-slug" data-testid="booking-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Length (minutes)" id="booking-duration">
              <Input id="booking-duration" type="number" min={5} data-testid="booking-duration" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
            <Field label="Gap between (minutes)" id="booking-buffer">
              <Input id="booking-buffer" type="number" min={0} data-testid="booking-buffer" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
            </Field>
            <Field label="Minimum notice (minutes)" id="booking-notice">
              <Input id="booking-notice" type="number" min={0} data-testid="booking-notice" value={notice} onChange={(e) => setNotice(e.target.value)} />
            </Field>
            <Field label="Bookable ahead (days)" id="booking-horizon">
              <Input id="booking-horizon" type="number" min={1} data-testid="booking-horizon" value={horizon} onChange={(e) => setHorizon(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-1.5">
            <Label>Available</Label>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <Checkbox data-testid={`avail-day-${i}`} checked={days.has(i)} onCheckedChange={(on) => setDays((prev) => { const next = new Set(prev); if (on) next.add(i); else next.delete(i); return next; })} />
                  {d}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input type="time" aria-label="From" className="w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
              <span className="text-muted-foreground">to</span>
              <Input type="time" aria-label="Until" className="w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <Field label="Add bookings to" id="booking-calendar">
            <select id="booking-calendar" className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} pending={pending} disabled={!title.trim() || !slug.trim()}>
            Save booking page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
