CREATE TABLE `booking_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`duration` integer NOT NULL,
	`availability` text NOT NULL,
	`buffer` integer DEFAULT 0 NOT NULL,
	`min_notice` integer DEFAULT 60 NOT NULL,
	`horizon_days` integer DEFAULT 30 NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_pages_slug_unique` ON `booking_pages` (`slug`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`cancel_token` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_cancel_token_unique` ON `bookings` (`cancel_token`);--> statement-breakpoint
CREATE INDEX `bookings_owner` ON `bookings` (`owner_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `calendar_shares` (
	`calendar_id` text NOT NULL,
	`user_id` text NOT NULL,
	`level` text NOT NULL,
	PRIMARY KEY(`calendar_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_guests` (
	`event_id` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`response` text DEFAULT 'pending' NOT NULL,
	PRIMARY KEY(`event_id`, `email`)
);
--> statement-breakpoint
CREATE INDEX `event_guests_user` ON `event_guests` (`user_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`organizer_id` text NOT NULL,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`meet_code` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_calendar` ON `events` (`calendar_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `file_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_type` text,
	`r2_key` text,
	`trashed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_nodes_parent` ON `file_nodes` (`parent_id`);--> statement-breakpoint
CREATE INDEX `file_nodes_owner` ON `file_nodes` (`owner_id`);--> statement-breakpoint
CREATE TABLE `file_shares` (
	`node_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`node_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `file_stars` (
	`user_id` text NOT NULL,
	`node_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `node_id`)
);
--> statement-breakpoint
CREATE TABLE `mail_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_labels_name` ON `mail_labels` (`mailbox_id`,`name`);--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`in_reply_to` text,
	`refs` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_list` text DEFAULT '[]' NOT NULL,
	`cc_list` text DEFAULT '[]' NOT NULL,
	`subject` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`html` text,
	`date` text NOT NULL,
	`folder` text NOT NULL,
	`previous_folder` text,
	`is_read` integer DEFAULT false NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`raw_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_messages_thread` ON `mail_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_mailbox` ON `mail_messages` (`mailbox_id`,`folder`);--> statement-breakpoint
CREATE INDEX `mail_messages_mid` ON `mail_messages` (`mailbox_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `mail_thread_labels` (
	`thread_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`thread_id`, `label_id`)
);
--> statement-breakpoint
CREATE TABLE `mail_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`subject` text NOT NULL,
	`last_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_threads_mailbox` ON `mail_threads` (`mailbox_id`,`last_at`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`address` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_user_id_unique` ON `mailboxes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_address_unique` ON `mailboxes` (`address`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`creator_id` text NOT NULL,
	`title` text NOT NULL,
	`ended_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`work_start` text DEFAULT '09:00' NOT NULL,
	`work_end` text DEFAULT '17:00' NOT NULL,
	`work_days` text DEFAULT '1,2,3,4,5' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
