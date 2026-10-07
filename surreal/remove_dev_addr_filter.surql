-- Disable database-side DevAddr filtering while retaining gateway ownership.
-- An empty prefix accepts every message, including those without a DevAddr.
-- Target: SurrealDB 3.2.4+. No collector changes are required.

USE NS lora DB manta;

BEGIN TRANSACTION;
    DEFINE TABLE IF NOT EXISTS packet_ingest_policy SCHEMAFULL PERMISSIONS NONE;
    DEFINE FIELD IF NOT EXISTS prefix ON packet_ingest_policy TYPE string
        ASSERT $value = ""
        OR $value = /^[0-9A-F]{1,8}$/;
    UPSERT ONLY packet_ingest_policy:dev_addr SET prefix = "";
    ALTER TABLE gateway_reception PERMISSIONS
        FOR select WHERE $auth.approved = true
        FOR create WHERE
            $auth.enabled = true
            AND gateway_id = <string> record::id($auth.id)
            AND string::starts_with(
                string::uppercase(lorawan.dev_addr ?? ""),
                (
                    packet_ingest_policy:dev_addr
                ).prefix ?? "!"
            )
        FOR update, delete NONE;
    ALTER EVENT reception_to_uplink ON TABLE gateway_reception WHEN $event = "CREATE"
    AND $after.phy.payload_hash IS NOT NONE;
    REMOVE EVENT IF EXISTS discard_unmatched_reception ON TABLE gateway_reception;
COMMIT TRANSACTION;
