-- Roll back to the former paired-event filter, still keeping only prefix 18.
-- This is NOT the disable script; use remove_dev_addr_filter.surql to accept all.
-- The unused protected policy record is retained for a later reinstallation.
USE NS lora DB manta;

BEGIN TRANSACTION;
    ALTER TABLE gateway_reception PERMISSIONS
        FOR select WHERE $auth.approved = true
        FOR create WHERE
            $auth.enabled = true
            AND gateway_id = <string> record::id($auth.id)
        FOR update, delete NONE;
    ALTER EVENT reception_to_uplink ON TABLE gateway_reception WHEN $event = "CREATE"
    AND $after.phy.payload_hash IS NOT NONE
    AND string::starts_with(
        string::uppercase($after.lorawan.dev_addr ?? ""),
        "18"
    );
    DEFINE EVENT OVERWRITE discard_unmatched_reception ON TABLE gateway_reception
        WHEN $event = "CREATE" AND !string::starts_with(
            string::uppercase($after.lorawan.dev_addr ?? ""),
            "18"
        )
        THEN {
            DELETE $after.id;
        };
COMMIT TRANSACTION;
