import { useCallback, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Share2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { AppShell } from "@/client/components/AppShell";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { ShareDialog } from "@/client/components/ShareDialog";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { EventDetails, EventForm, type EditableEvent } from "@/client/calendar/EventDialogs";
import { COLOR_CLASS } from "@/client/calendar/colors";
import { formatDay, formatTime, localDate } from "@/client/lib/format";
import { calendarShares, createCalendar, getCalendar, setWorkingHours, shareCalendar } from "@/serverFunctions/calendar";

const VIEWS = ["day", "week", "month", "agenda"] as const;
type View = (typeof VIEWS)[number];

export const Route = createFileRoute("/calendar")({
  ssr: false,
  validateSearch: z.object({ view: z.enum(VIEWS).optional(), date: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    const { from, to } = range(deps.view ?? "week", anchorOf(deps.date));
    return getCalendar({ data: { from: from.toISOString(), to: to.toISOString() } });
  },
  component: CalendarPage,
});

function anchorOf(date?: string) {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function range(view: View, anchor: Date) {
  if (view === "day") return { from: anchor, to: addDays(anchor, 1) };
  if (view === "week") {
    const from = addDays(anchor, -anchor.getDay());
    return { from, to: addDays(from, 7) };
  }
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const from = addDays(first, -first.getDay());
    return { from, to: addDays(from, 42) };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { from: today, to: addDays(today, 90) };
}

type Data = Awaited<ReturnType<typeof getCalendar>>;
type Ev = Data["events"][number];

function CalendarPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/calendar" });
  const router = useRouter();
  const view = search.view ?? "week";
  const anchor = anchorOf(search.date);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditableEvent | null>(null);
  const [sharing, setSharing] = useState<{ id: string; name: string } | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [newCal, setNewCal] = useState(false);
  const { from, to } = range(view, anchor);
  const events = data.events.filter((e) => !hidden.has(e.calendarId));
  const writable = [...data.calendars.own.map((c) => ({ id: c.id, name: c.name })), ...data.calendars.shared.filter((c) => c.level === "edit").map((c) => ({ id: c.id, name: `${c.name} (${c.owner})` }))];
  const step = view === "day" ? 1 : view === "week" ? 7 : view === "month" ? 31 : 0;
  const refresh = () => router.invalidate();
  const loadShares = useCallback(async () => (sharing ? (await calendarShares({ data: { id: sharing.id } })).map((r) => ({ email: r.email, level: r.level })) : []), [sharing]);

  return (
    <AppShell wide>
      <PageHeader
        title="Calendar"
        actions={
          <>
            <Button variant="outline" onClick={() => setHoursOpen(true)}>
              <CalendarClock />
              Working hours
            </Button>
            <Button onClick={() => setEditing({ calendarId: data.calendars.own.find((c) => c.isPrimary)?.id ?? data.calendars.own[0]!.id, date: localDate(view === "agenda" ? new Date() : anchor) })}>
              <Plus />
              New event
            </Button>
          </>
        }
      />
      <div className="grid gap-6 md:grid-cols-[13rem_1fr]">
        <aside className="grid content-start gap-4 text-sm">
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground">My calendars</p>
            {data.calendars.own.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <Checkbox checked={!hidden.has(c.id)} onCheckedChange={(on) => setHidden(toggle(hidden, c.id, !on))} aria-label={`Show ${c.name}`} />
                <span className={`size-2.5 rounded-full ${COLOR_CLASS[c.color] ?? COLOR_CLASS["chart-1"]}`} aria-hidden />
                <span className="flex-1 truncate">{c.name}</span>
                <Button variant="ghost" size="icon-xs" aria-label="Share calendar" title={`Share ${c.name}`} onClick={() => setSharing({ id: c.id, name: c.name })}>
                  <Share2 />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => setNewCal(true)}>
              <Plus />
              New calendar
            </Button>
          </div>
          {data.calendars.shared.length ? (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">Shared with me</p>
              {data.calendars.shared.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <Checkbox checked={!hidden.has(c.id)} onCheckedChange={(on) => setHidden(toggle(hidden, c.id, !on))} />
                  <span className={`size-2.5 rounded-full ${COLOR_CLASS[c.color] ?? COLOR_CLASS["chart-1"]}`} aria-hidden />
                  <span className="truncate" title={c.owner}>
                    {c.owner}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </aside>
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {step ? (
                <>
                  <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => navigate({ search: { view, date: localDate(addDays(anchor, -step)) } })}>
                    <ChevronLeft />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => navigate({ search: { view } })}>
                    Today
                  </Button>
                  <Button variant="outline" size="icon-sm" aria-label="Next" onClick={() => navigate({ search: { view, date: localDate(addDays(anchor, step)) } })}>
                    <ChevronRight />
                  </Button>
                </>
              ) : null}
              <span className="ml-2 text-sm font-medium">
                {view === "month" ? anchor.toLocaleDateString([], { month: "long", year: "numeric" }) : view === "agenda" ? "Upcoming" : `${formatDay(from)}${view === "week" ? ` – ${formatDay(addDays(to, -1))}` : ""}`}
              </span>
            </div>
            <SegmentedToggle
              showLabels
              value={view}
              onChange={(v) => navigate({ search: { view: v, date: search.date } })}
              items={VIEWS.map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1), icon: null }))}
            />
          </div>
          {view === "agenda" ? (
            <Agenda events={events} onOpen={setOpenEvent} />
          ) : view === "month" ? (
            <Grid testId="view-month" days={42} from={from} anchor={anchor} events={events} onOpen={setOpenEvent} />
          ) : (
            <Grid testId={`view-${view}`} days={view === "day" ? 1 : 7} from={from} anchor={anchor} events={events} onOpen={setOpenEvent} hours={data.hours} />
          )}
        </section>
      </div>
      {openEvent ? (
        <EventDetails
          id={openEvent}
          onClose={() => setOpenEvent(null)}
          onChanged={refresh}
          onEdit={(e) => {
            setOpenEvent(null);
            setEditing(e);
          }}
        />
      ) : null}
      {editing ? (
        <EventForm
          initial={editing}
          calendars={writable}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}
      {sharing ? (
        <ShareDialog
          title={`Share ${sharing.name}`}
          levels={[
            { value: "freebusy", label: "Free/busy" },
            { value: "details", label: "See details" },
            { value: "edit", label: "Edit events" },
          ]}
          load={loadShares}
          save={(email, level) => shareCalendar({ data: { calendarId: sharing.id, email, level: level as "freebusy" | "details" | "edit" | null } })}
          onClose={() => setSharing(null)}
        />
      ) : null}
      {hoursOpen ? <HoursDialog hours={data.hours} onClose={() => setHoursOpen(false)} onSaved={refresh} /> : null}
      {newCal ? <NewCalendarDialog onClose={() => setNewCal(false)} onSaved={refresh} /> : null}
    </AppShell>
  );
}

function toggle(set: Set<string>, id: string, hide: boolean) {
  const next = new Set(set);
  if (hide) next.add(id);
  else next.delete(id);
  return next;
}

function EventChip({ e, onOpen, compact = false }: { e: Ev; onOpen: (id: string) => void; compact?: boolean }) {
  return (
    <button
      type="button"
      data-testid="event-item"
      disabled={e.busyOnly}
      onClick={() => onOpen(e.id)}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-left text-xs transition-colors hover:bg-muted disabled:cursor-default ${e.busyOnly ? "text-muted-foreground" : ""}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${COLOR_CLASS[e.color] ?? COLOR_CLASS["chart-1"]}`} aria-hidden />
      {!e.allDay && !compact ? <span className="shrink-0 text-muted-foreground">{formatTime(e.start)}</span> : null}
      <span className="truncate">{e.title}</span>
      {e.isGuest && e.myResponse === "pending" ? <span className="shrink-0 text-muted-foreground">· invited</span> : null}
    </button>
  );
}

function sameDay(iso: string, day: Date, allDay: boolean) {
  if (allDay) return iso.slice(0, 10) === localDate(day);
  const d = new Date(iso);
  return d.toDateString() === day.toDateString();
}

function eventsOn(events: Ev[], day: Date) {
  const start = day.getTime();
  const end = addDays(day, 1).getTime();
  return events.filter((e) => (e.allDay ? sameDay(e.start, day, true) || (e.start.slice(0, 10) <= localDate(day) && e.end.slice(0, 10) > localDate(day)) : Date.parse(e.start) < end && Date.parse(e.end) > start));
}

function Grid({ testId, days, from, anchor, events, onOpen, hours }: { testId: string; days: number; from: Date; anchor: Date; events: Ev[]; onOpen: (id: string) => void; hours?: Data["hours"] }) {
  const cols = days === 1 ? "grid-cols-1" : "grid-cols-7";
  return (
    <div data-testid={testId} className={`grid ${cols} gap-px overflow-hidden rounded-lg border border-border bg-border`}>
      {Array.from({ length: days }, (_, i) => addDays(from, i)).map((day) => {
        const list = eventsOn(events, day);
        const working = hours?.days.includes(day.getDay());
        const outside = days === 42 && day.getMonth() !== anchor.getMonth();
        return (
          <div key={day.toISOString()} className={`min-h-28 space-y-1 p-1.5 ${outside ? "bg-muted" : "bg-card"}`}>
            <p className={`text-xs ${day.toDateString() === new Date().toDateString() ? "font-semibold text-primary" : "text-muted-foreground"}`}>
              {days === 42 ? day.getDate() : formatDay(day)}
            </p>
            {hours && working ? (
              <p className="text-[11px] text-muted-foreground">
                {hours.start}–{hours.end}
              </p>
            ) : null}
            {list.map((e) => (
              <EventChip key={e.id} e={e} onOpen={onOpen} compact={days === 42} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Agenda({ events, onOpen }: { events: Ev[]; onOpen: (id: string) => void }) {
  if (!events.length) return <EmptyState title="Nothing scheduled" description="Events in the next 90 days show here." />;
  const groups = new Map<string, Ev[]>();
  for (const e of events) {
    const key = e.allDay ? e.start.slice(0, 10) : localDate(new Date(e.start));
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return (
    <div data-testid="view-agenda" className="space-y-4">
      {[...groups].map(([day, list]) => (
        <div key={day} className="grid gap-1.5 md:grid-cols-[8rem_1fr]">
          <p className="text-sm font-medium">{formatDay(new Date(`${day}T00:00:00`))}</p>
          <div className="grid gap-1">
            {list.map((e) => (
              <div key={e.id} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{e.allDay ? "All day" : `${formatTime(e.start)}–${formatTime(e.end)}`}</span>
                <EventChip e={e} onOpen={onOpen} compact />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function HoursDialog({ hours, onClose, onSaved }: { hours: Data["hours"]; onClose: () => void; onSaved: () => void }) {
  const [start, setStart] = useState(hours.start);
  const [end, setEnd] = useState(hours.end);
  const [days, setDays] = useState(new Set(hours.days));
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Working hours</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Input type="time" aria-label="Start" data-testid="work-start" value={start} onChange={(e) => setStart(e.target.value)} />
            <span className="text-muted-foreground">to</span>
            <Input type="time" aria-label="End" data-testid="work-end" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-3">
            {DAY_NAMES.map((n, i) => (
              <label key={n} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={days.has(i)} onCheckedChange={(on) => setDays((prev) => { const next = new Set(prev); if (on) next.add(i); else next.delete(i); return next; })} />
                {n}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button
            pending={pending}
            onClick={async () => {
              setPending(true);
              try {
                await setWorkingHours({ data: { start, end, days: [...days] } });
                toast.success("Working hours saved");
                onSaved();
                onClose();
              } catch {
                toast.error("The end must be after the start.");
              } finally {
                setPending(false);
              }
            }}
          >
            Save hours
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewCalendarDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<"chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5">("chart-2");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New calendar</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="cal-name">Name</Label>
          <Input id="cal-name" data-testid="calendar-name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2" role="radiogroup" aria-label="Colour">
            {(Object.keys(COLOR_CLASS) as (typeof color)[]).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c.slice(-1)}`} onClick={() => setColor(c)} className={`size-6 rounded-full ${COLOR_CLASS[c]} ${color === c ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""}`} />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim()}
            onClick={async () => {
              await createCalendar({ data: { name: name.trim(), color } });
              onSaved();
              onClose();
            }}
          >
            Create calendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
