#!/usr/bin/env bash
set -euo pipefail

LISTENER="${1:-127.0.0.1}"
PORT="${2:-1700}"

python3 - "$LISTENER" "$PORT" <<'PY'
import base64
import json
import socket
import sys
from datetime import datetime, timezone

listener = sys.argv[1]
port = int(sys.argv[2])
gateway_mac = bytes.fromhex("10 32 54 76 98 BA DC FE")

# Gateway JSON v2: jver is 2 and reception metadata is carried in rsig entries.
phy_payload = bytes.fromhex("40BC1A01268036300AAABB11223344")
payload = {
    "rxpk": [{
        "jver": 2,
        "time": datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "tmst": 3512348714,
        "freq": 865.4,
        "stat": 1,
        "modu": "LR-FHSS",
        "datr": "M0CW137",
        "codr": "1/3",
        "hpw": 4,
        "size": len(phy_payload),
        "data": base64.b64encode(phy_payload).decode("ascii"),
        "rsig": [{
            "ant": 0,
            "chan": 3,
            "rssic": -105,
            "rssis": -106,
            "rssisd": 2,
            "lsnr": -2.5,
            "foff": 120,
            "fdri": 4,
            "ftstat": 0,
        }],
    }],
}
json_payload = json.dumps(payload, separators=(",", ":")).encode("utf-8")
packet = bytes((2, 0x11, 0x03, 0x00)) + gateway_mac + json_payload
expected_ack = bytes((2, 0x11, 0x03, 0x01))

with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
    client.settimeout(3)
    client.sendto(packet, (listener, port))
    try:
        ack, address = client.recvfrom(32)
    except socket.timeout:
        raise SystemExit(f"No ACK received from {listener}:{port}")

if ack != expected_ack:
    raise SystemExit(
        f"Unexpected ACK from {address[0]}:{address[1]}: {ack.hex(' ')} "
        f"(expected {expected_ack.hex(' ')})"
    )

print(f"jver 2 rxpk ACK: {ack.hex(' ')}")
PY
