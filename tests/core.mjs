import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleUrl(path, replacements = {}) {
  let source = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  for (const [name, url] of Object.entries(replacements))
    source = source.replaceAll(
      'from "' + name + '"',
      "from " + JSON.stringify(url),
    );
  return (
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
}
const domain = moduleUrl("../lib/domain.ts");
const csv = await import(moduleUrl("../lib/csv.ts", { "./domain": domain }));
const stub =
  "data:text/javascript;base64," +
  Buffer.from(
    "export class AppError extends Error{constructor(message,status){super(message);this.status=status;}};export const apiKey=()=>{},buildQuery=()=>{},preferences=()=>{},workspace=()=>{};export const database=()=>({prepare(){return{bind(){return this},async first(){return{status:'running'}},async run(){return{meta:{changes:1}}}}}});",
  ).toString("base64");
const { normalizeMarket, provider } = await import(
  moduleUrl("../lib/market.ts", { "./domain": domain, "./data": stub })
);

test("CSV IDs stay SKUs and quoted original values survive parsing", () => {
  const input =
    '\uFEFFTCGplayer Id,Product Name,Set Name,Total Quantity,Custom Note\r\n4592422,"Card, with commas",Test Set,2,"A ""quote""\nand newline"\r\n';
  const data = csv.prepareImport(input);
  assert.equal(data.rows[0].info.skuId, "4592422");
  assert.equal(data.rows[0].info.productId, "");
  assert.equal(data.rows[0].info.quantity, 2);
  assert.equal(data.rows[0].raw["Custom Note"], 'A "quote"\nand newline');
  assert.equal(data.rows[0].raw["Product Name"], "Card, with commas");
});
test("CSV validation rejects malformed rows, fractional quantities, and managed inventory codes", () => {
  assert.throws(() => csv.parseCSV('a,b\n"unclosed,b'), /unclosed/);
  assert.throws(() => csv.parseCSV("a,b\n1,2,3"), /fields/);
  assert.throws(
    () => csv.prepareImport("TCGplayer Id,Product Name,Quantity\n123,Card,1.5"),
    /whole number/,
  );
  assert.throws(
    () =>
      csv.prepareImport("TCGplayerSKU,Product Name,Quantity\nCUSTOM-ID,Card,1"),
    /Map/,
  );
  assert.throws(
    () =>
      csv.prepareImport(
        "TCGplayer Id,Product Name,Add to Quantity\n123,Card,2",
      ),
    /Map/,
  );
});
test("CSV preparation supports more than fifty thousand cards", () => {
  const input =
    "TCGplayer Id,Product Name,Total Quantity\n" +
    Array.from(
      { length: 50001 },
      (_, index) => index + 1000 + ",QA Card " + index + ",1",
    ).join("\n");
  assert.equal(csv.prepareImport(input).rows.length, 50001);
});
const info = {
  key: "sku:77",
  skuId: "77",
  productId: "123",
  name: "Documented shape fixture",
  number: "1",
  set: "Fixture",
  rarity: "",
  condition: "Near Mint",
  printing: "Holofoil",
  language: "EN",
  quantity: 1,
  originalPrice: null,
};
const product = {
  productId: 123,
  skus: [
    {
      skuId: 77,
      productId: 123,
      condName: "Near Mint",
      condAbbr: "NM",
      printingName: "Holofoil",
      languageName: "English",
      langAbbr: "EN",
    },
  ],
};
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
function payload(rows = []) {
  return {
    sku: {
      data: {
        skus: [
          { skuId: 77, marketPrice: 0, lowPrice: 1.5, lowestListingPrice: 8 },
        ],
      },
    },
    archive: { data: { rows } },
    recent: {
      data: {
        sales: [
          {
            date: ago(1),
            condition: "Near Mint",
            variant: "Holofoil",
            price: 99,
          },
        ],
        lastUpdated: "2026-11-24T00:00:00Z",
      },
    },
  };
}
test("Exact SKU matching accepts documented language abbreviations and preserves zero prices", () => {
  const result = normalizeMarket(info, product, payload(), true);
  assert.equal(result.metrics.scope, "Exact SKU");
  assert.equal(result.metrics.marketPrice, 0);
  assert.equal(result.metrics.listingLow, 1.5);
  assert.equal(result.metrics.units30, null);
  assert.equal(result.metrics.lastSoldAt, null);
  assert.equal(result.metrics.soldAverage, null);
  assert.equal(result.detail.sources.recent.sourceUpdated, null);
  assert.equal(
    result.detail.sources.recent.processedAt,
    "2026-11-24T00:00:00Z",
  );
});
test("A conflicting inventory condition cannot receive another SKU's prices", () => {
  const result = normalizeMarket(
    { ...info, condition: "Lightly Played" },
    product,
    payload(),
    true,
  );
  assert.equal(result.metrics.marketPrice, null);
  assert.equal(result.metrics.scope, "Variant not matched");
});
test("Units and transactions use whole buckets and the same coverage for their ratio", () => {
  const rows = [
    {
      skuId: 77,
      bucketStartDate: ago(6),
      quantitySold: 12,
      transactionCount: 4,
      marketPrice: 2,
    },
    {
      skuId: 77,
      bucketStartDate: ago(2),
      quantitySold: 100,
      transactionCount: 1,
      marketPrice: 3,
    },
    {
      skuId: 77,
      bucketStartDate: ago(12),
      quantitySold: null,
      transactionCount: 10,
      marketPrice: 2,
    },
    {
      skuId: 999,
      bucketStartDate: ago(6),
      quantitySold: 999,
      transactionCount: 999,
      marketPrice: 99,
    },
  ];
  const result = normalizeMarket(info, product, payload(rows), true);
  assert.equal(result.metrics.units7, 12);
  assert.equal(result.metrics.units30, 12);
  assert.equal(result.metrics.transactions30, 14);
  assert.equal(result.metrics.unitsPerTransaction, 3);
  assert.equal(result.metrics.dailySales, 4);
  assert.equal(result.detail.coveredDays, 3);
});
test("Listing samples cannot become total marketplace supply", () => {
  const data = payload();
  data.listings = {
    data: {
      allListings: {
        "Near Mint": {
          Holofoil: {
            standard: [
              { listingId: 1, sellerName: "Fixture A", price: 2, quantity: 3 },
              { listingId: 2, sellerName: "Fixture B", price: 4, quantity: 5 },
            ],
            custom: [],
          },
        },
      },
    },
  };
  const result = normalizeMarket(info, product, data, false);
  assert.equal(result.metrics.sampleSupply, 8);
  assert.equal(result.metrics.sampleSellers, 2);
  assert.equal(result.metrics.listingMedian, 3);
  assert.equal(result.metrics.totalSupply, null);
  assert.equal(result.metrics.competingSellers, null);
  assert.equal(result.metrics.demandSupply, null);
  assert.equal(result.detail.completeArchive, false);
});
test("Exhausted allowance stops after one request instead of retrying every card", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        success: false,
        code: "INSUFFICIENT_ALLOWANCE",
        remaining: 0,
      }),
      { status: 429, headers: { "Retry-After": "5" } },
    );
  };
  try {
    await assert.rejects(
      () =>
        provider("fixture", "run", "fixture-key", "/api/v2/products/123", 1),
      (error) => error.status === 403,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});
test("A long provider Retry-After stops the refresh instead of retrying too early", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({ success: false, code: "ALLOWANCE_IN_USE" }),
      { status: 429, headers: { "Retry-After": "60" } },
    );
  };
  try {
    await assert.rejects(
      () =>
        provider("fixture", "run", "fixture-key", "/api/v2/products/123", 1),
      (error) => error.status === 429,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});
