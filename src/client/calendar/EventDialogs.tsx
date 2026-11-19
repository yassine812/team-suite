import { useEffect, useState } from "react";
import { Download, FolderInput, MapPin, Paperclip, Video } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";
import { errorMessage, fileToBase64, formatTime, localDate } from "@/client/lib/format";
import { deleteEvent, getEvent, respond, saveEvent, teammatesBusy } from "@/serverFunctions/calendar";
import { saveEventAttachment } from "@/serverFunctions/files";

export interface EditableEvent {
  id?: string;
  calendarId: string;
  date: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  title?: string;
  location?: string;
  description?: string;
  guests?: string;
  meeting?: boolean;
}

type Detail = NonNullable<Awaited<ReturnType<typeof getEvent>>>;
const RESPONSE_LABEL: Record<string, string> = { pending: "Awaiting", yes: "Yes", no: "No", maybe: "Maybe" };

export function EventDetails({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: (e: EditableEvent) => void }) {
  const [event, setEvent] = useState<Detail | null | undefined>(undefined);
  const load = () => getEvent({ data: { id } }).then(setEvent);
  useEffect(() => {
    void load();
  }, [id]);
  const [deleting, setDeleting] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {event === undefined ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : event === null ? (
          <DialogHeader>
            <DialogTitle>Event not found</DialogTitle>
          </DialogHeader>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{event.title}</DialogTitle>
              <DialogDescription>
                {event.allDay
                  ? new Date(`${event.start.slice(0, 10)}T00:00:00`).toLocaleDateString([], { dateStyle: "full" })
                  : `${new Date(event.start).toLocaleDateString([], { dateStyle: "full" })}, ${formatTime(event.start)}–${formatTime(event.end)}`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 text-sm">
              {event.location ? (
                <p className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" aria-hidden />
                  {event.location}
                </p>
              ) : null}
              {event.meetUrl ? (
                <p className="flex items-center gap-2">
                  <Video className="size-4 text-muted-foreground" aria-hidden />
                  <a data-testid="event-meeting-link" href={event.meetUrl} className="text-primary hover:underline">
                    Join meeting
                  </a>
                </p>
              ) : null}
              {event.description ? <p className="whitespace-pre-wrap">{event.description}</p> : null}
              <p className="text-muted-foreground">Organizer: {event.organizer}</p>
              {event.guests.length ? (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {event.guests.map((g) => (
                    <li key={g.email} data-testid="guest-response" className="flex justify-between gap-2 px-3 py-1.5">
                      <span className="truncate">{g.email}</span>
                      <span className="text-muted-foreground">{RESPONSE_LABEL[g.response]}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {event.attachments.length ? (
                <ul className="grid gap-1">
                  {event.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <Paperclip className="size-4 text-muted-foreground" aria-hidden />
                      <a className="flex-1 truncate hover:underline" href={`/api/events/attachments/${a.id}`}>
                        {a.filename}
                      </a>
                      <Button variant="ghost" size="icon-xs" aria-label={`Download ${a.filename}`} render={<a href={`/api/events/attachments/${a.id}`} />} nativeButton={false}>
                        <Download />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Save ${a.filename} to Files`}
                        onClick={async () => {
                          const r = await saveEventAttachment({ data: { id: a.id } });
                          if (r.error) toast.error(r.error);
                          else toast.success("Saved to Files");
                        }}
                      >
                        <FolderInput />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {event.myResponse ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Going?</span>
                  {(["yes", "no", "maybe"] as const).map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      variant={event.myResponse === r ? "default" : "outline"}
                      onClick={async () => {
                        await respond({ data: { eventId: event.id, response: r } });
                        await load();
                        onChanged();
                      }}
                    >
                      {RESPONSE_LABEL[r]}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            {event.canEdit ? (
              <DialogFooter>
                <Button
                  variant="destructive"
                  pending={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    await deleteEvent({ data: { id: event.id } });
                    toast.success("Event deleted");
                    onChanged();
                    onClose();
                  }}
                >
                  Delete event
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    onEdit({
                      id: event.id,
                      calendarId: event.calendarId,
                      date: event.allDay ? event.start.slice(0, 10) : localDate(new Date(event.start)),
                      start: event.allDay ? undefined : formatTime(event.start),
                      end: event.allDay ? undefined : formatTime(event.end),
                      allDay: event.allDay,
                      title: event.title,
                      location: event.location,
                      description: event.description,
                      guests: event.guests.map((g) => g.email).join(", "),
                      meeting: !!event.meetCode,
                    })
                  }
                >
                  Edit
                </Button>
              </DialogFooter>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function iso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function EventForm({ initial, calendars, onClose, onSaved }: { initial: EditableEvent; calendars: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start ?? "09:00");
  const [end, setEnd] = useState(initial.end ?? "10:00");
  const [allDay, setAllDay] = useState(initial.allDay ?? false);
  const [location, setLocation] = useState(initial.location ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [guests, setGuests] = useState(initial.guests ?? "");
  const [meeting, setMeeting] = useState(initial.meeting ?? false);
  const [emailGuests, setEmailGuests] = useState(false);
  const [calendarId, setCalendarId] = useState(initial.calendarId);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState<Awaited<ReturnType<typeof teammatesBusy>>>([]);
  const guestList = guests.split(/[,;\s]+/).map((g) => g.trim().toLowerCase()).filter((g) => g.includes("@"));
  const guestKey = guestList.join(",");

  useEffect(() => {
    if (!guestList.length || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setBusy([]);
      return;
    }
    const from = new Date(`${date}T00:00:00`);
    const to = new Date(from.getTime() + 86400000);
    const timer = setTimeout(() => {
      void teammatesBusy({ data: { emails: guestList, from: from.toISOString(), to: to.toISOString() } }).then(setBusy).catch(() => setBusy([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [guestKey, date]);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type, base64: await fileToBase64(f) })));
      const nextDay = new Date(`${date}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const r = await saveEvent({
        data: {
          id: initial.id,
          calendarId,
          title,
          start: allDay ? `${date}T00:00:00.000Z` : iso(date, start),
          end: allDay ? nextDay.toISOString() : iso(date, end),
          allDay,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          location,
          description,
          guests: guestList,
          meeting,
          emailGuests,
          attachments,
        },
      });
      if ("error" in r) setError(r.error);
      else {
        if ("emailError" in r && r.emailError) toast.warning(r.emailError);
        toast.success("Event saved");
        onSaved();
      }
    } catch (e) {
      setError(/end must be after/i.test(errorMessage(e)) ? "The end must be after the start." : errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial.id ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto p-0.5">
          <Input aria-label="Title" placeholder="Title" data-testid="event-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="Date" data-testid="event-date" className="w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
            {!allDay ? (
              <>
                <Input type="time" aria-label="Starts" data-testid="event-start" className="w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
                <span className="text-muted-foreground">–</span>
                <Input type="time" aria-label="Ends" data-testid="event-end" className="w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
              </>
            ) : null}
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={allDay} onCheckedChange={(v) => setAllDay(!!v)} data-testid="event-all-day" />
              All day
            </label>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="event-calendar">Calendar</Label>
            <select id="event-calendar" className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <Input aria-label="Location" placeholder="Location" data-testid="event-location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <div className="grid gap-1.5">
            <Input aria-label="Guests" placeholder="Guests' emails" data-testid="event-guests" value={guests} onChange={(e) => setGuests(e.target.value)} />
            {busy.length ? (
              <ul data-testid="guest-busy" className="grid gap-0.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                {busy.map((b, i) => (
                  <li key={i}>
                    {b.email}: {b.title ?? "Busy"} {formatTime(b.start)}–{formatTime(b.end)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Textarea aria-label="Description" placeholder="Description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={meeting} onCheckedChange={(v) => setMeeting(!!v)} data-testid="event-meeting" />
            Add a video meeting
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={emailGuests} onCheckedChange={(v) => setEmailGuests(!!v)} />
            Email invitations to guests
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" render={<label />} nativeButton={false}>
              <Paperclip />
              Attach files
              <input type="file" multiple className="sr-only" data-testid="event-files" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
            </Button>
            {files.map((f) => (
              <span key={f.name} className="text-xs text-muted-foreground">
                {f.name}
              </span>
            ))}
          </div>
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
          <Button onClick={submit} pending={pending} disabled={!title.trim()}>
            Save event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
