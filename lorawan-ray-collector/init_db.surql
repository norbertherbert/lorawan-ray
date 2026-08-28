-- Normalized LoRaWAN packet-forwarder ingestion schema (schema version 1).
-- Run this only in a new/empty database. It intentionally does not delete or
-- migrate existing records.
USE NS lorawan DB ray;

-- Each physical gateway gets one record-user credential. Record users cannot
-- read this table because its permissions remain NONE. The credential record
-- ID is the canonical uppercase gateway ID, so no separate username or
-- gateway_id field is needed.
DEFINE TABLE gateway_credential SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD password ON gateway_credential TYPE string;
DEFINE FIELD enabled ON gateway_credential TYPE bool DEFAULT true;

DEFINE ACCESS gateway_writer ON DATABASE TYPE RECORD
    SIGNIN (
        SELECT *
        FROM ONLY type::record(
            "gateway_credential",
            string::uppercase($user)
        )
        WHERE $user = /^[0-9A-Fa-f]{16}$/
          AND enabled = true
          AND crypto::argon2::compare(password, $pass)
    )
    DURATION FOR TOKEN 1d;

-- One record per reception at one gateway. The packet-forwarder object is
-- retained verbatim in raw_rxpk, while stable fields are normalized for the UI
-- and indexed queries.
DEFINE TABLE gateway_reception SCHEMAFULL;
DEFINE FIELD schema_version ON gateway_reception TYPE int
    ASSERT $value = 1;

DEFINE FIELD gateway_id ON gateway_reception TYPE string
    ASSERT $value = /^[0-9A-F]{16}$/;
DEFINE FIELD observed_at ON gateway_reception TYPE datetime;
DEFINE FIELD ingested_at ON gateway_reception TYPE datetime;
DEFINE FIELD timestamp_source ON gateway_reception TYPE string
    ASSERT $value IN ["gateway", "ingested"];

DEFINE FIELD raw_rxpk ON gateway_reception TYPE object FLEXIBLE;

DEFINE FIELD radio ON gateway_reception TYPE object;
DEFINE FIELD radio.frequency_hz ON gateway_reception TYPE option<int>;
DEFINE FIELD radio.modulation ON gateway_reception TYPE option<string>;
DEFINE FIELD radio.data_rate ON gateway_reception TYPE option<string | number>;
DEFINE FIELD radio.spreading_factor ON gateway_reception TYPE option<int>
    ASSERT $value IS NONE OR $value IN 5..=12;
DEFINE FIELD radio.bandwidth_hz ON gateway_reception TYPE option<int>;
DEFINE FIELD radio.coding_rate ON gateway_reception TYPE option<string>;
DEFINE FIELD radio.hopping_channel_width ON gateway_reception TYPE option<int>;
DEFINE FIELD radio.crc_status ON gateway_reception TYPE option<int>
    ASSERT $value IS NONE OR $value IN [-1, 0, 1];
DEFINE FIELD radio.best_rssi_dbm ON gateway_reception TYPE option<number>;
DEFINE FIELD radio.best_snr_db ON gateway_reception TYPE option<number>;
DEFINE FIELD radio.signals ON gateway_reception TYPE array<object> FLEXIBLE DEFAULT [];
DEFINE FIELD radio.signals.*.board ON gateway_reception TYPE option<int>;
DEFINE FIELD radio.signals.*.antenna ON gateway_reception TYPE option<int>;
DEFINE FIELD radio.signals.*.channel ON gateway_reception TYPE option<int>;
DEFINE FIELD radio.signals.*.rf_chain ON gateway_reception TYPE option<int>;
DEFINE FIELD radio.signals.*.rssi_channel_dbm ON gateway_reception TYPE option<number>;
DEFINE FIELD radio.signals.*.rssi_signal_dbm ON gateway_reception TYPE option<number>;
DEFINE FIELD radio.signals.*.snr_db ON gateway_reception TYPE option<number>;
DEFINE FIELD radio.signals.*.rssi_standard_deviation_db ON gateway_reception TYPE option<number>;
DEFINE FIELD radio.signals.*.fine_timestamp_ns ON gateway_reception TYPE option<int>;
DEFINE FIELD radio.signals.*.frequency_offset_hz ON gateway_reception TYPE option<number>;
DEFINE FIELD radio.signals.*.frequency_drift_hz ON gateway_reception TYPE option<number>;
DEFINE FIELD radio.signals.*.fine_timestamp_status ON gateway_reception TYPE option<int>;

DEFINE FIELD phy ON gateway_reception TYPE object;
DEFINE FIELD phy.payload_base64 ON gateway_reception TYPE option<string>;
DEFINE FIELD phy.payload_hex ON gateway_reception TYPE option<string>;
DEFINE FIELD phy.payload_size ON gateway_reception TYPE option<int>;
DEFINE FIELD phy.payload_hash ON gateway_reception TYPE option<string>;

-- The normalized decoder output is typed for the fields used by filters and
-- remains flexible so later protocol decoders can add fields compatibly.
DEFINE FIELD lorawan ON gateway_reception TYPE object FLEXIBLE;
DEFINE FIELD lorawan.decode_status ON gateway_reception TYPE string
    ASSERT $value IN ["decoded", "error", "unsupported"];
DEFINE FIELD lorawan.decode_error ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.mhdr_hex ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.major ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.mtype ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.dev_addr ON gateway_reception TYPE option<string>
    ASSERT $value IS NONE OR $value = /^[0-9A-F]{8}$/;
DEFINE FIELD lorawan.fcnt16 ON gateway_reception TYPE option<int>
    ASSERT $value IS NONE OR $value IN 0..=65535;
DEFINE FIELD lorawan.fport ON gateway_reception TYPE option<int>
    ASSERT $value IS NONE OR $value IN 0..=255;
DEFINE FIELD lorawan.fctrl_hex ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.adr ON gateway_reception TYPE option<bool>;
DEFINE FIELD lorawan.adr_ack_request ON gateway_reception TYPE option<bool>;
DEFINE FIELD lorawan.ack ON gateway_reception TYPE option<bool>;
DEFINE FIELD lorawan.class_b ON gateway_reception TYPE option<bool>;
DEFINE FIELD lorawan.fopts_hex ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.frm_payload_hex ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.mic_hex ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.join_eui ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.dev_eui ON gateway_reception TYPE option<string>;
DEFINE FIELD lorawan.dev_nonce ON gateway_reception TYPE option<int>;
DEFINE FIELD lorawan.mac_payload_hex ON gateway_reception TYPE option<string>;
DEFINE FIELD uplink ON gateway_reception TYPE option<record<lorawan_uplink>>;

-- One logical transmitted PHY frame, linked to every gateway reception that
-- matched the conservative correlation rule below.
DEFINE TABLE lorawan_uplink SCHEMAFULL;
DEFINE FIELD schema_version ON lorawan_uplink TYPE int
    ASSERT $value = 1;
DEFINE FIELD observed_at ON lorawan_uplink TYPE datetime;
DEFINE FIELD first_observed_at ON lorawan_uplink TYPE datetime;
DEFINE FIELD last_observed_at ON lorawan_uplink TYPE datetime;

DEFINE FIELD correlation ON lorawan_uplink TYPE object;
DEFINE FIELD correlation.method ON lorawan_uplink TYPE string;
DEFINE FIELD correlation.anchor_at ON lorawan_uplink TYPE option<datetime>;
DEFINE FIELD correlation.window_ms ON lorawan_uplink TYPE option<int>;

DEFINE FIELD phy ON lorawan_uplink TYPE object;
DEFINE FIELD phy.payload_base64 ON lorawan_uplink TYPE string;
DEFINE FIELD phy.payload_hex ON lorawan_uplink TYPE string;
DEFINE FIELD phy.payload_size ON lorawan_uplink TYPE int;
DEFINE FIELD phy.payload_hash ON lorawan_uplink TYPE string;

DEFINE FIELD lorawan ON lorawan_uplink TYPE object FLEXIBLE;
DEFINE FIELD mtype ON lorawan_uplink TYPE option<string>;
DEFINE FIELD dev_eui ON lorawan_uplink TYPE option<string>;
DEFINE FIELD dev_addr ON lorawan_uplink TYPE option<string>;
DEFINE FIELD fcnt16 ON lorawan_uplink TYPE option<int>;
DEFINE FIELD fport ON lorawan_uplink TYPE option<int>;
DEFINE FIELD modulation ON lorawan_uplink TYPE option<string>
    ASSERT $value IS NONE OR $value IN ["LORA", "LR-FHSS", "FSK"];
DEFINE FIELD data_rate ON lorawan_uplink TYPE option<string | number>;
DEFINE FIELD coding_rate ON lorawan_uplink TYPE option<string>;
DEFINE FIELD hopping_channel_width ON lorawan_uplink TYPE option<int>;

DEFINE FIELD receptions ON lorawan_uplink
    TYPE array<record<gateway_reception>> DEFAULT [];
DEFINE FIELD reception_count ON lorawan_uplink TYPE int DEFAULT 0;
DEFINE FIELD gateway_ids ON lorawan_uplink TYPE array<string> DEFAULT [];
DEFINE FIELD best_reception ON lorawan_uplink
    TYPE option<record<gateway_reception>>;
DEFINE FIELD best_gateway_id ON lorawan_uplink TYPE option<string>;
DEFINE FIELD best_rssi_dbm ON lorawan_uplink TYPE option<number>;
DEFINE FIELD best_snr_db ON lorawan_uplink TYPE option<number>;
DEFINE FIELD frequency_hz ON lorawan_uplink TYPE option<int>;
DEFINE FIELD spreading_factor ON lorawan_uplink TYPE option<int>;

-- Reliable gateway UTC timestamps permit multi-gateway correlation. An exact
-- PHY-payload hash and a stable sliding 200 ms anchor window identify
-- receptions of one transmission without fixed-bucket boundary errors.
-- Without gateway time, a unique key avoids merging distinct retransmissions
-- merely because they arrived at the database at about the same time.
DEFINE EVENT reception_to_uplink ON TABLE gateway_reception
    WHEN $event = "CREATE" AND $after.phy.payload_hash IS NOT NONE
    THEN {
        LET $has_gateway_time = $after.timestamp_source = "gateway";
        LET $matches = IF $has_gateway_time {
            SELECT *,
                math::abs(
                    time::millis(correlation.anchor_at)
                    - time::millis($after.observed_at)
                ) AS correlation_distance_ms
            FROM lorawan_uplink
            WHERE phy.payload_hash = $after.phy.payload_hash
                AND correlation.method = "payload_hash+gateway_time_200ms"
                AND correlation.anchor_at >= $after.observed_at - 200ms
                AND correlation.anchor_at <= $after.observed_at + 200ms
            ORDER BY correlation_distance_ms ASC
            LIMIT 1
        } ELSE {
            []
        };
        LET $previous = array::first($matches);
        LET $method = IF $has_gateway_time {
            "payload_hash+gateway_time_200ms"
        } ELSE {
            "single_reception"
        };
        LET $key = IF $previous IS NOT NONE {
            <string>record::id($previous.id)
        } ELSE IF $has_gateway_time {
            $after.phy.payload_hash + "_" + <string>time::millis($after.observed_at)
        } ELSE {
            $after.phy.payload_hash + "_" + <string>rand::uuid()
        };
        LET $uplink_id = type::record("lorawan_uplink", $key);
        LET $anchor_at = IF $previous IS NOT NONE {
            $previous.correlation.anchor_at
        } ELSE IF $has_gateway_time {
            $after.observed_at
        } ELSE {
            NONE
        };
        LET $window_ms = IF $has_gateway_time { 200 } ELSE { NONE };
        LET $receptions = array::add($previous.receptions ?? [], $after.id);
        LET $gateway_ids = array::add(
            $previous.gateway_ids ?? [],
            $after.gateway_id
        );
        LET $is_best = $previous IS NONE
            OR (
                $after.radio.best_rssi_dbm IS NOT NONE
                AND (
                    $previous.best_rssi_dbm IS NONE
                    OR $after.radio.best_rssi_dbm > $previous.best_rssi_dbm
                )
            );

        UPSERT $uplink_id SET
            schema_version = 1,
            observed_at = IF $previous IS NONE {
                $after.observed_at
            } ELSE {
                time::min([$previous.observed_at, $after.observed_at])
            },
            first_observed_at = IF $previous IS NONE {
                $after.observed_at
            } ELSE {
                time::min([$previous.first_observed_at, $after.observed_at])
            },
            last_observed_at = IF $previous IS NONE {
                $after.observed_at
            } ELSE {
                time::max([$previous.last_observed_at, $after.observed_at])
            },
            correlation = {
                method: $method,
                anchor_at: $anchor_at,
                window_ms: $window_ms
            },
            phy = $after.phy,
            lorawan = $after.lorawan,
            mtype = $after.lorawan.mtype,
            dev_eui = $after.lorawan.dev_eui,
            dev_addr = $after.lorawan.dev_addr,
            fcnt16 = $after.lorawan.fcnt16,
            fport = $after.lorawan.fport,
            modulation = IF $is_best {
                $after.radio.modulation
            } ELSE {
                $previous.modulation
            },
            data_rate = IF $is_best {
                $after.radio.data_rate
            } ELSE {
                $previous.data_rate
            },
            coding_rate = IF $is_best {
                $after.radio.coding_rate
            } ELSE {
                $previous.coding_rate
            },
            hopping_channel_width = IF $is_best {
                $after.radio.hopping_channel_width
            } ELSE {
                $previous.hopping_channel_width
            },
            receptions = $receptions,
            reception_count = array::len($receptions),
            gateway_ids = $gateway_ids,
            best_reception = IF $is_best { $after.id } ELSE { $previous.best_reception },
            best_gateway_id = IF $is_best {
                $after.gateway_id
            } ELSE {
                $previous.best_gateway_id
            },
            best_rssi_dbm = IF $is_best {
                $after.radio.best_rssi_dbm
            } ELSE {
                $previous.best_rssi_dbm
            },
            best_snr_db = IF $is_best {
                $after.radio.best_snr_db
            } ELSE {
                $previous.best_snr_db
            },
            frequency_hz = IF $is_best {
                $after.radio.frequency_hz
            } ELSE {
                $previous.frequency_hz
            },
            spreading_factor = IF $is_best {
                $after.radio.spreading_factor
            } ELSE {
                $previous.spreading_factor
            };

        UPDATE $after.id SET uplink = $uplink_id;
    };

-- Gateway status remains raw because it is operational metadata, not a packet
-- table. It is nevertheless contained by a schemafull record.
DEFINE TABLE gateway_stat SCHEMAFULL;
DEFINE FIELD schema_version ON gateway_stat TYPE int
    ASSERT $value = 1;
DEFINE FIELD gateway ON gateway_stat TYPE object;
DEFINE FIELD gateway.gateway_id ON gateway_stat TYPE string;
DEFINE FIELD gateway.ingested_at ON gateway_stat TYPE datetime;
DEFINE FIELD raw_stat ON gateway_stat TYPE object FLEXIBLE;

DEFINE INDEX reception_observed_at ON gateway_reception
    FIELDS observed_at;
DEFINE INDEX reception_gateway_time ON gateway_reception
    FIELDS gateway_id, observed_at;
DEFINE INDEX reception_frequency_time ON gateway_reception
    FIELDS radio.frequency_hz, observed_at;
DEFINE INDEX reception_sf_time ON gateway_reception
    FIELDS radio.spreading_factor, observed_at;
DEFINE INDEX reception_rssi_time ON gateway_reception
    FIELDS radio.best_rssi_dbm, observed_at;
DEFINE INDEX reception_snr_time ON gateway_reception
    FIELDS radio.best_snr_db, observed_at;
DEFINE INDEX reception_uplink ON gateway_reception FIELDS uplink;
DEFINE INDEX uplink_observed_at ON lorawan_uplink FIELDS observed_at;
DEFINE INDEX uplink_payload_anchor ON lorawan_uplink
    FIELDS phy.payload_hash, correlation.anchor_at;
DEFINE INDEX uplink_dev_addr_time ON lorawan_uplink FIELDS dev_addr, observed_at;
DEFINE INDEX uplink_dev_eui_time ON lorawan_uplink FIELDS dev_eui, observed_at;
DEFINE INDEX uplink_fport_time ON lorawan_uplink FIELDS fport, observed_at;
DEFINE INDEX uplink_modulation_time ON lorawan_uplink FIELDS modulation, observed_at;
DEFINE INDEX uplink_mtype_time ON lorawan_uplink FIELDS mtype, observed_at;
DEFINE INDEX uplink_fcnt_time ON lorawan_uplink FIELDS fcnt16, observed_at;
DEFINE INDEX uplink_sf_time ON lorawan_uplink FIELDS spreading_factor, observed_at;
DEFINE INDEX uplink_frequency_time ON lorawan_uplink FIELDS frequency_hz, observed_at;
DEFINE INDEX uplink_best_rssi_time ON lorawan_uplink FIELDS best_rssi_dbm, observed_at;
DEFINE INDEX uplink_best_snr_time ON lorawan_uplink FIELDS best_snr_db, observed_at;
DEFINE INDEX uplink_best_gateway_time ON lorawan_uplink FIELDS best_gateway_id, observed_at;

-- Approved Google record users can read packets. A gateway may create only its
-- own reception/status records; events perform logical-uplink updates without
-- granting gateways permission to alter shared records.
ALTER TABLE gateway_reception SCHEMAFULL
    PERMISSIONS
        FOR select WHERE $auth.approved = true
        FOR create WHERE
            $auth.enabled = true
            AND gateway_id = <string>record::id($auth.id)
        FOR update, delete NONE;

ALTER TABLE lorawan_uplink SCHEMAFULL
    PERMISSIONS
        FOR select WHERE $auth.approved = true
        FOR create, update, delete NONE;

ALTER TABLE gateway_stat SCHEMAFULL
    PERMISSIONS
        FOR create WHERE
            $auth.enabled = true
            AND gateway.gateway_id = <string>record::id($auth.id)
        FOR select, update, delete NONE;

-- Provision one credential per gateway after replacing every placeholder.
-- Keep the password out of source control and remove it from query history when
-- the database client supports doing so.
--
-- CREATE type::record("gateway_credential", "1032547698BADCFE") CONTENT {
--     password: crypto::argon2::generate("REPLACE_WITH_A_UNIQUE_LONG_PASSWORD"),
--     enabled: true
-- };
