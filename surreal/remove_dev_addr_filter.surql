-- Remove the temporary database-side DevAddr whitelist after starting the
-- collector with `--dev-addr-prefix 26011A`.
-- Requires SurrealDB 3.0.5 or newer.

USE NS lora DB manta;

BEGIN TRANSACTION;

ALTER EVENT reception_to_uplink
ON TABLE gateway_reception
WHEN
    $event = "CREATE"
    AND $after.phy.payload_hash IS NOT NONE;

REMOVE EVENT discard_unmatched_reception
ON TABLE gateway_reception;

COMMIT TRANSACTION;
