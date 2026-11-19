import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { fileNodes, fileShares, fileStars, users } from "@/db/schema";
import { findUserByEmail } from "./users";

export type Access = "owner" | "editor" | "viewer";
type Node = typeof fileNodes.$inferSelect;

/** The node and its ancestors, nearest first. */
async function lineage(id: string): Promise<Node[]> {
  const chain: Node[] = [];
  let next: string | null = id;
  while (next && chain.length < 64) {
    const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, next));
    if (!node) break;
    chain.push(node);
    next = node.parentId;
  }
  return chain;
}

/** What a member may do with a node: owner, a share on it or a folder above it, or nothing. */
export async function nodeAccess(userId: string, id: string): Promise<{ node: Node; access: Access; trashed: boolean } | null> {
  const chain = await lineage(id);
  const node = chain[0];
  if (!node) return null;
  const trashed = chain.some((n) => n.trashedAt);
  if (node.ownerId === userId) return { node, access: "owner", trashed };
  if (trashed) return null;
  const shares = await db
    .select()
    .from(fileShares)
    .where(and(eq(fileShares.userId, userId), inArray(fileShares.nodeId, chain.map((n) => n.id))));
  if (!shares.length) return null;
  return { node, access: shares.some((s) => s.role === "editor") ? "editor" : "viewer", trashed };
}

export interface FileRow {
  id: string;
  kind: "file" | "folder";
  name: string;
  size: number;
  contentType: string | null;
  createdAt: string;
  access: Access;
  starred: boolean;
  owner: string;
  trashed: boolean;
}

export const listInput = z
  .object({
    view: z.enum(["mine", "shared", "starred", "trash"]).default("mine"),
    folder: z.string().uuid().optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

async function decorate(userId: string, nodes: Node[], accessOf: (n: Node) => Access): Promise<FileRow[]> {
  const ids = nodes.map((n) => n.id);
  const stars = ids.length ? await db.select().from(fileStars).where(and(eq(fileStars.userId, userId), inArray(fileStars.nodeId, ids))) : [];
  const ownerIds = [...new Set(nodes.map((n) => n.ownerId))];
  const owners = ownerIds.length ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ownerIds)) : [];
  const starSet = new Set(stars.map((s) => s.nodeId));
  return nodes
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      name: n.name,
      size: n.size,
      contentType: n.contentType,
      createdAt: n.createdAt,
      access: accessOf(n),
      starred: starSet.has(n.id),
      owner: owners.find((o) => o.id === n.ownerId)?.email ?? "",
      trashed: !!n.trashedAt,
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
}

export async function listFiles(userId: string, input: z.infer<typeof listInput>) {
  if (input.folder) {
    const found = await nodeAccess(userId, input.folder);
    if (!found || found.node.kind !== "folder" || found.trashed) return null;
    const children = await db.select().from(fileNodes).where(and(eq(fileNodes.parentId, input.folder), isNull(fileNodes.trashedAt)));
    const path = (await lineage(input.folder)).reverse();
    const visible = [];
    for (const n of path) if (await nodeAccess(userId, n.id)) visible.push({ id: n.id, name: n.name });
    return { folder: { id: found.node.id, name: found.node.name, access: found.access }, path: visible, rows: await decorate(userId, children, () => found.access) };
  }
  if (input.q) {
    const like = `%${input.q.replace(/[%_]/g, "")}%`;
    const owned = await db.select().from(fileNodes).where(and(eq(fileNodes.ownerId, userId), isNull(fileNodes.trashedAt), sql`${fileNodes.name} like ${like}`)).limit(200);
    const ownedLive = [];
    for (const n of owned) if (!(await nodeAccess(userId, n.id))?.trashed) ownedLive.push(n);
    const sharedRows = await db.all<{ id: string }>(sql`
      with recursive down(id) as (
        select node_id from file_shares where user_id = ${userId}
        union select f.id from file_nodes f join down on f.parent_id = down.id)
      select f.id from down join file_nodes f on f.id = down.id where f.owner_id <> ${userId} and f.name like ${like} limit 200`);
    const shared: { node: Node; access: Access }[] = [];
    for (const r of sharedRows) {
      const a = await nodeAccess(userId, r.id);
      if (a) shared.push(a);
    }
    const accessMap = new Map<string, Access>(shared.map((s) => [s.node.id, s.access]));
    return { folder: null, path: [], rows: await decorate(userId, [...ownedLive, ...shared.map((s) => s.node)], (n) => accessMap.get(n.id) ?? "owner") };
  }
  if (input.view === "mine") {
    const nodes = await db.select().from(fileNodes).where(and(eq(fileNodes.ownerId, userId), isNull(fileNodes.parentId), isNull(fileNodes.trashedAt)));
    return { folder: null, path: [], rows: await decorate(userId, nodes, () => "owner") };
  }
  if (input.view === "trash") {
    const nodes = await db.select().from(fileNodes).where(and(eq(fileNodes.ownerId, userId), isNotNull(fileNodes.trashedAt)));
    return { folder: null, path: [], rows: await decorate(userId, nodes, () => "owner") };
  }
  const ids =
    input.view === "shared"
      ? (await db.select({ id: fileShares.nodeId }).from(fileShares).where(eq(fileShares.userId, userId))).map((r) => r.id)
      : (await db.select({ id: fileStars.nodeId }).from(fileStars).where(eq(fileStars.userId, userId))).map((r) => r.id);
  const found: { node: Node; access: Access }[] = [];
  for (const id of ids) {
    const a = await nodeAccess(userId, id);
    if (a && !a.trashed) found.push(a);
  }
  const accessMap = new Map(found.map((f) => [f.node.id, f.access]));
  return { folder: null, path: [], rows: await decorate(userId, found.map((f) => f.node), (n) => accessMap.get(n.id)!) };
}

function canWrite(a: { access: Access; trashed: boolean } | null) {
  return !!a && !a.trashed && (a.access === "owner" || a.access === "editor");
}

/** Where a new item goes: the member's own root, or a folder they can write to. */
async function targetFolder(userId: string, parentId: string | null): Promise<{ ownerId: string } | null> {
  if (!parentId) return { ownerId: userId };
  const a = await nodeAccess(userId, parentId);
  if (!canWrite(a) || a!.node.kind !== "folder") return null;
  return { ownerId: a!.node.ownerId };
}

export const nameSchema = z.string().trim().min(1).max(200).refine((n) => !/[\\/]/.test(n), "Names can't contain slashes");

export const folderInput = z.object({ name: nameSchema, parentId: z.string().uuid().nullable() }).strict();

export async function createFolder(userId: string, input: z.infer<typeof folderInput>) {
  const target = await targetFolder(userId, input.parentId);
  if (!target) return { error: "You can't add to that folder." };
  await db.insert(fileNodes).values({ id: crypto.randomUUID(), ownerId: target.ownerId, parentId: input.parentId, kind: "folder", name: input.name });
  return {};
}

export async function storageUsed(ownerId: string): Promise<number> {
  const [row] = await db.all<{ n: number | null }>(sql`select sum(size) as n from file_nodes where owner_id = ${ownerId} and kind = 'file'`);
  return row?.n ?? 0;
}

export function quotaBytes(setting: string | undefined): number {
  const mb = Number(setting);
  return (Number.isFinite(mb) && mb > 0 ? mb : 10240) * 1024 * 1024;
}

export async function addFile(
  bucket: R2Bucket,
  quota: number,
  userId: string,
  parentId: string | null,
  file: { name: string; type: string; body: ArrayBuffer | Uint8Array | ReadableStream; size: number },
): Promise<{ id: string } | { status: 404 | 413; error: string }> {
  const target = await targetFolder(userId, parentId);
  if (!target) return { status: 404, error: "Folder not found." };
  if ((await storageUsed(target.ownerId)) + file.size > quota) return { status: 413, error: "Not enough storage left." };
  const id = crypto.randomUUID();
  const key = `files/${target.ownerId}/${id}`;
  await bucket.put(key, file.body, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  await db.insert(fileNodes).values({ id, ownerId: target.ownerId, parentId, kind: "file", name: file.name.replace(/[\\/]/g, "_").slice(0, 200) || "file", size: file.size, contentType: file.type || "application/octet-stream", r2Key: key });
  return { id };
}

export async function readable(userId: string, id: string) {
  const a = await nodeAccess(userId, id);
  if (!a || a.node.kind !== "file" || !a.node.r2Key) return null;
  return a.node;
}

export const renameInput = z.object({ id: z.string().uuid(), name: nameSchema }).strict();

export async function rename(userId: string, { id, name }: z.infer<typeof renameInput>) {
  if (!canWrite(await nodeAccess(userId, id))) return false;
  await db.update(fileNodes).set({ name }).where(eq(fileNodes.id, id));
  return true;
}

export const moveInput = z.object({ id: z.string().uuid(), parentId: z.string().uuid().nullable() }).strict();

export async function move(userId: string, { id, parentId }: z.infer<typeof moveInput>): Promise<{ error?: string }> {
  const a = await nodeAccess(userId, id);
  if (!canWrite(a)) return { error: "You can't move this." };
  if (parentId === null) {
    if (a!.node.ownerId !== userId) return { error: "Only the owner can move this to My files." };
  } else {
    const t = await nodeAccess(userId, parentId);
    if (!canWrite(t) || t!.node.kind !== "folder") return { error: "You can't move items into that folder." };
    if (t!.node.ownerId !== a!.node.ownerId) return { error: "Items can only move between folders of the same owner." };
    if ((await lineage(parentId)).some((n) => n.id === id)) return { error: "A folder can't go inside itself." };
  }
  await db.update(fileNodes).set({ parentId }).where(eq(fileNodes.id, id));
  return {};
}

/** Folders the member could move an item into. */
export async function moveTargets(userId: string, id: string) {
  const a = await nodeAccess(userId, id);
  if (!a) return [];
  const folders = await db.select({ id: fileNodes.id, name: fileNodes.name }).from(fileNodes).where(and(eq(fileNodes.ownerId, a.node.ownerId), eq(fileNodes.kind, "folder"), isNull(fileNodes.trashedAt)));
  const out = [];
  for (const f of folders) {
    if (f.id === id) continue;
    const t = await nodeAccess(userId, f.id);
    if (canWrite(t) && !(await lineage(f.id)).some((n) => n.id === id)) out.push(f);
  }
  return out;
}

export const idInput = z.object({ id: z.string().uuid() }).strict();
export const starInput = z.object({ id: z.string().uuid(), starred: z.boolean() }).strict();

export async function star(userId: string, { id, starred }: z.infer<typeof starInput>) {
  if (!(await nodeAccess(userId, id))) return false;
  if (starred) await db.insert(fileStars).values({ userId, nodeId: id }).onConflictDoNothing();
  else await db.delete(fileStars).where(and(eq(fileStars.userId, userId), eq(fileStars.nodeId, id)));
  return true;
}

export async function setTrashed(userId: string, id: string, trashed: boolean) {
  const rows = await db
    .update(fileNodes)
    .set({ trashedAt: trashed ? new Date().toISOString() : null })
    .where(and(eq(fileNodes.id, id), eq(fileNodes.ownerId, userId)))
    .returning();
  return rows.length > 0;
}

export async function deleteForever(bucket: R2Bucket, userId: string, id: string) {
  const [node] = await db.select().from(fileNodes).where(and(eq(fileNodes.id, id), eq(fileNodes.ownerId, userId)));
  if (!node) return false;
  const all = await db.all<{ id: string; r2_key: string | null }>(sql`
    with recursive down(id) as (select ${id} union select f.id from file_nodes f join down on f.parent_id = down.id)
    select f.id, f.r2_key from down join file_nodes f on f.id = down.id`);
  const keys = all.map((r) => r.r2_key).filter((k): k is string => !!k);
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
  const ids = all.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    await db.batch([
      db.delete(fileShares).where(inArray(fileShares.nodeId, chunk)),
      db.delete(fileStars).where(inArray(fileStars.nodeId, chunk)),
      db.delete(fileNodes).where(inArray(fileNodes.id, chunk)),
    ]);
  }
  return true;
}

export const shareInput = z
  .object({ id: z.string().uuid(), email: z.string().trim().toLowerCase().email(), role: z.enum(["viewer", "editor"]).nullable() })
  .strict();

export async function share(userId: string, input: z.infer<typeof shareInput>): Promise<{ error?: string }> {
  const a = await nodeAccess(userId, input.id);
  if (!a || a.access !== "owner") return { error: "Only the owner can change sharing." };
  const target = await findUserByEmail(input.email);
  if (!target) return { error: "No member with that email has opened this app yet." };
  if (target === userId) return { error: "You already own this." };
  if (input.role === null) await db.delete(fileShares).where(and(eq(fileShares.nodeId, input.id), eq(fileShares.userId, target)));
  else
    await db
      .insert(fileShares)
      .values({ nodeId: input.id, userId: target, role: input.role })
      .onConflictDoUpdate({ target: [fileShares.nodeId, fileShares.userId], set: { role: input.role } });
  return {};
}

export async function shareList(userId: string, id: string) {
  const a = await nodeAccess(userId, id);
  if (!a || a.access !== "owner") return [];
  return db.select({ email: users.email, role: fileShares.role }).from(fileShares).innerJoin(users, eq(users.id, fileShares.userId)).where(eq(fileShares.nodeId, id));
}

/** Copies a stored object (a mail or event attachment) into the member's files. */
export async function saveCopy(bucket: R2Bucket, quota: number, userId: string, source: { r2Key: string; filename: string; contentType: string; size: number }) {
  const obj = await bucket.get(source.r2Key);
  if (!obj) return { error: "The attachment is gone." };
  const result = await addFile(bucket, quota, userId, null, { name: source.filename, type: source.contentType, body: await obj.arrayBuffer(), size: source.size });
  return "error" in result ? { error: result.error } : {};
}

export async function teamUsage() {
  return db.all<{ id: string; email: string; address: string | null; used: number | null }>(sql`
    select u.id, u.email, m.address, (select sum(size) from file_nodes f where f.owner_id = u.id and f.kind = 'file') as used
    from users u left join mailboxes m on m.user_id = u.id order by u.email`);
}
