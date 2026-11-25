CREATE TABLE `refresh_read_budget` (
	`day` integer PRIMARY KEY NOT NULL,
	`rows_read` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `requests_account_date` ON `api_requests` (`account_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `requests_run` ON `api_requests` (`run_id`);
--> statement-breakpoint
CREATE INDEX `cards_version_product` ON `cards` (`owner`,`version`,json_extract(info, '$.productId'));
--> statement-breakpoint
CREATE INDEX `cards_version_sku` ON `cards` (`owner`,`version`,json_extract(info, '$.skuId'));
--> statement-breakpoint
CREATE INDEX `market_owner_product` ON `market` (`owner`,`product_id`,`card_key`);
--> statement-breakpoint
CREATE INDEX `refresh_owner_started` ON `refresh_runs` (`owner`,`started_at`);