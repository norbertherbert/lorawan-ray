#!/usr/bin/env bash
set -euo pipefail

LISTENER="${1:-127.0.0.1}"
PORT="${2:-1700}"

python3 - "$LISTENER" "$PORT" <<'PY'
import json
import socket
import sys

listener = sys.argv[1]
port = int(sys.argv[2])
gateway_mac = bytes.fromhex("10 32 54 76 98 BA DC FE")

# Synthetic LoRaWAN Join Request:
#   JoinEUI:  0102030405060708
#   DevEUI:   1122334455667788
#   DevNonce: 1234
#   MIC:      A1B2C3D4 (present but not cryptographically valid)
payload = {
    "rxpk": [{
        "jver": 2,
        "time": datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "tmst": 3512348513,
        "freq": 865.4,
        "stat": 1,
        "modu": "LR-FHSS",
        "datr": "M0CW137",
        "codr": "4/6",
        "hpw": 2,
        "size": 23,
        "data": "AAgHBgUEAwIBiHdmVUQzIhHSBKGyw9Q=",
        "rsig": [{
            "ant": 0,
            "chan": 3,
            "rssic": -105,
            "rssis": -106,
            "lsnr": -2.5,
            "foff": 120,
            "fdri": 4,
            "ftstat": 0,
        }],
    }],
}
json_payload = json.dumps(payload, separators=(",", ":")).encode("utf-8")
packet = bytes((2, 0x12, 0x34, 0x00)) + gateway_mac + json_payload
expected_ack = bytes((2, 0x12, 0x34, 0x01))

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

print(f"Received ACK: {ack.hex(' ')}")
PY
