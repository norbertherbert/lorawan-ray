# LoRaWAN Ray Collector

`lorawan-ray-collector` is the ingestion component of the **LoRaWAN Ray** solution.
It acts as a local LNS endpoint for the Semtech UDP Packet Forwarder protocol
v2, listens on UDP, acknowledges `PUSH_DATA` and `PULL_DATA` packets
immediately, and writes uplink packets to SurrealDB Cloud over HTTPS.

LR-FHSS is uplink-only in this protocol, so the sample contains an `rxpk` packet with `modu: "LR-FHSS"`. The listener does not transmit LR-FHSS downlinks.

## Test on Windows 11

Install Rust from <https://rustup.rs>, open PowerShell in this directory, and run:

```powershell
cargo test
cargo run -- --destination https://example.surreal.cloud --username gw_647FDAFFFE005E17 --password '<password>' --log-level debug
```

In a second PowerShell window:

```powershell
.\examples\send_sample.ps1
```

The sender should print an ACK with bytes `02 12 34 01`. The listener will print the gateway MAC and parsed packet size.

## Test on Fedora Linux

Install Rust and Python 3, then run the listener:

```bash
cargo test
cargo run -- --destination https://example.surreal.cloud \
  --username gw_647FDAFFFE005E17 \
  --password '<password>' \
  --log-level debug
```

In a second terminal, run the Bash sample sender:

```bash
./examples/send_sample.sh
```

To send a synthetic LoRaWAN Join Request instead:

```bash
./examples/send_join_request.sh
```

To send a synthetic LoRaWAN Unconfirmed Data Up frame:

```bash
./examples/send_unconfirmed_data_up.sh
```

To exercise each supported `rxpk` JSON layout separately:

```bash
./examples/send_legacy_rxpk.sh
./examples/send_jver1_rxpk.sh
./examples/send_jver2_rxpk.sh
```

These send respectively a legacy packet without `jver`, a gateway-v1 packet
with top-level signal metadata, and a gateway-v2 LR-FHSS packet using `rsig`.
Each script uses the current UTC time so its packet appears among the latest
receptions.

The script also accepts a custom listener address and port:

```bash
./examples/send_sample.sh 127.0.0.1 1700
```

It exits with an error if no ACK arrives within three seconds or if the ACK is not `02 12 34 01`.

## Command-line configuration

The collector is configured with command-line arguments. When starting it
through Cargo, place the collector arguments after `--`:

```bash
cargo run --release -- \
  --destination https://example.surreal.cloud \
  --ns lorawan \
  --db ray \
  --access gateway_writer \
  --username gw_647FDAFFFE005E17 \
  --password '<password>' \
  --listen-addr 127.0.0.1:1700 \
  --log-level info
```

`--destination` and `--username` are required. Supply the password with either
`--password` or `--password-file`; these options cannot be combined. The destination
is the HTTPS instance endpoint without `/sql` at the end. The defaults are:

- `--listen-addr 127.0.0.1:1700`
- `--ns lorawan`
- `--db ray`
- `--access gateway_writer`
- `--log-level info`

Valid log levels are `error`, `info`, and `debug`. Run
`lorawan-ray-collector --help` (or `cargo run -- --help`) for the complete
interface.

To read the password from a file instead of passing it directly:

```bash
./lorawan-ray-collector \
  --destination https://example.surreal.cloud \
  --username gw_647FDAFFFE005E17 \
  --password-file /path/to/password
```

A trailing newline in the password file is ignored.

Each `rxpk` entry is stored as an individual `gateway_reception` record. A
database event links receptions of the same transmitted PHY frame to one
`lorawan_uplink` record. A `stat` object is stored separately as a
`gateway_stat` record. The listener does not persist the UDP envelope, token,
or complete PUSH_DATA JSON.

Gateway status storage is disabled by default. To store the `stat` object in
addition to normal `rxpk` receptions, add:

```bash
--gateway-stats
```

Reception objects in `rxpk` continue to be stored normally.

To forward only uplinks from selected devices, provide a comma-separated list
of DevAddr and DevEUI values:

```bash
--white-list 26011ABC,0403F1A0,1122334455667788
```

Matching is case-insensitive. An optional `0x` prefix and `:` or `-` separators
are accepted. Data frames are matched by DevAddr and Join Requests by DevEUI.
Messages without a matching decoded identifier are acknowledged but are not
stored in SurrealDB. Gateway status storage remains controlled independently by
`--gateway-stats`.

The complete SurrealDB table, index, permission, and record-access initialization is available in [`init_db.surql`](init_db.surql). Review its namespace and database names before running it in SurrealDB Studio. It also contains a commented template for provisioning one credential per physical gateway.

An RF reception keeps the protocol-defined packet-forwarder object intact and
also stores normalized fields for indexed queries:

```json
{
  "schema_version": 1,
  "gateway_id": "1032547698BADCFE",
  "observed_at": "native SurrealDB datetime",
  "ingested_at": "native SurrealDB datetime",
  "timestamp_source": "gateway",
  "raw_rxpk": {
    "jver": 2,
    "time": "2026-08-25T12:00:00.123456Z",
    "freq": 865.4,
    "modu": "LORA",
    "datr": "SF7BW125",
    "data": "QLwaASaCOTADBAqquxEiM0Q=",
    "rsig": [{ "ant": 0, "rssic": -105, "lsnr": -2.5 }]
  },
  "radio": {
    "frequency_hz": 865400000,
    "modulation": "LORA",
    "data_rate": "SF7BW125",
    "spreading_factor": 7,
    "bandwidth_hz": 125000,
    "best_rssi_dbm": -105,
    "best_snr_db": -2.5,
    "signals": [
      {
        "antenna": 0,
        "rssi_channel_dbm": -105,
        "snr_db": -2.5
      }
    ]
  },
  "phy": {
    "payload_base64": "QLwaASaCOTADBAqquxEiM0Q=",
    "payload_hex": "40BC1A012682393003040AAABB11223344",
    "payload_size": 17,
    "payload_hash": "SHA-256 in uppercase hexadecimal"
  },
  "lorawan": {
    "decode_status": "decoded",
    "major": "LoRaWANR1",
    "mtype": "UnconfirmedDataUp",
    "dev_addr": "26011ABC",
    "fcnt16": 12345,
    "fopts_hex": "0304",
    "fport": 10,
    "frm_payload_hex": "AABB",
    "adr": true,
    "mic_hex": "11223344"
  }
}
```

The listener selects the receive-metadata layout using `jver`. A missing
`jver` is treated as the legacy packet-forwarder format, `jver: 1` uses the
gateway-v1 top-level signal fields, and `jver: 2` uses the per-antenna `rsig`
array. Common packet fields and the original `raw_rxpk` object are retained for
unknown future versions without guessing their signal layout. Legacy Base64
payloads using the URL-safe, unpadded alphabet are accepted and normalized to
standard padded Base64 in `phy.payload_base64`.

`raw_rxpk` is retained as received, including its timestamp string and any
vendor-specific fields. `observed_at` is the normalized native datetime.
If `rxpk.time` is absent, ingestion time is used and `timestamp_source` records
that fallback. Record IDs consist of the gateway ID, ingestion time, and a
random UUID, consistently with `gateway_stat` records.

The listener Base64-decodes `raw_rxpk.data` and writes the parsed LoRaWAN frame
to `lorawan`. Data frames include the message type, device address, on-air
16-bit frame counter, raw hexadecimal FOpts, port, encrypted FRMPayload, frame
control flags, and received MIC. Missing optional fields are omitted. Join
requests include `join_eui`, `dev_eui`, and `dev_nonce`. Invalid payloads remain
stored with `decode_status: "error"`; other frame types can be retained with
`decode_status: "unsupported"`. The MHDR major value cannot distinguish LoRaWAN
1.0.x from 1.1. The decoder does not decrypt FRMPayload, interpret potentially
encrypted FOpts, reconstruct the full frame counter, or validate the MIC without
the appropriate session keys and device state.

Normalization is performed by compiler-checked Rust structures before the
SurrealQL write is constructed. Only `raw_rxpk` and `raw_stat` remain flexible
JSON objects so packet-forwarder and vendor-specific fields are retained.

Logical-uplink correlation is deliberately conservative. Identical PHY payloads
with gateway-provided UTC timestamps within a sliding 200 ms window around a
stable anchor share one `lorawan_uplink`. This avoids fixed-bucket boundary
errors. Receptions without a gateway UTC timestamp do not merge. The
correlation method, anchor, and window are stored on the uplink. Identical
payloads outside the window remain separate so they can later be classified as
retransmissions. This is an initial heuristic, not session-aware duplicate or
retransmission classification.

Gateway status records follow the same organization, with locally added values
under `gateway` and the complete protocol object under `raw_stat`. The original
`stat.time` name and value are retained inside that object.

For example:

```surql
LET $gateway_id = "1032547698BADCFE";
LET $from = time::now() - 24h;
LET $until = time::now();

SELECT observed_at, radio.frequency_hz, radio.modulation,
       radio.data_rate, radio.signals, uplink
FROM gateway_reception:
    [$gateway_id, $from, NONE]..=
    [$gateway_id, $until, ..];
```

## Restricted gateway authentication

Run [`init_db.surql`](init_db.surql) from an administrator session, then provision a unique `gateway_credential` record for each physical gateway using the template at the end of that file. The credential record ID and `--username` are both the gateway's 16-character hexadecimal ID; the access method normalizes the supplied username to uppercase. The credential record stores only the password hash and enabled flag. The collector signs in through the shared `gateway_writer` record-access method, and table permissions restrict it to creating records for its own gateway ID in `gateway_reception` and `gateway_stat`. A database event maintains shared `lorawan_uplink` records without granting gateways direct write access to that table.

Configure the process using arguments:

```bash
./lorawan-ray-collector \
  --destination https://<instance>.surreal.cloud \
  --username 1032547698BADCFE \
  --password '<password>'
```

`--access` defaults to `gateway_writer`. At startup the collector authenticates the gateway record and caches the returned JWT. If a query receives HTTP `401 Unauthorized` or `403 Forbidden`, it signs in again and retries that query once. Authentication messages are shown at `info` and `debug` log levels. Rotate a gateway password by updating the matching `gateway_credential.password` with a newly generated Argon2 hash.

## Kerlink ARM/Linux build

The Kerlink gateway reports `armv7l`. On Fedora, build a statically linked
32-bit ARM binary with `cross` and Podman.

Install the required Rust target and `cross` once:

```bash
rustup target add armv7-unknown-linux-musleabihf
cargo install cross --locked
```

From the repository root, build the release binary:

```bash
CROSS_CONTAINER_ENGINE=podman \
cross build --release --target armv7-unknown-linux-musleabihf
```

The resulting binary is:

```text
target/armv7-unknown-linux-musleabihf/release/lorawan-ray-collector
```

Verify its architecture and record its checksum before copying it to the
gateway:

```bash
file target/armv7-unknown-linux-musleabihf/release/lorawan-ray-collector
sha256sum target/armv7-unknown-linux-musleabihf/release/lorawan-ray-collector
```

`file` should report a 32-bit ARM executable. The musl target produces a
statically linked binary, avoiding a dependency on the gateway's C library.
After changing the Rust source, rerun the `cross build` command to rebuild it.

Copy the resulting binary to the gateway and configure the packet forwarder
destination as the gateway's local address and UDP port `1700`.

Do not expose UDP port 1700 publicly: this protocol has no authentication.
