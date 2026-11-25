# SortSwift Market

React inventory workbench with persistent Cloudflare D1 storage, a GitHub Pages front end, and a dedicated Cloudflare Worker backend. The original Vinext entry remains available during migration. Original CSV values remain separate from retrieved market data. The app supports large imports, updates, replacement, search, filters, configurable columns, sales-date filters and exports.

## API.SH configuration

Configure the backend secret `API_SH_API_KEY`. It is never accepted from or returned to the browser. Existing encrypted TCGAPIs credentials are not reused. No paid data is requested on app load or import.

The existing provider monthly spending limit of 1,000 credits is never changed. The app reads `/v1/account`, `/v1/account/usage` and `/v1/account/logs` for free. Only `credits.free` is used as the free balance. Combined, plan and purchased balances are excluded. Provider `free_resets_at` and UTC spending information determine resets. A separate app ceiling never exceeds 1,000 monthly credits.

Every on-demand pull shows its API credit estimate before confirmation. The only paid request allowed is the sales-history endpoint with `range=annual`, `raw=0`, and a field projection for product/SKU identifiers, dates and quantities sold. This retrieves the widest history API.SH provides: up to one year of weekly totals. It remains one credit per unique Product ID. Product/pricing and listing endpoints are blocked before reserving credits. Extra fields are stripped before cached responses are saved. Compatible older annual cache entries are reused without another paid request.

D1 transactions reserve the free allowance before requests, shared by provider account. Reservations also enforce the approved refresh budget. Costs from headers and response metadata are recorded even on unsuccessful lookups. Uncertain requests are charged conservatively and force reconciliation. Interrupted reservations are never automatically refunded. No automatic paid retries, purchases, plan changes or spending-limit writes exist.

Request IDs support free `/v1/results/{request_id}` recovery for 30 days. Recovery does not charge the original body's repeated `credits_used`. Cache survives billing-period changes and inventory replacement. Coverage counters, analyzed/unanalyzed filters and new-product priority support incremental analysis over multiple months.

Imports ask only which column contains TCGplayer Product IDs (numeric IDs or product links). Every original header and the first row for each normalized Product ID are preserved; duplicate IDs are removed, and names and quantities are not required. A seller CSV's `TCGplayer Id` is a SKU, so it must not be selected as a Product ID column. Legacy SKU imports can still use saved Product ID mappings.

The table shows original CSV columns followed by market columns. Column selections and order save automatically and survive later uploads. Duplicate rows are removed before upload and enforced again on the server across chunks and later updates, keeping the first row rather than adding quantities together. Existing saved sales stay linked to the retained Product ID. Previously hidden headers stay hidden when they return; newly encountered CSV headers are shown automatically. Search includes all original values. The analysis CSV export appends market columns to the original columns, with distinct labels for collisions.

Imported CDN image links display as 64 × 90 px thumbnails without cropping. Clicking a thumbnail opens its original image. Images load lazily and use no API.SH credits; CSV exports keep the original URL values.

Only the explicit **Pull Sales History** action starts a lookup after the credit estimate. It retrieves full available history for the inventory, or the explicitly selected rows, independently of the table's date filter. There are no period or extra-data selections before pulling.

The table appends quantities sold, sales coverage and available history dates. It has no generated price, fee, profitability, valuation or listing metrics. Original CSV columns remain intact. Product-only rows combine counts across all returned variants; legacy SKU rows match their exact variant.

After pulling, From/To controls recalculate Units sold using saved bucket dates. Sorting, numeric filters, charts and appended CSV exports use the selected dates without provider calls. Annual buckets are weekly: the interface identifies them as whole reported weekly totals, never exact individual-day sales. Missing data remains N/A; a reported zero is zero. Repeated pulls replace matching bucket dates and preserve older saved annual buckets rather than double-counting them. Older cached history is readable without a paid refresh.

## Hosting and privacy

The GitHub Pages build contains client code only. Its sole hosting variable, `VITE_API_URL`, is the public backend URL. Never put API keys, OAuth client secrets or session-signing secrets in a `VITE_` variable, an Actions build artifact, or source control.

Production backend: `https://tcg-data-api.ejjernigan.workers.dev`. Cloudflare runtime secrets are `API_SH_API_KEY`, `SESSION_SECRET`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`. GitHub OAuth callback: `/auth/callback` on that backend. No repository scopes are requested. The backend accepts only the configured numeric GitHub owner ID; signing in with another account does not grant inventory access.

OAuth uses state cookies and PKCE. The frontend receives a one-use, 60-second authorization code bound to its browser verifier, exchanges it for an eight-hour signed session, and keeps that session in tab storage. API routes require that session and reject other web origins. Original API secrets never reach the browser. Public website code does not contain uploaded inventory or cached market responses.

Workers Free was verified before setup. This app uses Workers and D1 only; no R2, paid Worker plan, paid storage, cron job, AI service, or automatic upgrade is configured. Logs and traces are disabled. Free account limits are shared with other Workers. Reaching a free quota stops operations; it does not switch this app to a paid plan. Future account upgrades or provider pricing changes can change these conditions. The `FREE_ONLY` flag is an application deployment guard, not a substitute for keeping the Cloudflare account on its verified Free plan.

D1 Free limits include 5 million rows read and 100,000 rows written per UTC day, including index writes. Large inventory imports may exceed the daily write quota. Imports are staged so an interrupted or failed import does not replace the previous active inventory. The local 50,050-card test validates correctness; it is not a guarantee that the same workload fits within production's free daily quota.

## Build and deployment

- `npm run build:backend` generates the schema bootstrap from migrations and builds the standalone Worker.
- `npm run build:pages` builds `dist/pages`. Set `VITE_API_URL` to the backend URL only.
- `npx tsc --noEmit` and `node --test tests/core.mjs tests/inventory.mjs tests/credits.mjs tests/auth.mjs tests/cloudflare-auth.mjs` validate imports, column persistence, exports, credits, authentication, and data normalization.
- `npm run dev:pages` opens the local static frontend on port 5188.
- `wrangler dev --config cloudflare/wrangler.jsonc --local` runs a separate local backend. Local `.dev.vars` files are ignored by Git.
- `TEST_BACKEND=cloudflare TEST_ORIGIN=http://127.0.0.1:8787 node tests/api-smoke.mjs` checks large imports against the local backend only. It refuses production hosts and non-test inventories.
- Deploy the backend with `wrangler deploy --config cloudflare/wrangler.jsonc` after building. This command preserves server secrets.

GitHub's `CLOUDFLARE_API_URL` repository variable supplies the public URL to the Pages workflow. The workflow deliberately skips private repositories on this GitHub Free setup. Publishing requires the owner's approval to make repository source public. No API.SH secret is needed in GitHub Actions. The old OpenAI-hosted copy was deleted after GitHub Pages and Cloudflare sign-in were verified. The legacy `.openai` manifest is retained only as historical source metadata; do not use it to deploy this app.

## Provider references

- https://api.sh/openapi/tcgplayer.json
- https://api.sh/docs/tcgplayer-price-history
- https://api.sh/docs/tcgplayer-product
- https://api.sh/docs/tcgplayer-listings
- https://api.sh/docs/billing
- https://api.sh/docs#account
- https://api.sh/docs#results
