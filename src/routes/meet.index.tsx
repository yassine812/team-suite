import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Video } from "lucide-react";
import { AppShell } from "@/client/components/AppShell";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { formatWhen } from "@/client/lib/format";
import { createRoom, getRooms } from "@/serverFunctions/meet";

export const Route = createFileRoute("/meet/")({
  loader: () => getRooms(),
  component: MeetPage,
});

function MeetPage() {
  const rooms = Route.useLoaderData();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <AppShell>
      <PageHeader title="Meetings" />
      <form
        className="flex max-w-lg gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          const { code } = await createRoom({ data: { title } });
          await navigate({ to: "/meet/$code", params: { code } });
        }}
      >
        <Input aria-label="Meeting name" placeholder="Meeting name" data-testid="meet-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Button type="submit" pending={pending}>
          <Video />
          New meeting
        </Button>
      </form>
      {rooms.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rooms.map((r) => (
            <li key={r.id} data-testid="room-row" className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <Link to="/meet/$code" params={{ code: r.code }} className="font-medium hover:underline">
                {r.title}
              </Link>
              <span className="text-xs text-muted-foreground">{formatWhen(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No open meetings" description="Start one and send its link to teammates." />
      )}
    </AppShell>
  );
}
