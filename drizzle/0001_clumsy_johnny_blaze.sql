CREATE TABLE `refresh_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`run_id` text NOT NULL,
	`card_key` text NOT NULL
);
