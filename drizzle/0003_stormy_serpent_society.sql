CREATE TABLE `auth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` integer NOT NULL
);
