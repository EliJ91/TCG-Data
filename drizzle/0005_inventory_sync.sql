CREATE TABLE IF NOT EXISTS inventory_sync (
  owner TEXT NOT NULL, version TEXT NOT NULL, previous_version TEXT NOT NULL, uploaded INTEGER NOT NULL,
  PRIMARY KEY(owner,version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sync_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_events_owner_seq ON sync_events(owner,seq);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS sync_market_insert AFTER INSERT ON market BEGIN
  INSERT INTO sync_events(owner,kind,subject) VALUES(NEW.owner,'market',NEW.card_key);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS sync_market_update AFTER UPDATE ON market
WHEN OLD.product_id IS NOT NEW.product_id OR OLD.fetched_at IS NOT NEW.fetched_at OR OLD.data IS NOT NEW.data OR OLD.detail IS NOT NEW.detail
BEGIN
  INSERT INTO sync_events(owner,kind,subject) VALUES(NEW.owner,'market',NEW.card_key);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS sync_mapping_insert AFTER INSERT ON api_cache
WHEN substr(NEW.id,1,length(NEW.owner)+9)=NEW.owner||'|sku-map:' BEGIN
  INSERT INTO sync_events(owner,kind,subject) VALUES(NEW.owner,'sku',substr(NEW.id,length(NEW.owner)+10));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS sync_mapping_update AFTER UPDATE ON api_cache
WHEN substr(NEW.id,1,length(NEW.owner)+9)=NEW.owner||'|sku-map:' AND OLD.data IS NOT NEW.data BEGIN
  INSERT INTO sync_events(owner,kind,subject) VALUES(NEW.owner,'sku',substr(NEW.id,length(NEW.owner)+10));
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS resource_windows (
  owner TEXT NOT NULL, action TEXT NOT NULL, window INTEGER NOT NULL, used INTEGER NOT NULL,
  PRIMARY KEY(owner,action)
);
