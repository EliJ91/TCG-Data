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
  (table) => [uniqueIndex("market_owner_card").on(table.owner, table.cardKey)],
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
});
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
