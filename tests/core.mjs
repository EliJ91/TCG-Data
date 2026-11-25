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
const {normalizeMarket,salesOnlyResponse,salesHistoryPath,mergeSalesHistory,accountSnapshot,chargedCredits,DAY}=await import(moduleUrl("../lib/api-sh.ts"));

test("Only the selected Product ID column is required and every original value survives", () => {
  const input =
    '\uFEFFMy ID,Product Name,Custom Note\r\nhttps://www.tcgplayer.com/product/123/card,"Card, with commas","A ""quote""\nand newline"\r\n';
  const data = csv.prepareImport(input, {productId: "My ID"});
  assert.equal(data.rows[0].info.skuId, "");
  assert.equal(data.rows[0].info.productId, "123");
  assert.equal(data.rows[0].info.quantity, 0);
  assert.equal(data.rows[0].raw["Custom Note"], 'A "quote"\nand newline');
  assert.equal(data.rows[0].raw["Product Name"], "Card, with commas");
});
test("CSV validation checks the selected ID while leaving unrelated data untouched", () => {
  assert.throws(() => csv.parseCSV('a,b\n"unclosed,b'), /unclosed/);
  assert.throws(() => csv.parseCSV("a,b\n1,2,3"), /fields/);
  assert.equal(csv.prepareImport("Product ID,Quantity\n123,1.5").rows[0].raw.Quantity, "1.5");
  assert.throws(
    () =>
      csv.prepareImport("TCGplayerSKU,Product Name,Quantity\nCUSTOM-ID,Card,1"),
    /Choose/,
  );
  assert.throws(
    () =>
      csv.prepareImport(
        "TCGplayer Id,Product Name,Add to Quantity\n123,Card,2",
      ),
    /Choose/,
  );
  assert.throws(() => csv.prepareImport("Product ID,Note\nCUSTOM-ID,anything"), /Row 2/);
  assert.throws(() => csv.prepareImport("Product ID\nhttps://evil.test/product/123"), /Row 2/);
  const rows = csv.prepareImport("Product ID,Anything\n123,first\n123,second").rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].raw.Anything, "first");
});
test("Repeated IDs, leading zeros and product links keep the first original row only",()=>{
 const data=csv.prepareImport('Lookup,Note,Quantity\n00123,first,0005\n123,later,99\nhttps://www.tcgplayer.com/product/123/card,url,3\n124,other,1',{productId:'Lookup'});
 assert.equal(data.rows.length,2);assert.equal(data.duplicateCount,2);
 assert.equal(data.rows[0].info.productId,'123');assert.equal(data.rows[0].info.key,'product:123|row:0');
 assert.equal(data.rows[0].raw.Lookup,'00123');assert.equal(data.rows[0].raw.Note,'first');assert.equal(data.rows[0].raw.Quantity,'0005');
 assert.equal(data.rows[1].raw.Note,'other');
});
test("CSV preparation supports more than fifty thousand cards", () => {
  const input =
    "Product ID,Product Name,Total Quantity\n" +
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
test("Sales normalization keeps quantities and never adds prices or valuations",()=>{
 const {metrics,detail}=normalizeMarket(info,fixture(),{},now);
 assert.equal(metrics.unitsSold,180);assert.equal(detail.history.length,90);
 assert.equal(metrics.marketPrice,undefined);assert.equal(metrics.netProceeds,undefined);
 assert(detail.history.every(point=>Object.keys(point).sort().join(',')==='date,units'));
 const selected=salesOnlyResponse(fixture());
 assert(!JSON.stringify(selected).includes('market_price'));
 assert(!JSON.stringify(selected).includes('low_sale'));
 const path=new URL('https://api.api.sh'+salesHistoryPath('123'));
 assert.equal(path.searchParams.get('range'),'annual');assert.equal(path.searchParams.get('raw'),'0');
 assert(path.searchParams.get('fields').includes('series.points.quantity_sold'));
 assert(!path.searchParams.get('fields').includes('price'));
});
test("The widest weekly history keeps weekly counts without inventing individual days",()=>{
 const {metrics,detail}=normalizeMarket(info,fixture('annual'),{},now);
 assert.equal(metrics.unitsSold,180);assert.equal(metrics.granularity,'weekly');
 assert.equal(metrics.dailySales,undefined);assert.equal(metrics.units7,undefined);
 assert.equal(detail.history[0].units,2);
});
test("Product-only rows combine SKU quantities in one response",()=>{
 const input=fixture('annual');input.series.push({...input.series[0],sku:78,condition:'Lightly Played'});
 const {metrics}=normalizeMarket({productId:'123'},input,{},now);
 assert.equal(metrics.unitsSold,360);assert.equal(metrics.scope,'Product · all SKUs');
 input.series[1].points=points.map((point,i)=>i===0?{...point,quantity_sold:null}:point);
 assert.equal(normalizeMarket({productId:'123'},input,{},now).metrics.unitsSold,null);
});
test("Unknown or unmatched sales stay N/A; reported zero remains zero",()=>{
 assert.equal(normalizeMarket({...info,condition:'Lightly Played'},fixture(),{},now).metrics.unitsSold,null);
 assert.equal(normalizeMarket(info,{product_id:123,range:'annual',series:[]},{},now).metrics.unitsSold,null);
 const zero=fixture('annual');zero.series[0].points=points.map(point=>({...point,quantity_sold:0}));
 assert.equal(normalizeMarket(info,zero,{},now).metrics.unitsSold,0);
});
test("Saved sales history preserves older dates and replaces matching dates without double counting",()=>{
 const merged=mergeSalesHistory([{date:1,units:2,market:99},{date:2,units:3}],[{date:2,units:4},{date:3,units:8}]);
 assert.deepEqual(merged,[{date:1,units:2},{date:2,units:4},{date:3,units:8}]);
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
