# LoRaWAN Sniffer Viewer Repository Guide

## Scope

This repository contains the browser-based, read-only viewer for LoRaWAN
gateway receptions, its Cloudflare authentication Worker, and the SurrealDB
schema for Google-authenticated users and invitations.

The ingestion service is in the sibling repository `../lorawan-sniffer`. Before
changing its code or the gateway database contract, read
`../lorawan-sniffer/AGENTS.md` and preserve its independent Git history.

## Sources of truth

- `src/App.jsx` owns browser authentication and application-level state.
- `src/components/` implements the reception table, JSON dialog, and administrator UI.
- `src/lib.js` and `src/style.css` provide shared browser helpers and styling.
- `worker/src/index.js` verifies Google identity and issues the short-lived
  SurrealDB record-user token.
- `worker/test/` contains Worker unit tests.
- `surreal/schema.surql` owns the `user` and `invitation` tables and the
  `google` record-access method.
- `../lorawan-sniffer/init_db.surql` is authoritative for
  `gateway_credential`, `gateway_writer`, `gateway_rxpk`, `gateway_stat`, and
  their permissions.

Do not redefine or overwrite gateway-owned tables or permissions here. If the
viewer needs a new stored field or permission, coordinate the change with the
ingestion repository and keep one authoritative definition.

## Application contract

- Namespace: `lorawan`
- Database: `sniffer`
- The main data source is `gateway_rxpk`.
- The reception table summarizes selected `gateway`, `lorawan`, and `rxpk` fields, while its JSON
  dialog exposes the complete selected record except for the internal record ID.
- The browser remains read-only for gateway receptions. SurrealDB permissions,
  rather than UI controls alone, must enforce this.
- Only approved Google record users may select receptions.
- Keep the Worker issuer, audience, access name, namespace, and database aligned
  with `surreal/schema.surql` and the deployed configuration.

## Development commands

Use these from this repository:

```bash
npm install
npm run dev
npm test
npm run build
npm run worker:check
```

Use `npm install` when dependencies need installation or updating. For normal
verification, prefer `npm test`, `npm run build`, and `npm run worker:check`.

Commands such as `npm run worker:deploy`, `npm run worker:secret`, and production
database scripts change external systems. Run them only when the user explicitly
requests the corresponding deployment or database operation.

## Security constraints

- Never read out, print, copy into documentation, or commit `.env.local`, Worker
  secrets, Google client-secret files, SurrealDB JWT signing keys, passwords, or
  tokens.
- `VITE_*` values are public browser configuration and must never contain a
  secret.
- Keep the JWT signing secret only in Cloudflare Worker secrets and the
  corresponding SurrealDB access definition.
- Do not weaken Google token verification, invitation validation, origin checks,
  record permissions, or token lifetime without an explicit requirement and a
  security review.
- Preserve unrelated and uncommitted user changes.

## Completion criteria

Run the tests and production build for application changes. Run
`npm run worker:check` for Worker changes. For schema or gateway-record changes,
also inspect `../lorawan-sniffer/init_db.surql` and validate the relevant Rust tests.
Report which checks were run and any checks that could not run.
