import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  owner: text("owner").primaryKey(),
  activeVersion: text("active_version"),
  filename: text("filename"),
  headers: text("headers").notNull().default("[]"),
  importedAt: integer("imported_at"),
  updatedAt: integer("updated_at"),
  settings: text("settings").notNull().default("{}"),
  secret: text("secret").notNull().default(""),
  usage: text("usage").notNull().default("{}"),
  importLock: text("import_lock"),
});
export const imports = sqliteTable("imports", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  mode: text("mode").notNull(),
  filename: text("filename").notNull(),
  headers: text("headers").notNull(),
  expected: integer("expected").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const inventoryRows = sqliteTable(
  "inventory_rows",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    version: text("version").notNull(),
    rowNo: integer("row_no").notNull(),
    cardKey: text("card_key").notNull(),
    info: text("info").notNull(),
    raw: text("raw").notNull(),
  },
  (table) => [
    index("rows_owner_version").on(table.owner, table.version, table.rowNo),
    index("rows_card").on(table.owner, table.version, table.cardKey),
  ],
);
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    version: text("version").notNull(),
    cardKey: text("card_key").notNull(),
    info: text("info").notNull(),
    quantity: real("quantity").notNull(),
  },
  (table) => [
    index("cards_version_product").on(table.owner, table.version, sql`json_extract(info, '$.productId')`),
    index("cards_version_sku").on(table.owner, table.version, sql`json_extract(info, '$.skuId')`),
    uniqueIndex("cards_version_key").on(
      table.owner,
      table.version,
      table.cardKey,
    ),
  ],
);
export const market = sqliteTable(
  "market",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    cardKey: text("card_key").notNull(),
    productId: text("product_id"),
    fetchedAt: integer("fetched_at").notNull(),
    data: text("data").notNull(),
    detail: text("detail").notNull(),
  },
  (table) => [
    uniqueIndex("market_owner_card").on(table.owner, table.cardKey),
    index("market_owner_product").on(table.owner, table.productId, table.cardKey),
  ],
);
export const apiCache = sqliteTable("api_cache", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
  data: text("data").notNull(),
});
export const refreshRuns = sqliteTable("refresh_runs", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  completed: integer("completed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  spent: real("spent").notNull().default(0),
  total: integer("total").notNull(),
  detail: text("detail").notNull(),
}, (t) => [index("refresh_owner_started").on(t.owner, t.startedAt)]);
export const refreshProducts = sqliteTable("refresh_products", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  runId: text("run_id").notNull(),
  productId: text("product_id").notNull(),
  status: text("status").notNull(),
});
export const refreshTargets = sqliteTable("refresh_targets", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  runId: text("run_id").notNull(),
  cardKey: text("card_key").notNull(),
});

export const creditAccounts = sqliteTable("credit_accounts", {
  id: text("id").primaryKey(),
  available: real("available").notNull().default(0),
  reserved: real("reserved").notNull().default(0),
  dirty: integer("dirty").notNull().default(1),
  period: text("period").notNull().default(""),
  snapshot: text("snapshot").notNull().default("{}"),
  lockToken: text("lock_token"),
  lockUntil: integer("lock_until").notNull().default(0),
});
export const apiRequests = sqliteTable("api_requests", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  accountId: text("account_id").notNull(),
  runId: text("run_id"),
  path: text("path").notNull(),
  createdAt: integer("created_at").notNull(),
  reserved: real("reserved").notNull(),
  charged: real("charged"),
  status: text("status").notNull(),
  requestId: text("request_id"),
  metadata: text("metadata").notNull().default("{}"),
}, (t) => [
  index("requests_owner_date").on(t.owner,t.createdAt),
  index("requests_account_date").on(t.accountId, t.createdAt),
  index("requests_run").on(t.runId),
]);

export const authCodes = sqliteTable("auth_codes", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  challenge: text("challenge").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

// D1 reports the number of rows scanned by each refresh plan. Keep headroom
// for browsing even if plans are regenerated repeatedly in the same UTC day.
export const refreshReadBudget = sqliteTable("refresh_read_budget", {
  day: integer("day").primaryKey(),
  rowsRead: integer("rows_read").notNull().default(0),
});
