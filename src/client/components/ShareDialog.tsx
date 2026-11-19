import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/client/components/ui/toggle-group";
import { errorMessage } from "@/client/lib/format";

export interface ShareRow {
  email: string;
  level: string;
}

/** Share one thing with members by email, at one of a few levels. */
export function ShareDialog({
  title,
  levels,
  load,
  save,
  onClose,
}: {
  title: string;
  levels: { value: string; label: string }[];
  load: () => Promise<ShareRow[]>;
  save: (email: string, level: string | null) => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState(levels[0]!.value);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void load().then(setRows);
  }, [load]);

  async function apply(target: string, value: string | null) {
    setPending(true);
    setError(null);
    try {
      const r = await save(target, value);
      if (r.error) setError(r.error);
      else {
        setEmail("");
        setRows(await load());
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) void apply(email.trim(), level);
          }}
        >
          <Input aria-label="Member email" data-testid="share-email" placeholder="Member email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup value={[level]} onValueChange={(v) => v[0] && setLevel(v[0])} variant="outline" size="sm">
              {levels.map((l) => (
                <ToggleGroupItem key={l.value} value={l.value}>
                  {l.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button type="submit" pending={pending} disabled={!email.trim()}>
              Share
            </Button>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </form>
        {rows.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {rows.map((r) => (
              <li key={r.email} data-testid="share-row" className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate">{r.email}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {levels.find((l) => l.value === r.level)?.label ?? r.level}
                  <Button variant="ghost" size="icon-xs" aria-label={`Stop sharing with ${r.email}`} onClick={() => apply(r.email, null)}>
                    <X />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
