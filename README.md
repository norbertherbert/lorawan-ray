# SurrealDB Cloud + Vite example

A small browser-based task list using the SurrealDB JavaScript SDK and the provided Cloud instance.

## Run it

You need Node.js 20.19+ or 22.12+ (required by Vite 7).

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, select where `nano-things-user` was defined, enter its system-user password, and connect. This example defaults to **Database user (main/main)**. A user created in Cloud's **Root Authentication** section should use **Root user** instead. The app creates a schema-less `todo` table automatically when the first task is added.

The database password is separate from the password used to sign in to your SurrealDB Cloud account. You can create or reset it in Surrealist under **Authentication → Root Authentication**.

The connection form is prefilled with the provided host, namespace, database, and username, and all four can be edited in the browser. To change the initial defaults without editing the source:

```bash
cp .env.example .env.local
```

Then change the values in `.env.local` and restart Vite. Do **not** add a `VITE_SURREAL_PASSWORD` variable: all `VITE_*` variables become public browser code.

## What the example demonstrates

- Connecting over WebSocket (`wss://`) with namespace, database, and database-user authentication
- Creating records with `db.create(...).content(...)`
- Reading and ordering records with a parameter-free `db.query(...)`
- Updating records with `db.update(...).merge(...)`
- Deleting records with `db.delete(...)`

## Security note

This is intentionally a direct browser-to-database learning example. A database/system user can have broad permissions, and anyone using the app can inspect requests and browser memory. For a public production app, use SurrealDB record access with narrowly scoped permissions, or place a backend API between the browser and the database.
