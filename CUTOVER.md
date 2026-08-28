# Normalized SurrealDB cutover

This runbook intentionally separates preparation from the destructive database
reset. Do not begin the **Cutover** section until every gateway binary,
credential, and frontend deployment value is ready.

## Verified artifacts

- ARM target: `armv7-unknown-linux-musleabihf`
- Binary: `../lorawan-sniffer/target/armv7-unknown-linux-musleabihf/release/lorawan-ray-collector`
- Format: static 32-bit ARM EABI5 executable, stripped
- SHA-256: record the checksum after building the final collector
- Ingestion schema: `../lorawan-sniffer/init_db.surql`
- Browser-authentication schema: `surreal/private_schema.surql` (ignored, secret-bearing)
- Gateway credential template: `../lorawan-sniffer/create_gw.surql`

The public ingestion and authentication schemas were applied together to an
ephemeral SurrealDB 3.2.4 database. A synthetic LR-FHSS packet was then written
through the gateway access method and read through the real Analyzer data
source.

## Preparation

1. Ensure `surreal/private_schema.surql` still contains the deployed Worker's
   signing key, issuer, audience, and administrator email. Never print or commit
   this file.
2. Generate a new unique password for every gateway. The old password must not
   be reused.
3. Prepare one private copy of `create_gw.surql` per gateway, replacing:
   - `REPLACE_GATEWAY_ID_UPPERCASE` with the 16-character uppercase gateway ID.
   - `REPLACE_WITH_A_UNIQUE_LONG_PASSWORD` with its new password.
4. Do not deploy the frontend until the normalized schema has been installed.
5. Upload the new binary without replacing the running binary:

   ```bash
   scp ../lorawan-sniffer/target/armv7-unknown-linux-musleabihf/release/lorawan-ray-collector \
     root@GATEWAY_ADDRESS:/root/lorawan-ray-collector.new
   ```

6. On the gateway, verify and protect it:

   ```sh
   sha256sum /root/lorawan-ray-collector.new
   chmod 700 /root/lorawan-ray-collector.new
   ```

   The checksum must equal the value in **Verified artifacts**.

7. Prepare `/root/start.sh` with mode `700`. The username is the uppercase
   gateway ID itself, without a `gw_` prefix or separators:

   ```sh
   #!/bin/sh
   export LISTEN_ADDR="127.0.0.1:1700"
   export SURREALDB_URL="https://INSTANCE.surreal.cloud"
   export SURREALDB_NAMESPACE="lorawan"
   export SURREALDB_DATABASE="sniffer"
   export SURREALDB_ACCESS="gateway_writer"
   export SURREALDB_USERNAME="GATEWAY_ID_UPPERCASE"
   export SURREALDB_PASSWORD="NEW_GATEWAY_PASSWORD"
   exec /root/lorawan-ray-collector
   ```

## Cutover

1. Stop every running collector and leave the packet forwarders pointed
   at their local UDP listener. Confirm no `lorawan-ray-collector` process remains.
2. In Surrealist, connected as the database owner, reset only this database:

   ```surql
   USE NS lorawan;
   REMOVE DATABASE sniffer;
   DEFINE DATABASE sniffer;
   USE DB sniffer;
   ```

3. Apply `../lorawan-sniffer/init_db.surql` in full.
4. Apply the ignored, secret-bearing `surreal/private_schema.surql` in full.
5. Apply each prepared private gateway-credential query.
6. Deploy the frontend. SurrealDB is the default packet source.
7. Sign in as the configured administrator. The Packet Analyzer should open
   directly and initially show an empty packet table.
8. On each gateway, install the uploaded binary while retaining a rollback copy:

   ```sh
   mv /root/lorawan-sniffer /root/lorawan-sniffer.previous
   mv /root/lorawan-ray-collector.new /root/lorawan-ray-collector
   chmod 700 /root/lorawan-ray-collector /root/start.sh
   nohup /root/start.sh >/dev/null 2>&1 </dev/null &
   ```

9. Send or receive one known LR-FHSS uplink and verify in the Analyzer:
   - Modulation is `LR-FHSS`.
   - Data rate has the expected `M…CW…` value.
   - Coding rate and hopping width are present.
   - Gateway reception details contain frequency drift and offset when reported.
10. Verify pagination, modulation filtering, packet selection, and details loading.

## Rollback boundary

The database reset cannot restore the old records. The user and invitation
tables are recreated empty, and the configured administrator account is created
again on first sign-in. The previous gateway executable remains recoverable as
`/root/lorawan-sniffer.previous` until the renamed collector has been accepted.
