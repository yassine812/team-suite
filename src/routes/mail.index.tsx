import { useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Archive, File, Inbox, PenSquare, Send, Star, Tag, Trash2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { AppShell } from "@/client/components/AppShell";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { ComposeDialog, type Draft } from "@/client/mail/ComposeDialog";
import { errorMessage, formatWhen } from "@/client/lib/format";
import { createMailbox, emptyTrash, getMailHome } from "@/serverFunctions/mail";

const search = z.object({
  folder: z.enum(["inbox", "sent", "starred", "archive", "trash"]).optional(),
  label: z.string().optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/mail/")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getMailHome({ data: deps }),
  component: MailPage,
});

const FOLDERS = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "starred", label: "Starred", icon: Star },
  { id: "sent", label: "Sent", icon: Send },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "trash", label: "Trash", icon: Trash2 },
] as const;

function MailPage() {
  const data = Route.useLoaderData();
  if (!data.mailbox) return <ClaimAddress domain={data.domain} />;
  return <Mailbox />;
}

function ClaimAddress({ domain }: { domain: string | null }) {
  const router = useRouter();
  const [local, setLocal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const r = await createMailbox({ data: { localPart: local } });
      if ("error" in r) setError(r.error);
      else await router.invalidate();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <AppShell>
      <PageHeader title="Choose your address" description="You can't change it later." />
      {domain ? (
        <form onSubmit={submit} className="grid max-w-md gap-3">
          <Label htmlFor="local-part">Address</Label>
          <div className="flex items-center gap-2">
            <Input id="local-part" data-testid="mailbox-local-part" value={local} onChange={(e) => setLocal(e.target.value)} autoFocus />
            <span className="shrink-0 text-sm text-muted-foreground">@{domain}</span>
          </div>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Button type="submit" pending={pending} disabled={!local.trim()}>
              Create address
            </Button>
          </div>
        </form>
      ) : (
        <EmptyState kind="error" title="Mail isn't set up yet" description="An admin needs to set MAIL_DOMAIN for this app." />
      )}
    </AppShell>
  );
}

function Mailbox() {
  const data = Route.useLoaderData();
  const s = Route.useSearch();
  const navigate = useNavigate({ from: "/mail/" });
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState(s.q ?? "");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const folder = s.q || s.label ? null : (s.folder ?? "inbox");
  const heading = s.q ? `Results for “${s.q}”` : s.label ? s.label : FOLDERS.find((f) => f.id === folder)!.label;

  return (
    <AppShell wide>
      <PageHeader
        title="Mail"
        description={<span data-testid="mailbox-address">{data.mailbox!.address}</span>}
        actions={
          <Button onClick={() => setDraft({ to: "", cc: "", subject: "", body: "", title: "New message" })}>
            <PenSquare />
            Compose
          </Button>
        }
      />
      <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
        <aside className="grid content-start gap-1">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void navigate({ search: q.trim() ? { q: q.trim() } : {} });
            }}
          >
            <Input type="search" aria-label="Search mail" data-testid="mail-search" placeholder="Search mail" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <nav className="mt-2 grid gap-0.5 text-sm">
            {FOLDERS.map((f) => (
              <Link
                key={f.id}
                to="/mail"
                search={{ folder: f.id }}
                data-testid={`folder-${f.id}`}
                onClick={() => setQ("")}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted ${folder === f.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
              >
                <f.icon className="size-4" aria-hidden />
                <span className="flex-1">{f.label}</span>
                {f.id === "inbox" && data.unread ? <span className="text-xs">{data.unread}</span> : null}
              </Link>
            ))}
            {data.labels.length ? <p className="mt-3 px-2 text-xs font-medium text-muted-foreground">Labels</p> : null}
            {data.labels.map((l) => (
              <Link
                key={l.id}
                to="/mail"
                search={{ label: l.name }}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted ${s.label === l.name ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
              >
                <Tag className="size-4" aria-hidden />
                {l.name}
              </Link>
            ))}
          </nav>
        </aside>
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{heading}</h2>
            {folder === "trash" && data.threads.length ? (
              <Button variant="outline" size="sm" onClick={() => setConfirmEmpty(true)}>
                Empty trash
              </Button>
            ) : null}
          </div>
          {data.threads.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {data.threads.map((t) => (
                <li key={t.id}>
                  <Link
                    to="/mail/t/$threadId"
                    params={{ threadId: t.id }}
                    data-testid="thread-row"
                    data-unread={t.unread ? "true" : "false"}
                    className="grid grid-cols-[1fr_auto] gap-x-3 px-4 py-3 transition-colors hover:bg-muted/60"
                  >
                    <span className={`truncate text-sm ${t.unread ? "font-semibold" : ""}`}>
                      {t.from}
                      {t.count > 1 ? <span className="ml-1 text-muted-foreground">({t.count})</span> : null}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {t.starred ? <Star className="size-3.5 fill-current text-warning" aria-label="Starred" /> : null}
                      {formatWhen(t.lastAt)}
                    </span>
                    <span className="col-span-2 truncate text-sm">
                      <span className={t.unread ? "font-semibold" : ""}>{t.subject}</span>
                      <span className="text-muted-foreground"> — {t.snippet}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              kind={s.q ? "filtered" : "no-data"}
              icon={s.q ? undefined : File}
              title={s.q ? "No mail matches" : folder === "trash" ? "Trash is empty" : "Nothing here"}
            />
          )}
        </section>
      </div>
      {draft ? (
        <ComposeDialog
          draft={draft}
          onClose={() => setDraft(null)}
          onSent={() => {
            setDraft(null);
            void router.invalidate();
          }}
        />
      ) : null}
      {confirmEmpty ? (
        <ConfirmDialog
          title="Empty trash?"
          confirmLabel="Delete forever"
          destructive
          pending={emptying}
          onClose={() => setConfirmEmpty(false)}
          onConfirm={async () => {
            setEmptying(true);
            try {
              await emptyTrash();
              toast.success("Trash emptied");
              await router.invalidate();
            } finally {
              setEmptying(false);
              setConfirmEmpty(false);
            }
          }}
        >
          Messages in the trash are deleted for good.
        </ConfirmDialog>
      ) : null}
    </AppShell>
  );
}
