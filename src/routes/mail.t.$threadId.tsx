import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Archive, Download, FolderInput, Inbox, Mail, MailOpen, Reply, ReplyAll, Forward, Sparkles, Star, StarOff, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/client/components/AppShell";
import { BackLink, PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { ComposeDialog, type Draft } from "@/client/mail/ComposeDialog";
import { errorMessage, formatBytes } from "@/client/lib/format";
import { aiAssist, getThread, saveAttachment, setLabel, threadAction } from "@/serverFunctions/mail";

export const Route = createFileRoute("/mail/t/$threadId")({
  loader: ({ params }) => getThread({ data: { id: params.threadId } }),
  component: ThreadPage,
});

type Thread = NonNullable<Awaited<ReturnType<typeof getThread>>>;
type Message = Thread["messages"][number];

const name = (a: { address: string; name?: string }) => a.name || a.address;

function ThreadPage() {
  const thread = Route.useLoaderData();
  if (!thread)
    return (
      <AppShell>
        <div data-testid="not-found">
          <EmptyState kind="error" title="Conversation not found" action={<Button variant="outline" render={<Link to="/mail" />} nativeButton={false}>Back to Mail</Button>} />
        </div>
      </AppShell>
    );
  return <ThreadView thread={thread} />;
}

function ThreadView({ thread }: { thread: Thread }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [label, setLabelName] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryOff, setSummaryOff] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const last = thread.messages[thread.messages.length - 1]!;
  const starred = thread.messages.some((m) => m.isStarred);
  const inTrash = thread.messages.every((m) => m.folder === "trash");
  const inArchive = thread.messages.some((m) => m.folder === "archive");
  const inInbox = thread.messages.some((m) => m.folder === "inbox");

  async function act(action: "star" | "unstar" | "unread" | "archive" | "inbox" | "trash" | "restore", message: string) {
    try {
      await threadAction({ data: { threadId: thread.id, action } });
      toast.success(message);
      if (action !== "star" && action !== "unstar") await router.navigate({ to: "/mail" });
      else await router.invalidate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function reply(m: Message, all: boolean) {
    const fromMe = m.from.address === thread.me;
    const primary = fromMe ? m.to : [m.from];
    const others = all ? [...m.to, ...m.cc].filter((a) => a.address !== thread.me && !primary.some((p) => p.address === a.address)) : [];
    setDraft({
      title: all ? "Reply all" : "Reply",
      to: primary.map((a) => a.address).join(", "),
      cc: others.map((a) => a.address).join(", "),
      subject: /^re:\s/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
      body: "",
      replyTo: m.id,
    });
  }

  function forward(m: Message) {
    setDraft({
      title: "Forward",
      to: "",
      cc: "",
      subject: /^fwd:\s/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${name(m.from)} <${m.from.address}>\nDate: ${new Date(m.date).toLocaleString()}\nSubject: ${m.subject}\n\n${m.text}`,
      keepAttachments: m.attachments.map((a) => ({ id: a.id, filename: a.filename })),
    });
  }

  async function summarize() {
    setSummarizing(true);
    try {
      const r = await aiAssist({ data: { mode: "summarize", thread: thread.messages.map((m) => `From: ${m.from.address}\n${m.text}`).join("\n\n---\n\n").slice(0, 40000) } });
      if ("off" in r) setSummaryOff(true);
      else if ("error" in r) toast.error(r.error);
      else setSummary(r.text);
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <AppShell wide>
      <PageHeader
        backLink={<BackLink to="/mail">Mail</BackLink>}
        title={thread.subject}
        description={
          thread.labels.length ? (
            <span className="flex flex-wrap gap-1">
              {thread.labels.map((l) => (
                <Badge key={l.id} variant="secondary" data-testid="thread-label">
                  {l.name}
                  <button
                    type="button"
                    aria-label={`Remove label ${l.name}`}
                    onClick={async () => {
                      await setLabel({ data: { threadId: thread.id, name: l.name, remove: true } });
                      await router.invalidate();
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </span>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap gap-1">
            <IconAction label={starred ? "Unstar" : "Star"} icon={starred ? StarOff : Star} onClick={() => act(starred ? "unstar" : "star", starred ? "Unstarred" : "Starred")} />
            <IconAction label="Mark unread" icon={Mail} onClick={() => act("unread", "Marked unread")} />
            {inInbox ? <IconAction label="Archive" icon={Archive} onClick={() => act("archive", "Archived")} /> : null}
            {inArchive && !inInbox ? <IconAction label="Move to Inbox" icon={Inbox} onClick={() => act("inbox", "Moved to Inbox")} /> : null}
            {inTrash ? (
              <IconAction label="Restore" icon={Undo2} onClick={() => act("restore", "Restored")} />
            ) : (
              <IconAction label="Trash" icon={Trash2} onClick={() => act("trash", "Moved to trash")} />
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!label.trim()) return;
            await setLabel({ data: { threadId: thread.id, name: label.trim() } });
            setLabelName("");
            await router.invalidate();
          }}
        >
          <Input aria-label="Label" data-testid="label-input" className="w-40" placeholder="Label" value={label} onChange={(e) => setLabelName(e.target.value)} />
          <Button type="submit" variant="outline" size="sm">
            Add label
          </Button>
        </form>
        <Button variant="outline" size="sm" onClick={summarize} pending={summarizing}>
          <Sparkles />
          Summarize
        </Button>
      </div>
      {summaryOff ? <p className="text-sm text-muted-foreground" data-testid="ai-off">AI isn't connected on this Gateway.</p> : null}
      {summary ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap" data-testid="ai-summary">
          {summary}
        </div>
      ) : null}
      <div className="space-y-4">
        {thread.messages.map((m) => (
          <article key={m.id} data-testid="message" className="rounded-lg border border-border bg-card">
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {name(m.from)} <span className="font-normal text-muted-foreground">&lt;{m.from.address}&gt;</span>
                </p>
                <p className="truncate text-muted-foreground">
                  To {m.to.map(name).join(", ")}
                  {m.cc.length ? `, cc ${m.cc.map(name).join(", ")}` : ""}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{new Date(m.date).toLocaleString()}</span>
            </header>
            <MessageBody message={m} />
            {m.attachments.length ? (
              <ul className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                {m.attachments.map((a) => (
                  <li key={a.id} data-testid="attachment" className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm">
                    <a className="hover:underline" href={`/api/mail/attachments/${a.id}`}>
                      {a.filename}
                    </a>
                    <span className="text-xs text-muted-foreground">{formatBytes(a.size)}</span>
                    <Button variant="ghost" size="icon-xs" aria-label={`Download ${a.filename}`} render={<a href={`/api/mail/attachments/${a.id}`} />} nativeButton={false}>
                      <Download />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Save ${a.filename} to Files`}
                      onClick={async () => {
                        const r = await saveAttachment({ data: { id: a.id } });
                        if ("error" in r && r.error) toast.error(r.error);
                        else toast.success("Saved to Files");
                      }}
                    >
                      <FolderInput />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => reply(last, false)}>
          <Reply />
          Reply
        </Button>
        <Button variant="outline" onClick={() => reply(last, true)}>
          <ReplyAll />
          Reply all
        </Button>
        <Button variant="outline" onClick={() => forward(last)}>
          <Forward />
          Forward
        </Button>
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
    </AppShell>
  );
}

function IconAction({ label, icon: Icon, onClick }: { label: string; icon: typeof MailOpen; onClick: () => void }) {
  return (
    <Button variant="outline" size="icon-sm" aria-label={label} title={label} onClick={onClick}>
      <Icon />
    </Button>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The message in a frame with no scripts, forms or same-origin access. */
function MessageBody({ message }: { message: Message }) {
  const doc = message.html
    ? `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;margin:16px;overflow-wrap:anywhere}</style>${message.html}`
    : `<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:14px;margin:16px;white-space:pre-wrap;overflow-wrap:anywhere}</style>${escapeHtml(message.text)}`;
  const [height, setHeight] = useState(160);
  return (
    <iframe
      title={`Message from ${message.from.address}`}
      data-testid="message-body"
      sandbox=""
      srcDoc={doc}
      className="w-full"
      style={{ height }}
      onLoad={(e) => {
        try {
          const h = e.currentTarget.contentDocument?.documentElement.scrollHeight;
          if (h) setHeight(Math.min(h + 8, 2000));
        } catch {
          // A sandboxed frame hides its document; keep the default height.
        }
      }}
    />
  );
}
