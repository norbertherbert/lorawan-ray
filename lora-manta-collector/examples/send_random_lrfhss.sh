#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
import base64
import json
import random
import socket
import struct
import time
from datetime import datetime, timedelta, timezone

# Simulation configuration
MESSAGE_COUNT = 10
FCNT_START = 1000
FPORT = 8
ACK_TIMEOUT_SECONDS = 3
MESSAGE_DELAY_SECONDS = 0.05
GATEWAY_SEND_DELAY_SECONDS = 1.0
MAX_RECEPTION_TIME_DIFFERENCE_MS = 150

GATEWAYS = [
    (bytes.fromhex("1032547698BADCFE"), "127.0.0.1", 1700),
    (bytes.fromhex("647FDAFFFE005E17"), "127.0.0.1", 1701),
]

DEV_ADDRS = [0x26011ABC, 0x04022780, 0x040306A0, 0x04034B9A]
FREQUENCIES = [865.1, 865.3, 865.5, 867.1, 867.3, 867.5]
DATA_RATES = ["M0CW137", "M0CW1523"]
CODING_RATES = ["1/3", "2/3"]
HOPPING_WIDTHS = [2, 4, 8]


def make_phy_payload(dev_addr, frame_counter, fport):
    # UnconfirmedDataUp with no FOpts. The random MIC is intentionally
    # synthetic; the collector only needs a structurally valid PHY payload.
    mhdr = bytes([0x40])
    fhdr = struct.pack("<I", dev_addr) + bytes([0x00]) + struct.pack("<H", frame_counter)
    frm_payload = random.randbytes(random.randint(2, 12))
    mic = random.randbytes(4)
    return mhdr + fhdr + bytes([fport]) + frm_payload + mic


with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
    client.settimeout(ACK_TIMEOUT_SECONDS)

    for index in range(MESSAGE_COUNT):
        dev_addr = random.choice(DEV_ADDRS)
        frame_counter = FCNT_START + index
        phy_payload = make_phy_payload(dev_addr, frame_counter, FPORT)
        observed_at = datetime.now(timezone.utc)
        frequency = random.choice(FREQUENCIES)
        data_rate = random.choice(DATA_RATES)
        coding_rate = random.choice(CODING_RATES)
        hopping_width = random.choice(HOPPING_WIDTHS)
        channel = random.randint(0, 7)
        print(
            f"{index + 1:>2}/{MESSAGE_COUNT}: DevAddr {dev_addr:08X}, FCnt {frame_counter}, "
            f"FPort {FPORT}, {data_rate}, {frequency:.3f} MHz, "
            f"{len(GATEWAYS)} gateway reception(s)"
        )

        for gateway_index, (gateway_mac, host, target_port) in enumerate(GATEWAYS):
            token = random.randbytes(2)
            antenna_count = random.randint(1, 3)
            base_rssi = random.randint(-115, -55)
            reception_time = observed_at + timedelta(
                milliseconds=random.randint(0, MAX_RECEPTION_TIME_DIFFERENCE_MS)
            )

            rsig = []
            for antenna in range(antenna_count):
                signal_rssi = base_rssi + random.randint(-4, 4)
                rsig.append({
                    "ant": antenna,
                    "chan": channel,
                    "rssic": signal_rssi + random.randint(-2, 2),
                    "rssis": signal_rssi,
                    "rssisd": random.randint(0, 5),
                    "lsnr": round(random.uniform(-15.0, 10.0), 1),
                    "foff": random.randint(-5000, 5000),
                    "fdri": random.randint(-50, 50),
                    "ftstat": 0,
                })

            rxpk = {
                "jver": 2,
                "time": reception_time.isoformat(timespec="microseconds").replace("+00:00", "Z"),
                "tmst": random.randint(0, 0xFFFFFFFF),
                "freq": frequency,
                "stat": 1,
                "modu": "LR-FHSS",
                "datr": data_rate,
                "codr": coding_rate,
                "hpw": hopping_width,
                "size": len(phy_payload),
                "data": base64.b64encode(phy_payload).decode("ascii"),
                "rsig": rsig,
            }

            json_payload = json.dumps({"rxpk": [rxpk]}, separators=(",", ":")).encode("utf-8")
            packet = bytes([2]) + token + bytes([0x00]) + gateway_mac + json_payload
            expected_ack = bytes([2]) + token + bytes([0x01])
            client.sendto(packet, (host, target_port))

            try:
                ack, address = client.recvfrom(32)
            except socket.timeout:
                raise SystemExit(
                    f"Packet {index + 1}, gateway {gateway_mac.hex().upper()}: "
                    f"no ACK received from {host}:{target_port}"
                )

            if ack != expected_ack:
                raise SystemExit(
                    f"Packet {index + 1}, gateway {gateway_mac.hex().upper()}: "
                    f"unexpected ACK from {address[0]}:{address[1]}: "
                    f"{ack.hex(' ')} (expected {expected_ack.hex(' ')})"
                )

            best_signal = max(rsig, key=lambda signal: signal["rssis"])
            print(
                f"      {gateway_index + 1}. {gateway_mac.hex().upper()} -> "
                f"{host}:{target_port}, RSSI {best_signal['rssis']} dBm, "
                f"SNR {best_signal['lsnr']} dB, {antenna_count} antenna(s)"
            )

            # PUSH_ACK confirms UDP receipt, not completion of the asynchronous
            # SurrealDB write. Give the preceding gateway reception time to be
            # committed before sending the next copy of the same PHY payload.
            if gateway_index < len(GATEWAYS) - 1:
                time.sleep(GATEWAY_SEND_DELAY_SECONDS)

        time.sleep(MESSAGE_DELAY_SECONDS)
PY
