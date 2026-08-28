# LoRaWAN Ray Web UI

`lorawan-ray-webui` is the GUI component of the **LoRaWAN Ray** solution and is
displayed as **LoRaWAN Ray**. It is a React-based, read-only interface for
LoRaWAN packets, with administrator approval
and single-use invitations. Vite builds the static app for GitHub Pages, while a small Cloudflare
Worker verifies Google ID tokens and exchanges them for 15-minute SurrealDB record-user tokens.

```text
GitHub Pages ── Google ID token ──▶ Auth Worker
      │                                  │
      │                          SurrealDB record JWT
      │                                  │
      └──────── WSS + record JWT ────────▶ SurrealDB Cloud
```

The Worker is necessary because Google ID tokens cannot contain SurrealDB's required `ns`, `db`,
and `ac` claims. It never receives a SurrealDB system-user password and is not involved in normal
reception queries.

The Analyzer reads normalized `lorawan_uplink` records and their linked
`gateway_reception` records directly from SurrealDB using the authenticated
browser connection. Its structured filters, whitelisted sorting, and opaque
keyset cursors are evaluated server-side.

The Analyzer treats modulation as a first-class radio property. Its dense table shows modulation
and the packet-forwarder data-rate identifier, including LR-FHSS values such as `M0CW137`. LoRa
spreading factor is shown only in LoRa-specific details. LR-FHSS details retain hopping-channel
width and per-signal drift, offset, and RSSI-deviation measurements.

## Prerequisites

- Node.js 20.19+ or 22.12+
- A SurrealDB Cloud instance
- A Google OAuth **Web application** client ID
- A Cloudflare account for the Worker

## 1. Create one signing secret

Generate at least 64 random characters:

```bash
openssl rand -base64 64
```

This exact value is shared only between the Worker and SurrealDB. Never put it in `.env.local`, a
`VITE_*` variable, GitHub Actions, or source control.

## 2. Configure SurrealDB

Open [surreal/schema.surql](surreal/schema.surql) and make a temporary, untracked copy. In that copy:

1. Initialize the listener schema in `NS lorawan DB sniffer` first so
   `gateway_reception` and `lorawan_uplink` exist.
2. Replace `__SURREAL_JWT_SECRET__` with the secret from step 1.
3. Replace `__TOKEN_ISSUER__` with `tiny-tasks-auth`.
4. Replace `__TOKEN_AUDIENCE__` with `tiny-tasks-surrealdb`.
5. Replace `__ADMIN_EMAIL__` with the administrator's Google email.
6. Run the script as a database owner in Surrealist. That verified Google email is automatically
   approved and designated as administrator on first sign-in.

The schema creates deterministic `user:google_<google-sub>` records at first login. The listener's
`init_db.surql` owns normalized packet-table permissions: approved Google users may select logical
uplinks and receptions, while gateway-specific creation is preserved and browser users cannot
create, update, or delete packet records.

## Registration and invitations

- A first-time Google user without an invitation is registered as `approved: false` and sees an
  approval-pending screen.
- The administrator can approve pending users from the web app.
- The administrator can create expiring invitation links bound to a normalized Google email.
- Opening an invitation removes its token from the address bar before Google Sign-In begins.
- The browser stores only a SHA-256 token hash in SurrealDB; the raw token is shown to the
  administrator once.
- A valid invitation is consumed on first matching Google sign-in and approves that user.
- Invitations can be revoked before use. The administrator sends links manually, so no email
  provider or additional API key is required.

## 3. Configure Google

In Google Cloud Console, create an OAuth 2.0 client ID of type **Web application**. Add both origins:

- `http://localhost:5173`
- `https://norbertherbert.github.io` (or your custom domain)

For a project Pages site, do not include `/repository-name` in the authorized JavaScript origin;
OAuth origins contain only scheme, host, and port.

## 4. Configure and deploy the auth Worker

Edit [worker/wrangler.toml](worker/wrangler.toml):

- Set `GOOGLE_CLIENT_ID` to the Web client ID.
- Keep namespace/database set to `lorawan/sniffer`.
- Replace the GitHub origin in `ALLOWED_ORIGINS`.
- Keep issuer/audience synchronized with the SurrealQL script.

Store the signing secret in Cloudflare and deploy:

```bash
npm run worker:login
npm run worker:secret
npm run worker:deploy
```

Copy the resulting `https://...workers.dev` URL.

For local development, copy `worker/.dev.vars.example` to `worker/.dev.vars`, put the same signing
secret there, and run:

```bash
npm run worker:dev
```

## 5. Run the web app locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

In `.env.local`, set the Google client ID and use `http://localhost:8787` for
`VITE_AUTH_BROKER_URL` while the Worker is running locally.

Development and production builds use the normalized `lorawan_uplink` and
`gateway_reception` tables by default, so neither `npm run dev` nor
`npm run build` requires a data-source setting. To work with the
bundled normalized mock packets instead, start Vite with:

```bash
VITE_USE_MOCK_DATA=true npm run dev
```

All `VITE_*` values are public by design. They must never contain the signing secret, a database
password, or an OAuth client secret.

## 6. Deploy GitHub Pages

In the GitHub repository:

1. Select **Settings → Pages → Source → GitHub Actions**.
2. Under **Settings → Secrets and variables → Actions → Variables**, add:
   - `VITE_SURREAL_ENDPOINT`
   - `VITE_SURREAL_NAMESPACE`
   - `VITE_SURREAL_DATABASE`
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_AUTH_BROKER_URL` (the deployed Worker URL)
3. Push to `main`, or run the `Deploy web app to GitHub Pages` workflow manually.

The workflow in [.github/workflows/pages.yml](.github/workflows/pages.yml) builds the Vite app with
relative asset URLs, so it works at `/repository-name/` as well as on a custom domain.

## Security properties

- Google tokens are signature-, issuer-, audience-, and expiry-verified by the Worker.
- The Worker only accepts configured browser origins and returns no cookies.
- Surreal tokens last 15 minutes and Surreal WebSocket sessions last at most one hour.
- Tokens remain in memory; the app does not use local storage.
- SurrealDB record permissions—not the UI—enforce approval, administrator access, invitation
  management, and read-only reception access.
- The reception table summarizes `ingested_at`, `gateway_id`, `mtype`, `dev_addr`, `fport`, `fcnt`,
  `modu`, `datr`, and `freq`, with the complete read-only record available on demand in a JSON
  viewer. Results are paginated in SurrealDB with 25 rows per page by default and can be filtered
  by ingestion-time range, gateway ID, and DevAddr.
- Users cannot change their own approval or administrator fields.
- Invitation tokens contain 256 bits of randomness and are stored only as SHA-256 hashes.
- No root, namespace, or database-user credentials are shipped to the browser.
