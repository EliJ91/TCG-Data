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
const {normalizeMarket,accountSnapshot,chargedCredits,DAY}=await import(moduleUrl("../lib/api-sh.ts"));

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

const now=Date.parse("2026-11-24T19:00:00Z"),today=Date.parse("2026-11-24T00:00:00Z");
const info={skuId:"77",condition:"Near Mint",printing:"Holofoil",language:"EN"};
const points=Array.from({length:90},(_,i)=>({date:new Date(today-(90-i)*DAY).toISOString().slice(0,10),quantity_sold:2,transactions:1,market_price:10,low_sale:8,high_sale:12}));
const fixture=(range="month")=>({product_id:123,range,currency:"USD",series:[{sku:77,condition:"Near Mint",printing:"Holofoil",language:"English",points}]});
test("Monthly daily data produces exact complete UTC-day totals",()=>{
 const {metrics,detail}=normalizeMarket(info,fixture(),{},now);
 assert.equal(metrics.units7,14);assert.equal(metrics.units30,60);assert.equal(metrics.dailySales,2);assert.equal(metrics.transactions30,30);assert.equal(metrics.unitsPerTransaction,2);assert.equal(metrics.lowerBound,false);assert.equal(detail.coveredDays,30);
});
test("Weekly aggregates never become exact daily rates or rolling totals",()=>{
 const {metrics}=normalizeMarket(info,fixture("quarter"),{},now);
 for(const key of ["units7","units30","dailySales","transactions30","salesFrequency"])assert.equal(metrics[key],null,key);
 assert.equal(metrics.marketPrice,10);
});
test("Missing daily buckets and unmatched variants stay unknown, not zero",()=>{
 const data=fixture();data.series[0].points=points.slice(0,-1);
 assert.equal(normalizeMarket(info,data,{},now).metrics.units7,null);
 const unmatched=normalizeMarket({...info,condition:"Lightly Played"},fixture(),{},now).metrics;
 assert.equal(unmatched.available,false);assert.equal(unmatched.units30,null);assert.equal(unmatched.marketPrice,null);
 const empty=normalizeMarket(info,{product_id:123,range:"month",series:[]},{},now).metrics;
 assert.equal(empty.units30,null);
});
test("Real zero daily buckets remain valid zero sales",()=>{
 const data=fixture();data.series[0].points=points.map(p=>({...p,quantity_sold:0,transactions:0,market_price:0}));
 const {metrics}=normalizeMarket(info,data,{},now);assert.equal(metrics.units30,0);assert.equal(metrics.marketPrice,0);
});
test("Free bucket, UTC reset and fixed ceiling exclude purchased balance",()=>{
 const body={account:{id:"account",status:"active"},credits:{free:3,total:5003,payg:5000,free_resets_at:"2026-12-01T00:00:00Z"},spend:{this_month:997,today:0,monthly_limit:1000,daily_limit:null,period:"UTC"}};
 assert.equal(accountSnapshot(body,now).available,3);
 assert.equal(accountSnapshot({...body,credits:{...body.credits,free:0}},now).available,0);
 assert.equal(accountSnapshot({...body,spend:{...body.spend,period:"local"}},now).available,0);
 assert.equal(accountSnapshot(body,Date.parse("2026-12-01T00:00:00Z")).available,0);
 assert.equal(accountSnapshot({...body,spend:{...body.spend,this_month:1000}},now).available,0);
 assert.equal(accountSnapshot({...body,credits:{total:5003,free_resets_at:body.credits.free_resets_at}},now).verified,false);
});
test("Failed lookups count actual charges and combined remaining is never free allowance",()=>{
 const h=new Headers({"x-credits-used":"1","x-credits-remaining":"5003","x-request-id":"id"});
 assert.deepEqual(chargedCredits(h,{credits_used:1},1),{used:1,verified:true,combinedRemaining:5003,requestId:"id"});
 assert.equal(chargedCredits(new Headers(),{},1).verified,false);
 assert.equal(chargedCredits(new Headers({"x-credits-used":"0"}),{credits_used:1},1).used,1);
});
test("Listing samples are not total market supply or seller counts",()=>{
 const extras={listings:{total:100,next_page:2,listings:[{sku:77,condition:"Near Mint",printing:"Holofoil",language:"English",price:4,quantity:2,seller:{key:"a"}}]}};
 const {metrics}=normalizeMarket(info,fixture(),extras,now);
 assert.equal(metrics.sampleSupply,2);assert.equal(metrics.sampleSellers,1);assert.equal(metrics.totalSupply,null);assert.equal(metrics.competingSellers,null);assert.equal(metrics.activeListings,null);
});
