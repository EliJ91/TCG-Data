# SortSwift Market

Private inventory workbench using React, Vinext, and persistent Cloudflare D1 storage. Import SortSwift or TCGplayer CSVs, preserve original values, and fetch market data explicitly through a server-side TCGAPIs adapter.

## Use

Upload a CSV once. Update CSV merges by marketplace SKU or product/condition/printing/language identity. Replace CSV validates the complete file before atomically replacing the active inventory. Imported and retrieved data are stored separately. CSV exports can preserve the original TCGplayer columns or export analysis fields.

Open Settings to connect a TCGAPIs key and set your seller fees, minimum price, scoring weights, and refresh preferences. Keys are AES-GCM encrypted in server storage and never returned to the client. Automatic refresh is off by default. Refresh estimates are displayed before an on-demand request.

## Data definitions

TCGplayer Id in seller CSVs is a SKU, not a product ID. Parent product mappings are verified against product SKU metadata. Exact variants are matched by SKU, condition, printing, and language. Unavailable or unverified values are N/A.

Sales archives use three-day buckets. Window unit totals are lower bounds from fully contained buckets. Units and transactions are distinct. Units per transaction uses only buckets that report both. Daily rates describe observed bucket coverage. Live listings are an English-language US-shipping sample, not complete marketplace supply. Recent product-sale samples do not identify language or unit counts and are not assigned to an exact inventory SKU. Provider processing timestamps are separate from source-record timestamps.

Listing priority uses configurable weights for observed sales velocity, a demand proxy, and net proceeds. Cards with non-positive net proceeds score zero. Acquisition costs and taxes are excluded. Original CSV prices are never overwritten.

## Local development and checks

Use Node 22.13 or later. Run npm run dev after installing dependencies. The Sites starter provides loopback-only mock ChatGPT sign-in. Add a generated 32-byte base64 CREDENTIAL_ENCRYPTION_KEY to the ignored .dev.vars file for local credential storage. Production uses the corresponding secret configured in Sites.

Run node --test tests/core.mjs for CSV, SKU matching, volume accounting, and quota tests. Run node tests/api-smoke.mjs only against a clean local preview. This test imports 50,050 unique fixture cards and verifies persistent storage, pagination, filtering, idempotent updates, validation, export, and credential redaction. It refuses to replace non-fixture local inventory. Fixture data is never deployed.

The .openai/hosting.json manifest declares the private Site and DB binding. Drizzle migrations provision tables before publication. Local .dev.vars, database contents, node_modules, outputs, and build state are excluded from source control.

Official references

- https://help.tcgplayer.com/hc/en-us/articles/115002358027-Importing-and-Exporting-CSVs-to-Mass-Update-Prices-and-Quantities
- https://tcgapis.com/documentation
- https://api.tcgapis.com/documentation/json
- https://api.tcgapis.com/auth/docs-markdown
