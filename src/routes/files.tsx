import { useCallback, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ChevronRight, File as FileIcon, Folder, FolderPlus, MoreHorizontal, Star, Upload } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { AppShell } from "@/client/components/AppShell";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { ShareDialog } from "@/client/components/ShareDialog";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
import { Progress } from "@/client/components/ui/progress";
import { formatBytes, formatWhen } from "@/client/lib/format";
import { createFolder, deleteNode, getFiles, getMoveTargets, getShares, moveNode, renameNode, shareNode, starNode, trashNode } from "@/serverFunctions/files";

const search = z.object({
  view: z.enum(["mine", "shared", "starred", "trash"]).optional(),
  folder: z.string().optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/files")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getFiles({ data: { view: deps.view ?? "mine", folder: deps.folder && /^[0-9a-f-]{36}$/.test(deps.folder) ? deps.folder : undefined, q: deps.q } }),
  component: FilesPage,
});

type Row = NonNullable<Awaited<ReturnType<typeof getFiles>>["list"]>["rows"][number];

const VIEWS = [
  { id: "mine", label: "My files" },
  { id: "shared", label: "Shared with me" },
  { id: "starred", label: "Starred" },
  { id: "trash", label: "Trash" },
] as const;

function FilesPage() {
  const data = Route.useLoaderData();
  const s = Route.useSearch();
  const navigate = useNavigate({ from: "/files" });
  const router = useRouter();
  const view = s.view ?? "mine";
  const list = data.list;
  const folder = list?.folder ?? null;
  const canAdd = s.q ? false : folder ? folder.access !== "viewer" : view === "mine";
  const [q, setQ] = useState(s.q ?? "");
  const [newFolder, setNewFolder] = useState(false);
  const [preview, setPreview] = useState<Row | null>(null);
  const [renaming, setRenaming] = useState<Row | null>(null);
  const [moving, setMoving] = useState<Row | null>(null);
  const [sharing, setSharing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => router.invalidate();
  const loadShares = useCallback(async () => (sharing ? (await getShares({ data: { id: sharing.id } })).map((r) => ({ email: r.email, level: r.role })) : []), [sharing]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const form = new FormData();
        form.set("file", f);
        if (folder) form.set("parentId", folder.id);
        const res = await fetch("/api/files", { method: "POST", body: form });
        if (!res.ok) toast.error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `${f.name} wasn't uploaded.`);
      }
      await refresh();
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <AppShell wide>
      <PageHeader
        title="Files"
        actions={
          canAdd ? (
            <>
              <Button variant="outline" onClick={() => setNewFolder(true)}>
                <FolderPlus />
                New folder
              </Button>
              <Button onClick={() => input.current?.click()} pending={uploading}>
                <Upload />
                Upload
              </Button>
              <input ref={input} type="file" multiple className="sr-only" data-testid="file-upload" onChange={(e) => upload(e.target.files)} />
            </>
          ) : null
        }
      />
      <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
        <aside className="grid content-start gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void navigate({ search: q.trim() ? { q: q.trim() } : {} });
            }}
          >
            <Input type="search" aria-label="Search files" data-testid="file-search" placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <nav className="grid gap-0.5 text-sm">
            {VIEWS.map((v) => (
              <Link
                key={v.id}
                to="/files"
                search={v.id === "mine" ? {} : { view: v.id }}
                onClick={() => setQ("")}
                className={`rounded-md px-2 py-1.5 transition-colors hover:bg-muted ${!s.q && !folder && view === v.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
              >
                {v.label}
              </Link>
            ))}
          </nav>
          <div className="grid gap-1.5 px-2 text-xs text-muted-foreground">
            <Progress value={Math.min(100, (data.used / data.quota) * 100)} aria-label="Storage used" />
            <span data-testid="storage-usage">
              {formatBytes(data.used)} of {formatBytes(data.quota)} used
            </span>
          </div>
        </aside>
        <section className="min-w-0 space-y-3">
          {list?.path.length ? (
            <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
              {list.path.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1">
                  {i ? <ChevronRight className="size-3.5" aria-hidden /> : null}
                  <Link to="/files" search={{ folder: p.id }} className="hover:text-foreground">
                    {p.name}
                  </Link>
                </span>
              ))}
            </nav>
          ) : (
            <h2 className="text-sm font-medium">{s.q ? `Results for “${s.q}”` : VIEWS.find((v) => v.id === view)!.label}</h2>
          )}
          {!list ? (
            <EmptyState kind="error" title="Folder not found" />
          ) : list.rows.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {list.rows.map((r) => (
                <li key={r.id} data-testid="file-row" className="flex items-center gap-3 px-4 py-2.5">
                  {r.kind === "folder" ? <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {r.kind === "folder" && !r.trashed ? (
                      <Link to="/files" search={{ folder: r.id }} className="hover:underline">
                        {r.name}
                      </Link>
                    ) : r.trashed ? (
                      r.name
                    ) : (
                      <button type="button" className="text-left hover:underline" onClick={() => setPreview(r)}>
                        {r.name}
                      </button>
                    )}
                  </span>
                  {r.starred ? <Star className="size-3.5 fill-current text-warning" aria-label="Starred" /> : null}
                  <span className="hidden w-40 truncate text-xs text-muted-foreground sm:block">{r.access === "owner" ? "Me" : r.owner}</span>
                  <span className="hidden w-16 text-right text-xs text-muted-foreground sm:block">{r.kind === "file" ? formatBytes(r.size) : ""}</span>
                  <span className="hidden w-16 text-right text-xs text-muted-foreground md:block">{formatWhen(r.createdAt)}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`} />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {r.trashed ? (
                        <>
                          <DropdownMenuItem onClick={async () => { await trashNode({ data: { id: r.id, trashed: false } }); toast.success("Restored"); await refresh(); }}>Restore</DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(r)}>Delete forever</DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          {r.kind === "file" ? (
                            <>
                              <DropdownMenuItem onClick={() => setPreview(r)}>Preview</DropdownMenuItem>
                              <DropdownMenuItem render={<a href={`/api/files/${r.id}?download=1`} />}>Download</DropdownMenuItem>
                            </>
                          ) : null}
                          {r.access !== "viewer" ? (
                            <>
                              <DropdownMenuItem onClick={() => setRenaming(r)}>Rename</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setMoving(r)}>Move</DropdownMenuItem>
                            </>
                          ) : null}
                          <DropdownMenuItem onClick={async () => { await starNode({ data: { id: r.id, starred: !r.starred } }); await refresh(); }}>{r.starred ? "Unstar" : "Star"}</DropdownMenuItem>
                          {r.access === "owner" ? (
                            <>
                              <DropdownMenuItem onClick={() => setSharing(r)}>Share</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={async () => { await trashNode({ data: { id: r.id, trashed: true } }); toast.success("Moved to trash"); await refresh(); }}>Move to trash</DropdownMenuItem>
                            </>
                          ) : null}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              kind={s.q ? "filtered" : "no-data"}
              title={s.q ? "No files match" : view === "trash" ? "Trash is empty" : view === "shared" ? "Nothing shared with you yet" : view === "starred" ? "No starred files" : "This folder is empty"}
            />
          )}
        </section>
      </div>
      {newFolder ? <NameDialog title="New folder" label="Create" testId="folder-name" initial="" onClose={() => setNewFolder(false)} onSubmit={async (name) => { const r = await createFolder({ data: { name, parentId: folder?.id ?? null } }); if (r.error) return r.error; await refresh(); }} /> : null}
      {renaming ? <NameDialog title="Rename" label="Rename" testId="rename-input" initial={renaming.name} onClose={() => setRenaming(null)} onSubmit={async (name) => { if (!(await renameNode({ data: { id: renaming.id, name } }))) return "You can't rename this."; await refresh(); }} /> : null}
      {moving ? <MoveDialog row={moving} onClose={() => setMoving(null)} onMoved={refresh} /> : null}
      {preview ? <PreviewDialog row={preview} onClose={() => setPreview(null)} /> : null}
      {sharing ? (
        <ShareDialog
          title={`Share ${sharing.name}`}
          levels={[
            { value: "viewer", label: "Viewer" },
            { value: "editor", label: "Editor" },
          ]}
          load={loadShares}
          save={(email, role) => shareNode({ data: { id: sharing.id, email, role: role as "viewer" | "editor" | null } })}
          onClose={() => setSharing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog title={`Delete ${deleting.name} forever?`} confirmLabel="Delete forever" destructive onClose={() => setDeleting(null)} onConfirm={async () => { await deleteNode({ data: { id: deleting.id } }); setDeleting(null); toast.success("Deleted"); await refresh(); }}>
          {deleting.kind === "folder" ? "Everything inside it is deleted too." : "This can't be undone."}
        </ConfirmDialog>
      ) : null}
    </AppShell>
  );
}

function NameDialog({ title, label, testId, initial, onClose, onSubmit }: { title: string; label: string; testId: string; initial: string; onClose: () => void; onSubmit: (name: string) => Promise<string | void> }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            const err = await onSubmit(name.trim()).catch(() => "Names can't be empty or contain slashes.");
            setPending(false);
            if (err) setError(err);
            else onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input aria-label="Name" data-testid={testId} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" pending={pending} disabled={!name.trim()}>
              {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ row, onClose, onMoved }: { row: Row; onClose: () => void; onMoved: () => void }) {
  const [targets, setTargets] = useState<{ id: string; name: string }[] | null>(null);
  if (targets === null) void getMoveTargets({ data: { id: row.id } }).then(setTargets);
  async function moveTo(parentId: string | null) {
    const r = await moveNode({ data: { id: row.id, parentId } });
    if (r.error) toast.error(r.error);
    else {
      toast.success("Moved");
      onMoved();
      onClose();
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {row.name}</DialogTitle>
        </DialogHeader>
        <ul className="grid max-h-80 gap-1 overflow-y-auto">
          {row.access === "owner" ? (
            <li>
              <Button variant="ghost" className="w-full justify-start" onClick={() => moveTo(null)}>
                My files
              </Button>
            </li>
          ) : null}
          {(targets ?? []).map((t) => (
            <li key={t.id}>
              <Button variant="ghost" className="w-full justify-start" onClick={() => moveTo(t.id)}>
                <Folder />
                {t.name}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const src = `/api/files/${row.id}`;
  const type = row.contentType ?? "";
  const [text, setText] = useState<string | null>(null);
  const isText = type.startsWith("text/") || /json|xml|csv|markdown/.test(type);
  if (isText && text === null) void fetch(src).then((r) => r.text()).then((t) => setText(t.slice(0, 200_000)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
        </DialogHeader>
        <div data-testid="file-preview" className="max-h-[70vh] overflow-auto rounded-lg bg-muted">
          {type.startsWith("image/") ? (
            <img src={src} alt={row.name} className="mx-auto max-h-[68vh]" />
          ) : type.startsWith("video/") ? (
            <video src={src} controls className="mx-auto max-h-[68vh] w-full" />
          ) : type === "application/pdf" ? (
            <iframe title={row.name} src={src} className="h-[68vh] w-full" />
          ) : isText ? (
            <pre className="p-4 text-sm whitespace-pre-wrap">{text ?? ""}</pre>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">No preview for this file type.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" render={<a href={`${src}?download=1`} />} nativeButton={false}>
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
