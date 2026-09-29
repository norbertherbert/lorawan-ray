-- Temporary database-side DevAddr whitelist for an existing database.
-- Requires SurrealDB 3.0.5 or newer because it alters only the WHEN clause of
-- the existing reception_to_uplink event. Remove this filter after starting
-- the collector with `--dev-addr-prefix 26011A`.

USE NS lora DB manta;

BEGIN TRANSACTION;

ALTER EVENT reception_to_uplink
ON TABLE gateway_reception
WHEN
    $event = "CREATE"
    AND $after.phy.payload_hash IS NOT NONE
    AND string::starts_with(
        string::uppercase($after.lorawan.dev_addr ?? ""),
        "18"
    );

DEFINE EVENT OVERWRITE discard_unmatched_reception
ON TABLE gateway_reception
WHEN
    $event = "CREATE"
    AND !string::starts_with(
        string::uppercase($after.lorawan.dev_addr ?? ""),
        "18"
    )
THEN {
    DELETE $after.id;
};

COMMIT TRANSACTION;
