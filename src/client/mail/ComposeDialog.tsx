import { useState } from "react";
import { Paperclip, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { errorMessage, fileToBase64 } from "@/client/lib/format";
import { aiAssist, send } from "@/serverFunctions/mail";

export interface Draft {
  to: string;
  cc: string;
  subject: string;
  body: string;
  replyTo?: string;
  keepAttachments?: { id: string; filename: string }[];
  title: string;
}

export function ComposeDialog({ draft, onClose, onSent }: { draft: Draft; onClose: () => void; onSent: (threadId: string) => void }) {
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [files, setFiles] = useState<File[]>([]);
  const [kept, setKept] = useState(draft.keepAttachments ?? []);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type, base64: await fileToBase64(f) })));
      const result = await send({ data: { to, cc, subject, text: body, replyTo: draft.replyTo, keepAttachments: kept.map((k) => k.id), attachments } });
      if ("error" in result) setError(result.error);
      else {
        toast.success("Message sent");
        onSent(result.threadId);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="compose-to">To</Label>
            <Input id="compose-to" data-testid="compose-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="compose-cc">Cc</Label>
            <Input id="compose-cc" data-testid="compose-cc" value={cc} onChange={(e) => setCc(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input id="compose-subject" data-testid="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <AiHelp body={body} onUse={setBody} />
          <Textarea aria-label="Message" data-testid="compose-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" render={<label />} nativeButton={false}>
              <Paperclip />
              Attach
              <input
                type="file"
                multiple
                className="sr-only"
                data-testid="compose-files"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setFiles((prev) => [...prev, ...picked]);
                  e.target.value = "";
                }}
              />
            </Button>
            {[...kept.map((k) => ({ key: k.id, name: k.filename, remove: () => setKept(kept.filter((x) => x.id !== k.id)) })), ...files.map((f, i) => ({ key: `${i}-${f.name}`, name: f.name, remove: () => setFiles(files.filter((_, j) => j !== i)) }))].map((a) => (
              <span key={a.key} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
                {a.name}
                <button type="button" aria-label={`Remove ${a.name}`} onClick={a.remove} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          {error ? (
            <Alert variant="destructive" data-testid="compose-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Discard
          </Button>
          <Button onClick={submit} pending={sending}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AiHelp({ body, onUse }: { body: string; onUse: (text: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"draft" | "rewrite" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: "draft" | "rewrite") {
    setBusy(mode);
    setError(null);
    try {
      const r = await aiAssist({ data: { mode, prompt, draft: mode === "rewrite" ? body : "" } });
      if ("off" in r) setOff(true);
      else if ("error" in r) setError(r.error);
      else setResult(r.text);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Ask AI" data-testid="ai-prompt" className="min-w-0 flex-1" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask AI to write or rewrite" />
        <Button size="sm" variant="outline" onClick={() => run("draft")} pending={busy === "draft"} disabled={!prompt.trim()}>
          Draft
        </Button>
        <Button size="sm" variant="outline" onClick={() => run("rewrite")} pending={busy === "rewrite"} disabled={!body.trim()}>
          Rewrite
        </Button>
      </div>
      {off ? (
        <p data-testid="ai-off" className="text-sm text-muted-foreground">
          AI isn't connected on this Gateway.
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {result !== null ? (
        <div className="grid gap-2">
          <p data-testid="ai-result" className="whitespace-pre-wrap rounded-md bg-card p-2 text-sm">
            {result}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { onUse(result); setResult(null); }}>
              Use this
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
