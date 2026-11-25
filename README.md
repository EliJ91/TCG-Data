# SortSwift Market

Private React/Vinext inventory workbench with persistent Cloudflare D1 storage. Original CSV values remain separate from retrieved market data. The app supports large imports, updates, replacement, search, filters, configurable columns, scoring and exports.

## API.SH configuration

Configure the backend secret `API_SH_API_KEY`. It is never accepted from or returned to the browser. Existing encrypted TCGAPIs credentials are not reused. No paid data is requested on app load or import.

The existing provider monthly spending limit of 1,000 credits is never changed. The app reads `/v1/account`, `/v1/account/usage` and `/v1/account/logs` for free. Only `credits.free` is used as the free balance. Combined, plan and purchased balances are excluded. Provider `free_resets_at` and UTC spending information determine resets. A separate app ceiling never exceeds 1,000 monthly credits.

Every on-demand refresh shows an estimate. Default request: `/tcgplayer/v1/price-history?id=PRODUCT_ID&range=month`, one credit per product, including all variants. Users may explicitly choose quarterly, semiannual or annual history. Optional SKU pricing adds one product request; listing/competition samples add one page, each one credit. Fresh persistent local cache is reused without a provider call. Provider cache hits still cost credits and are accounted normally.

D1 transactions reserve the free allowance before requests, shared by provider account. Reservations also enforce the approved refresh budget. Costs from headers and response metadata are recorded even on unsuccessful lookups. Uncertain requests are charged conservatively and force reconciliation. Interrupted reservations are never automatically refunded. No automatic paid retries, purchases, plan changes or spending-limit writes exist.

Request IDs support free `/v1/results/{request_id}` recovery for 30 days. Recovery does not charge the original body's repeated `credits_used`. Cache survives billing-period changes and inventory replacement. Coverage counters, analyzed/unanalyzed filters and new-product priority support incremental analysis over multiple months.

A seller CSV's `TCGplayer Id` is a SKU, not a Product ID. Include an explicit Product ID column, reuse a previously verified mapping, or add the numeric product ID from the card's TCGplayer URL in card details. Returned SKU/condition/printing/language must match before assigning sales. There is no documented direct SKU-to-product API.SH endpoint, so the app does not spend credits guessing matches.

Monthly history is daily; longer history is weekly. Exact rolling totals require every completed UTC daily bucket in the period. Missing buckets are unknown, never zero. Average units per day uses reported completed daily buckets only. Weekly data is never presented as exact daily sales. Listing/seller samples are not total supply.

## Development

`npm run dev`, `npx tsc --noEmit`, `node --test tests/core.mjs tests/credits.mjs`, `node tests/api-smoke.mjs` (local preview only), then the Sites build helper. New D1 tables are added through migration 0002; historical migrations remain unchanged.

## Provider references

- https://api.sh/openapi/tcgplayer.json
- https://api.sh/docs/tcgplayer-price-history
- https://api.sh/docs/tcgplayer-product
- https://api.sh/docs/tcgplayer-listings
- https://api.sh/docs/billing
- https://api.sh/docs#account
- https://api.sh/docs#results
