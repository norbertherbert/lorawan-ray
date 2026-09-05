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

# Gateway JSON v1: jver is 1 and reception metadata remains at the top level.
phy_payload = bytes.fromhex("40BC1A01268035300AAABB11223344")
payload = {
    "rxpk": [{
        "jver": 1,
        "time": datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "tmst": 3512348614,
        "brd": 0,
        "ant": 0,
        "chan": 2,
        "rfch": 0,
        "freq": 868.5,
        "stat": 1,
        "modu": "LORA",
        "datr": "SF8BW125",
        "codr": "4/5",
        "rssi": -96,
        "rssis": -98,
        "lsnr": 5.25,
        "foff": -420,
        "size": len(phy_payload),
        "data": base64.b64encode(phy_payload).decode("ascii"),
    }],
}
json_payload = json.dumps(payload, separators=(",", ":")).encode("utf-8")
packet = bytes((2, 0x11, 0x02, 0x00)) + gateway_mac + json_payload
expected_ack = bytes((2, 0x11, 0x02, 0x01))

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

print(f"jver 1 rxpk ACK: {ack.hex(' ')}")
PY
