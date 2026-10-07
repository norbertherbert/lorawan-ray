# Working on LoRa Manta

## Project map

- `src/`: React 19 application built with Vite and TypeScript, with some JavaScript/JSX. `App.jsx` owns Google authentication, session expiry, the SurrealDB connection, and account administration.
- `src/pages/Analyzer.tsx`: packet browsing, PER analysis, saved filters, and CSV export.
- `src/api/`: parameterized SurrealQL queries, normalization, pagination, mock data, saved filters, and export helpers. `surrealUplinks.ts` reads packet data; `savedFilters.ts` also writes user-owned filter records.
- `src/lorawan/`: packet types and device payload interpretation.
- `worker/`: authentication-only Cloudflare Worker. It verifies Google identity, signs SurrealDB record JWTs, and restores sessions through encrypted cookies. It does not ingest packets.
- `lora-manta-collector/`: Rust/Tokio Semtech UDP collector. It normalizes radio/LoRaWAN data and posts transactional SurrealQL batches directly to SurrealDB.
- `surreal/`: fresh-database bootstrap, packet-table recovery, registration switches, and DevAddr filter scripts.
- `.github/workflows/pages.yml`: GitHub Pages build/deployment workflow.

Read `README.md`, `lora-manta-collector/README.md`, and the relevant source before changing behavior. `CODE_REVIEW.md` records a dated review and unresolved findings; distinguish that snapshot from current deployed state.

## Local checks

Use installed dependencies where possible. The existing JavaScript tests import `.ts` files directly, so use a Node version supporting that behavior; the review used Node 24.16.0.

```sh
npm test
npm run typecheck
npm run build
npm run worker:check
cargo test --locked --manifest-path lora-manta-collector/Cargo.toml
```

`worker:check` is a Wrangler deployment **dry run**. `worker:deploy` publishes a Worker; do not substitute it for a check. The build includes typechecking. `checkJs` is disabled, so a passing typecheck does not establish correctness of `App.jsx` or Worker JavaScript.

When a SurrealDB CLI is available, validate SurrealQL against the target engine:

```sh
surreal validate surreal/*.surql
SURREAL_BIN=/path/to/surreal python3 surreal/tests/dev_addr_filter.py
```

Syntax validation does not test permissions, transaction rollback, or event side effects. For those changes, use a disposable database with synthetic data and the same engine version, and exercise record-user authentication as well as privileged access. Existing query-builder tests use mocked clients and do not execute their SQL against the database.

Run checks appropriate to the change. For ingestion policy changes, test a mixed accepted/rejected batch, missing device identifiers, Join Requests, and the resulting reception/uplink links. For PER, test datasets above 1,000 packets, repeated counters, rollover, and session resets. Do not use live packet inserts as a review test.

## Database and ingestion rules

- The configured namespace/database is `lora/manta`. Confirm the destination, version, and context before accessing a database. Cloud organization display names and IDs are distinct; discover instance IDs through the MCP tools rather than assuming they are permanent.
- Reviews and inspections use read-only queries (`INFO`, `SELECT`, or `EXPLAIN` without writes). A request to review production is not a request to migrate it. Keep operational changes within the user's explicitly authorized scope.
- Do not run `surreal/schema.surql` against an existing database as an upgrade. It is a fresh-database bootstrap with secret placeholders and authorization definitions. Use targeted migrations for upgrades.
- `restore_packet_tables.surql` overwrites packet schema and permissions, preserves the protected `packet_ingest_policy:dev_addr` prefix, and removes legacy discard logic. Test both active and disabled filtering when changing recovery.
- Keep creation permission tied to an enabled gateway credential and its canonical uppercase gateway ID. Collector authentication uses `gateway_writer` record access, not a root/database user. Browser users may read packets only when approved and may not write packet tables.
- `gateway_reception` represents one reception; `lorawan_uplink` represents a correlated PHY frame. Preserve links, counts, best reception, gateway IDs, and the stable 200 ms anchor when changing event logic.
- An event can write tables the triggering record user cannot write directly. Review all event side effects and their guards.
- The default DevAddr prefix is `18`, configured in the protected `packet_ingest_policy:dev_addr` record. An empty prefix disables filtering; a missing policy fails closed. Gateways cannot read or modify policy records directly. Do not use caller-shadowable parameters for this permission boundary. Make identifier-less and Join Request behavior explicit; Join Requests use DevEUI/JoinEUI, not DevAddr.
- The collector batches receptions into one transaction. A filtering `ASSERT` or `THROW` can roll back accepted messages in that batch. Verify rejection semantics before changing a filter.
- LoRaWAN `fcnt16` is the on-air 16-bit value, not a reconstructed session counter. `frm_payload_hex` is not decrypted by the collector. Do not interpret ciphertext as application telemetry without an explicit protocol/decryption contract.

## Application conventions

- Bind user values through SDK query parameters. Only validated, whitelisted fields/operators may enter query text. Preserve stable pagination tie-breakers and datetime precision.
- Keep mock and database data-source behavior aligned, including search limits and PER semantics. Surface incomplete analytical results instead of reporting them as complete.
- Treat saved filters and database rows as untrusted inputs. One invalid shared row must not prevent other filters from loading. Important validity and ownership rules belong in the database as well as the UI.
- Permissions enforce approval, administration, and ownership. UI checks and TypeScript types are not authorization boundaries.
- Preserve session expiry, origin checks, invitation hashing, and cookie scope. Never put authentication credentials into browser storage; theme preferences may use localStorage.
- Preserve LoRa/LR-FHSS/FSK distinctions and retain raw radio metadata for later inspection.

## Workspace and secrets

Preserve pre-existing uncommitted work. Avoid editing generated output, dependency trees, or lockfiles incidentally. Do not commit or deploy unless requested.

Do not print or copy `.env.local`, `worker/.dev.vars`, `private/`, password files, JWTs, signing keys, or credential records into documentation. `VITE_*` values are public; they must never contain secrets. Database `INFO` access definitions can contain JWT signing keys: redact them before displaying or saving schema output. Prefer narrowly scoped schema inspection when full access definitions are unnecessary.
