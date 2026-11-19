import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/** A member, keyed by the Gateway's user id, created on first sight. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  workStart: text("work_start").notNull().default("09:00"),
  workEnd: text("work_end").notNull().default("17:00"),
  workDays: text("work_days").notNull().default("1,2,3,4,5"),
  createdAt: text("created_at").notNull().default(now),
});

export const mailboxes = sqliteTable("mailboxes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  address: text("address").notNull().unique(),
  createdAt: text("created_at").notNull().default(now),
});

export const mailThreads = sqliteTable(
  "mail_threads",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id").notNull(),
    subject: text("subject").notNull(),
    lastAt: text("last_at").notNull(),
  },
  (t) => [index("mail_threads_mailbox").on(t.mailboxId, t.lastAt)],
);

export const mailMessages = sqliteTable(
  "mail_messages",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id").notNull(),
    threadId: text("thread_id").notNull(),
    messageId: text("message_id").notNull(),
    inReplyTo: text("in_reply_to"),
    references: text("refs"),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    to: text("to_list").notNull().default("[]"),
    cc: text("cc_list").notNull().default("[]"),
    subject: text("subject").notNull(),
    text: text("text").notNull().default(""),
    html: text("html"),
    date: text("date").notNull(),
    folder: text("folder", { enum: ["inbox", "sent", "archive", "trash"] }).notNull(),
    previousFolder: text("previous_folder"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    isStarred: integer("is_starred", { mode: "boolean" }).notNull().default(false),
    rawKey: text("raw_key"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("mail_messages_thread").on(t.threadId),
    index("mail_messages_mailbox").on(t.mailboxId, t.folder),
    index("mail_messages_mid").on(t.mailboxId, t.messageId),
  ],
);

export const mailAttachments = sqliteTable("mail_attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull(),
  mailboxId: text("mailbox_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  r2Key: text("r2_key").notNull(),
});

export const mailLabels = sqliteTable(
  "mail_labels",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("mail_labels_name").on(t.mailboxId, t.name)],
);

export const mailThreadLabels = sqliteTable(
  "mail_thread_labels",
  {
    threadId: text("thread_id").notNull(),
    labelId: text("label_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.labelId] })],
);

export const calendars = sqliteTable("calendars", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

export const calendarShares = sqliteTable(
  "calendar_shares",
  {
    calendarId: text("calendar_id").notNull(),
    userId: text("user_id").notNull(),
    level: text("level", { enum: ["freebusy", "details", "edit"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.calendarId, t.userId] })],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id").notNull(),
    organizerId: text("organizer_id").notNull(),
    title: text("title").notNull(),
    start: text("start_at").notNull(),
    end: text("end_at").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    timeZone: text("time_zone").notNull().default("UTC"),
    location: text("location").notNull().default(""),
    description: text("description").notNull().default(""),
    meetCode: text("meet_code"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("events_calendar").on(t.calendarId, t.start)],
);

export const eventGuests = sqliteTable(
  "event_guests",
  {
    eventId: text("event_id").notNull(),
    email: text("email").notNull(),
    userId: text("user_id"),
    response: text("response", { enum: ["pending", "yes", "no", "maybe"] })
      .notNull()
      .default("pending"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.email] }),
    index("event_guests_user").on(t.userId),
  ],
);

export const eventAttachments = sqliteTable("event_attachments", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  r2Key: text("r2_key").notNull(),
});

export const bookingPages = sqliteTable("booking_pages", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  calendarId: text("calendar_id").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  duration: integer("duration").notNull(),
  // JSON: [{ day: 0-6, start: "09:00", end: "17:00" }]
  availability: text("availability").notNull(),
  buffer: integer("buffer").notNull().default(0),
  minNotice: integer("min_notice").notNull().default(60),
  horizonDays: integer("horizon_days").notNull().default(30),
  timeZone: text("time_zone").notNull().default("UTC"),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull(),
    ownerId: text("owner_id").notNull(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    note: text("note").notNull().default(""),
    start: text("start_at").notNull(),
    end: text("end_at").notNull(),
    cancelToken: text("cancel_token").notNull().unique(),
    status: text("status", { enum: ["active", "cancelled"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("bookings_owner").on(t.ownerId, t.start)],
);

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  creatorId: text("creator_id").notNull(),
  title: text("title").notNull(),
  endedAt: text("ended_at"),
  createdAt: text("created_at").notNull().default(now),
});

export const fileNodes = sqliteTable(
  "file_nodes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    parentId: text("parent_id"),
    kind: text("kind", { enum: ["file", "folder"] }).notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull().default(0),
    contentType: text("content_type"),
    r2Key: text("r2_key"),
    trashedAt: text("trashed_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("file_nodes_parent").on(t.parentId),
    index("file_nodes_owner").on(t.ownerId),
  ],
);

export const fileShares = sqliteTable(
  "file_shares",
  {
    nodeId: text("node_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["viewer", "editor"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.nodeId, t.userId] })],
);

export const fileStars = sqliteTable(
  "file_stars",
  {
    userId: text("user_id").notNull(),
    nodeId: text("node_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nodeId] })],
);
