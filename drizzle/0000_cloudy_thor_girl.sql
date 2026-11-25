CREATE TABLE `api_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`version` text NOT NULL,
	`card_key` text NOT NULL,
	`info` text NOT NULL,
	`quantity` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_version_key` ON `cards` (`owner`,`version`,`card_key`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`mode` text NOT NULL,
	`filename` text NOT NULL,
	`headers` text NOT NULL,
	`expected` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`version` text NOT NULL,
	`row_no` integer NOT NULL,
	`card_key` text NOT NULL,
	`info` text NOT NULL,
	`raw` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rows_owner_version` ON `inventory_rows` (`owner`,`version`,`row_no`);--> statement-breakpoint
CREATE INDEX `rows_card` ON `inventory_rows` (`owner`,`version`,`card_key`);--> statement-breakpoint
CREATE TABLE `market` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`card_key` text NOT NULL,
	`product_id` text,
	`fetched_at` integer NOT NULL,
	`data` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_owner_card` ON `market` (`owner`,`card_key`);--> statement-breakpoint
CREATE TABLE `refresh_products` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`run_id` text NOT NULL,
	`product_id` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`spent` real DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner` text PRIMARY KEY NOT NULL,
	`active_version` text,
	`filename` text,
	`headers` text DEFAULT '[]' NOT NULL,
	`imported_at` integer,
	`updated_at` integer,
	`settings` text DEFAULT '{}' NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`usage` text DEFAULT '{}' NOT NULL,
	`import_lock` text
);
