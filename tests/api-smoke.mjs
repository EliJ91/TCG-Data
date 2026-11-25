import assert from "node:assert/strict";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "This fixture test runs only against a local preview.",
);
const signin = await fetch(origin + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = signin.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
assert(cookie, "The local mock sign-in must return a cookie.");
async function api(path, body) {
  const response = await fetch(origin + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(path + ": " + JSON.stringify(result));
  return result;
}
const before = await api("state");
assert(
  !before.filename || before.filename.startsWith("qa-"),
  "An existing non-test inventory must not be replaced.",
);
const anonymous = await fetch(origin + "/api/state");
assert.equal(anonymous.status, 401);
const headers = [
  "TCGplayer Id",
  "Product Name",
  "Set Name",
  "Number",
  "Condition",
  "Total Quantity",
  "TCG Marketplace Price",
  "Custom Note",
];
function row(index, quantity = 1) {
  const skuId = String(3000000 + index);
  return {
    info: {
      key: "sku:" + skuId,
      skuId,
      productId: "",
      name: "QA Card " + String(index).padStart(5, "0"),
      set: index % 2 ? "QA Set B" : "QA Set A",
      number: String(index),
      rarity: "",
      condition: "Near Mint",
      printing: "",
      language: "",
      quantity,
      originalPrice: 1.25,
    },
    raw: {
      "TCGplayer Id": skuId,
      "Product Name": "QA Card " + String(index).padStart(5, "0"),
      "Set Name": index % 2 ? "QA Set B" : "QA Set A",
      Number: String(index),
      Condition: "Near Mint",
      "Total Quantity": String(quantity),
      "TCG Marketplace Price": "1.25",
      "Custom Note": index === 0 ? 'Preserve, "quotes" and\nnewlines' : "0005",
    },
  };
}
async function importRows(rows, mode = "replace", filename = "qa-large.csv") {
  const { id } = await api("imports/start", {
    mode,
    filename,
    headers,
    count: rows.length,
  });
  for (let start = 0; start < rows.length; start += 500)
    await api("imports/chunk", {
      id,
      start,
      rows: rows.slice(start, start + 500),
    });
  return api("imports/commit", { id });
}
const rows = Array.from({ length: 50050 }, (_, index) => row(index));
rows.push(row(0, 2));
let state = await importRows(rows);
assert.equal(state.uniqueCards, 50050);
assert.equal(state.totalCards, 50052);
const query = (value) =>
  api("cards?q=" + encodeURIComponent(JSON.stringify(value)));
const first = await query({
  sort: "quantity",
  direction: "desc",
  page: 1,
  pageSize: 25,
});
assert.equal(first.rows[0].quantity, 3);
assert.equal(first.matches, 50050);
assert.equal(first.rows[0].marketPrice, null);
assert.equal(first.value, null);
const filtered = await query({
  filters: {
    search: "",
    categories: { set: ["QA Set A"] },
    numeric: [{ field: "quantity", min: "3", max: "4" }],
    freshness: "missing",
  },
  pageSize: 25,
});
assert.equal(filtered.matches, 1);
const missing = await query({
  filters: { freshness: "missing" },
  pageSize: 100,
});
assert.equal(missing.matches, 50050);
const plan = await api("market/plan", { filters: {}, onlyStale: true });
assert.equal(plan.groups, 50050);
assert(plan.maximumCredits > 0);
const disconnected = await fetch(origin + "/api/market/start", {
  method: "POST",
  headers: {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  },
  body: "{}",
});
assert.equal(disconnected.status, 409);
const original = await fetch(origin + "/api/export", {
  method: "POST",
  headers: {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ selected: [rows[0].info.key] }),
});
assert.equal(original.status, 200);
const exported = await original.text();
assert(exported.includes(headers.join(",")));
assert(exported.includes('Preserve, ""quotes""'));
const updateRows = [row(50049, 4), row(60000, 5)];
state = await importRows(updateRows, "update", "qa-update.csv");
assert.equal(state.uniqueCards, 50051);
assert.equal(state.totalCards, 50060);
state = await importRows(updateRows, "update", "qa-update.csv");
assert.equal(state.uniqueCards, 50051);
assert.equal(
  state.totalCards,
  50060,
  "Repeating an update must not add quantities a second time.",
);
const invalid = await api("imports/start", {
  mode: "replace",
  filename: "qa-invalid.csv",
  headers,
  count: 1,
});
const bad = row(1, -1);
const rejected = await fetch(origin + "/api/imports/chunk", {
  method: "POST",
  headers: {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ id: invalid.id, start: 0, rows: [bad] }),
});
assert.equal(rejected.status, 400);
assert.equal((await api("state")).uniqueCards, 50051);
await api("imports/cancel", { id: invalid.id });
const configured = await api("preferences", {
  key: "local-qa-placeholder-never-used-upstream",
});
assert.equal(configured.connected, true);
assert(!JSON.stringify(configured).includes("local-qa-placeholder"));
await api("preferences", { clearKey: true });
state = await importRows(
  [row(1, 2), row(2, 1), row(3, 4)],
  "replace",
  "qa-browser.csv",
);
assert.equal(state.uniqueCards, 3);
assert.equal(state.totalCards, 7);
assert.equal((await api("state")).filename, "qa-browser.csv");
console.log(
  "Verified 50,050 unique cards, persistence, filtering, pagination, CSV round-trip, idempotent updates, replacement validation, credential redaction, and zero automatic market requests.",
);
