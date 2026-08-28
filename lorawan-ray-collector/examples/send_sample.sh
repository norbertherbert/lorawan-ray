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
payload = {
    "rxpk": [{
        "jver":2,
        "tmst":385922928,
        "freq":903.000000,
        "stat":1,
        "modu":"LR-FHSS",
        "datr":"M0CW1523",
        "codr":"1/3",
        "hpw":8,
        "size":7,
        "data":"ZQECAwQFBg==",
        "rsig":[
            {"ant":0,"chan":0,"rssic":-65,"fdri":23,"foff":5114}
        ],
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
