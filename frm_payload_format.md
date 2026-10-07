## 4. VERSION 1 — original frame (no location)

FRMPayload, 11 B (DR0) or 44 B (DR1/DR5/DR6):

| Offset | Size | Field | Content |
|---|---|---|---|
| 0 | 1 | VERSION | `0x01` |
| 1 | 2 | RF_VOLTAGE | RF supply voltage, mV, **big-endian**. `0E 0A` = 3594 mV. 0 = not measured |
| 3 | 1 | STATUS | `0x00` |
| 4 | 1 | RSSI | channel RSSI before this packet, **dBm, int8** |
| 5 | .. | FILLER | `0xA5` to the end of the FRMPayload |

Example, device `…268A79FB`, 3594 mV:

```
DR0, FCnt 37, RSSI -115 dBm (24 B)
40 00 FB 79 8A 00 25 00 01 | 01 0E 0A 00 8D A5 A5 A5 A5 A5 A5 | A5 A5 A5 A5

DR1, FCnt 45, RSSI -112 dBm (57 B)
40 01 FB 79 8A 00 2D 00 01 | 01 0E 0A 00 90 A5 … A5 (39 × A5) | A5 A5 A5 A5
```

---

## 5. VERSION 2 — compact frame with location (DR0)

DR0 has only 11 B of FRMPayload, so v2 has **no RF voltage and no location age**. The location
keeps full precision.

| Offset | Size | Field | Content |
|---|---|---|---|
| 0 | 1 | VERSION | `0x02` |
| 1 | 1 | TX_POWER | the power **this packet** was sent at, **antenna dBm, int8**. `14` = 20, `F7` = −9 |
| 2 | 1 | RSSI | channel RSSI before this packet, dBm, int8 |
| 3 | 4 | LAT | latitude, degrees × 10⁷, **int32 little-endian** |
| 7 | 4 | LON | longitude, degrees × 10⁷, int32 LE |

No filler: the 11 bytes are all used.

Example, device `…268A79FB`, TX 20 dBm, location 32.5631966, −97.1076455:

```
DR0, FCnt 37, with location (24 B)
40 00 FB 79 8A 00 25 00 01 | 02 14 8D DE BF 68 13 99 8C 1E C6 | A5 A5 A5 A5
                             │  │  │  └─ LAT ─┘  └─ LON ─┘
                             │  │  └ RSSI −115 dBm
                             │  └ TX_POWER 20 dBm
                             └ VERSION 2

DR0, FCnt 37, no location yet (24 B)
40 00 FB 79 8A 00 25 00 01 | 02 14 8D 00 00 00 80 00 00 00 80 | A5 A5 A5 A5
```

---

## 6. VERSION 3 — full frame with location (DR1, DR5, DR6)

| Offset | Size | Field | Content |
|---|---|---|---|
| 0 | 1 | VERSION | `0x03` |
| 1 | 2 | RF_VOLTAGE | RF supply voltage, mV, **big-endian** (as in v1) |
| 3 | 1 | TX_POWER | the power this packet was sent at, antenna dBm, int8 |
| 4 | 1 | RSSI | channel RSSI before this packet, dBm, int8 |
| 5 | 4 | LAT | latitude, degrees × 10⁷, int32 LE |
| 9 | 4 | LON | longitude, degrees × 10⁷, int32 LE |
| 13 | 2 | LOC_AGE | seconds since the location reached the meter, **u16 LE**. Saturates at `FE FF`; `FF FF` = no location |
| 15 | 29 | FILLER | `0xA5` |

Example, device `…268A79FB`, 3594 mV, TX 20 dBm, location 32.5631966, −97.1076455, 3 s old:

```
DR1, FCnt 45, with location (57 B)
40 01 FB 79 8A 00 2D 00 01 | 03 0E 0A 14 90 DE BF 68 13 99 8C 1E C6 03 00 A5 … A5 (29 × A5) | A5 A5 A5 A5
                             │  └─┬─┘ │  │  └─ LAT ─┘  └─ LON ─┘  └age┘
                             │    │   │  └ RSSI −112 dBm
                             │    │   └ TX_POWER 20 dBm
                             │    └ RF_VOLTAGE 3594 mV (BE)
                             └ VERSION 3

DR1, FCnt 45, no location yet (57 B)
40 01 FB 79 8A 00 2D 00 01 | 03 0E 0A 14 90 00 00 00 80 00 00 00 80 FF FF A5 … A5 | A5 A5 A5 A5

DR5 (LR-FHSS), FCnt 5, with location: same layout, DevAddr[0] = 05
40 05 FB 79 8A 00 05 00 01 | 03 0E 0A 14 9B DE BF 68 13 99 8C 1E C6 03 00 A5 … A5 | A5 A5 A5 A5
```

---

## 7. Field details

### TX_POWER (v2, v3)
- **What it is:** the power the meter gave the radio for this packet, in **antenna dBm**
  (driveby convention), as a signed byte.
- **Where it comes from:** the live field-trial setting (`HWTP_DBG_FIELD_TRIAL_CFG_SET`) or,
  if never set, the provisioned `drivebyTxPower` (default 16).
- **Range:** the phone app accepts only −9 … +30 dBm. The calibrated PA table clamps any other
  value into that range, so TX_POWER can differ from the real power only if `drivebyTxPower` is
  provisioned outside it.
- **Why it matters:** if the power changes in the middle of a run, every packet still says the
  power it was sent at.
- **v1** has STATUS (always `0x00`) at this place.

### LAT / LON (v2, v3)
- **Encoding:** int32 little-endian, degrees × 10⁷, about 1 cm resolution. Decode as
  `int.from_bytes(b, "little", signed=True) / 1e7`.
- **Which position:** the **last location the phone sent**, not the position at the moment of
  transmission (see §8).
- **No location:** LAT = LON = `00 00 00 80` (INT32_MIN = −2147483648). This means no location
  has arrived since the meter booted. No real coordinate can produce that value. Do **not**
  treat 0/0 as "no fix": it is a real point.
- **Lost on reboot:** the meter keeps the location in RAM only. After a reboot, frames carry
  "no location" until the phone sends the next one (within the send period after it reconnects).

### LOC_AGE (v3 only)
- Seconds between the moment the meter received the location and the moment this frame was built.
- It comes from the meter's RTC. If the RTC is set backwards while running, the age reads 0
  instead of a huge number.
- `FF FF` = no location; `FE FF` = 65534 s or older.

### RSSI (all versions)
- Channel RSSI measured by the meter on this packet's frequency just before it is sent: a
  ~20 ms listen, in dBm, signed, already corrected.
- For LR-FHSS it is a ~234 kHz slice at 903.0 MHz, not the whole OCW.

### RF_VOLTAGE (v1, v3)
- RF supply voltage in mV, **big-endian** (the only big-endian field). 0 = not measured.
