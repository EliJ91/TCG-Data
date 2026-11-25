CREATE TABLE `api_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`account_id` text NOT NULL,
	`run_id` text,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	`reserved` real NOT NULL,
	`charged` real,
	`status` text NOT NULL,
	`request_id` text,
	`metadata` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `requests_owner_date` ON `api_requests` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `credit_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`available` real DEFAULT 0 NOT NULL,
	`reserved` real DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 1 NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`lock_token` text,
	`lock_until` integer DEFAULT 0 NOT NULL
);
