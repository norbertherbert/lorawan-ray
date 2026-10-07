-- Enable the database-side DevAddr prefix filter for existing gateway writers.
-- Target: SurrealDB 3.2.4+. No collector changes are required.
-- Nonmatching creates are skipped without failing mixed-message transactions.
-- Join Requests and messages without DevAddr are skipped while filtering.

USE NS lora DB manta;

BEGIN TRANSACTION;

-- Record users cannot read or change this policy directly. Permission checks
-- read it with permissions bypassed; a caller's LET variables cannot shadow it.
    DEFINE TABLE IF NOT EXISTS packet_ingest_policy SCHEMAFULL PERMISSIONS NONE;
    DEFINE FIELD IF NOT EXISTS prefix ON packet_ingest_policy TYPE string
        ASSERT $value = ""
        OR $value = /^[0-9A-F]{1,8}$/;
    UPSERT ONLY packet_ingest_policy:dev_addr SET prefix = "18";
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
