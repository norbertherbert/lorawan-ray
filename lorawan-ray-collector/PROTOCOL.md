/**
* \file
*
* Copyright Semtech Corporation 2022. All rights reserved.
*
* See the LICENSE.TXT file found at the root of this project for the terms
* and conditions of the license.
*/

Basic communication protocol between LoRa gateway and Network Server
====================================================================

## 1. Introduction

The protocol between the gateway and the server is purposefully very basic and
for demonstration purpose only, or for use on private and reliable networks.

There is no authentication of the gateway or the server, and the acknowledges
are only used for network quality assessment, not to correct UDP datagrams
losses (no retries).

## 2. System schematic and definitions


     ((( Y )))
         |
         |
    + - -|- - - - - - - - - - - - - +        xxxxxxxxxxxx          +--------+
    | +--+-----------+     +------+ |       xx x  x     xxx        |        |
    | |              |     |      | |      xx  Internet  xx        |        |
    | | Concentrator |<--->| Host |<-------xx     or    xx-------->|        |
    | |              | SPI |      | |      xx  Intranet  xx        | Server |
    | +--------------+     +------+ |       xxxx   x   xxxx        |        |
    |    ^                     ^    |           xxxxxxxx           |        |
    |    | PPS +-------+ NMEA  |    |                              |        |
    |    +-----|  GPS  |-------+    |                              +--------+
    |          | (opt) |            |
    |          +-------+            |
    |                               |
    |             Gateway           |
    +- - - - - - - - - - - - - - - -+

__Concentrator__: radio RX/TX board, based on Semtech multichannel modems
(SX130x)

__Host__: embedded computer on which the packet forwarder is run. Drives the
concentrator through a SPI link.

__GPS__: GNSS (GPS, Galileo, GLONASS, etc) receiver with a "1 Pulse Per Second"
output and a serial link to the host to send NMEA frames containing time and
geographical coordinates data. Optional.

__Gateway__: a device composed of at least one radio concentrator, a host, some
network connection to the internet or a private network (Ethernet, 3G, Wifi,
microwave link), and optionally a GPS receiver for synchronization.

__Server__: an abstract computer that will process the RF packets received and
forwarded by the gateway, and issue RF packets in response that the gateway
will have to emit.

It is assumed that the gateway can be behind a NAT or a firewall stopping any
incoming connection.
It is assumed that the server has an static IP address (or an address solvable
through a DNS service) and is able to receive incoming connections on a
specific port.

## 3. Upstream protocol

### 3.1. Sequence diagram ###

    +---------+                                                    +---------+
    | Gateway |                                                    | Server  |
    +---------+                                                    +---------+
         | -----------------------------------\                         |
         |-| When 1-N RF packets are received |                         |
         | ------------------------------------                         |
         |                                                              |
         | PUSH_DATA (token X, GW MAC, JSON payload)                    |
         |------------------------------------------------------------->|
         |                                                              |
         |                                           PUSH_ACK (token X) |
         |<-------------------------------------------------------------|
         |                              ------------------------------\ |
         |                              | process packets *after* ack |-|
         |                              ------------------------------- |
         |                                                              |

### 3.2. PUSH_DATA packet ###

That packet type is used by the gateway mainly to forward the RF packets
received, and associated metadata, to the server.

 Bytes  | Function
:------:|---------------------------------------------------------------------
 0      | protocol version = 2
 1-2    | random token
 3      | PUSH_DATA identifier 0x00
 4-11   | Gateway unique identifier (MAC address)
 12-end | JSON object, starting with {, ending with }, see section 4

### 3.3. PUSH_ACK packet ###

That packet type is used by the server to acknowledge immediately all the
PUSH_DATA packets received.

 Bytes  | Function
:------:|---------------------------------------------------------------------
 0      | protocol version = 2
 1-2    | same token as the PUSH_DATA packet to acknowledge
 3      | PUSH_ACK identifier 0x01


## 4. Upstream JSON data structure

The root object can contain an array named "rxpk":

``` json
{
    "rxpk":[ {...}, ...]
}
```

That array contains at least one JSON object, each object contain a RF packet
and associated metadata with the following fields:

 Name |  Type  | Function
:----:|:------:|--------------------------------------------------------------
 jver | number | Version of the JSON rxpk frame format (1:gw v1, 2:gw v2, ...)
 time | string | UTC time of pkt RX, us precision, ISO 8601 'compact' format
 tmms | number | GPS time of pkt RX, number of milliseconds since 06.Jan.1980
 tmst | number | Internal timestamp of "RX finished" event (32b unsigned)
 freq | number | RX central frequency in MHz (unsigned float, Hz precision)
 stat | number | CRC status: 1 = OK, -1 = fail, 0 = no CRC
 modu | string | Modulation identifier "LORA", "LR-FHSS" or "FSK"
 datr | string | LoRa datarate identifier (eg. SF12BW500, bandwidth in KHz)
 datr | string | LR-FHSS datarate identifier (eg. M0CW137, Modulation Type, OCW in kHz)
 datr | number | FSK datarate (unsigned, in bits per second)
 codr | string | LoRa, LR-FHSS ECC coding rate identifier
 hpw  | number | LR-FHSS hopping channel width (grid number of steps)
 size | number | RF packet payload size in bytes (unsigned integer)
 data | string | Base64 encoded RF packet payload, padded
 rsig | array  | Received signal information, per antenna (Optional)

The "rsig" array contains a JSON object per antenna, each object contains the
metadata associated with the received signal with following fields:

 Name   |  Type  | Function
:------:|:------:|--------------------------------------------------------------
 ant    | number | Antenna number on which signal has been received
 chan   | number | Concentrator "IF" channel used for RX (unsigned integer)
 chan   | number | LR-FHSS channel used for RX (unsigned integer)
 rssic  | number | RSSI in dBm of the channel (signed integer, 1 dB precision)
 rssis  | number | RSSI in dBm of the signal (signed integer, 1 DB precision) (Optional)
 rssisd | number | Standard deviation of RSSI during preamble (unsigned integer) (Optional)
 lsnr   | number | Lora SNR ratio in dB (signed float, 0.1 dB precision)
 ftime  | number | Un-encrypted fine timestamp, nanosecond precision [0..999999999] (Optional)
 foff   | number | Frequency offset in Hz [-125kHz..+125Khz] (Optional)
 fdri   | number | Frequency drift in Hz between start and end of a LR-FHSS packet (signed)
 ftstat | number | An 8-bits unsigned integer describing fine timestamp status

Notes:
- The "time" field must be put before the "ftime" field in the structure.
- The "ftstat" field format is as follows:
    bits 7:6 - 00 indicates that fine timestamp was in proper range.
               01 indicates that fine timestamp was greater than 8seconds, which
                  is an error.
               10 indicates that fine timestamp was lower than -7seconds, which
                  is an error.
    bits 5   - 1 indicates that fine timestamp was negative
               0 indicates that fine timestamp was positive
    bits 4:0 - Number of seconds increase/decrease to have a fine timestamp in
               proper range (this reflects how long PPS has been lost) */


Example (white-spaces, indentation and newlines added for readability):

``` json
{"rxpk":[
    {
        "jver":2,
        "time":"2013-03-31T16:21:17.530974Z",
        "tmst":3512348514,
        "freq":869.1,
        "stat":1,
        "modu":"LORA",
        "datr":"SF7BW125",
        "codr":"4/5",
        "size":16,
        "data":"VEVTVF9QQUNLRVRfMTIzNA==",
        "rsig":[
            {
                "ant":0,
                "chan":9,
                "rssic":-90,
                "lsnr":-3,
                "ftime":123456,
                "rssis":-90,
                "rssisd":0,
                "foff":-7089,
                "ftstat":0
            },{
                "ant":1,
                "chan":9,
                "rssic":-89,
                "lsnr":-2.8,
                "ftime":123489,
                "rssis":-90,
                "rssisd":0,
                "foff":-7089,
                "ftstat":0
            }]
    }
]}

```
The root object can also contain an object named "stat" :

``` json
{
    "rxpk":[ {...}, ...],
    "stat":{...}
}
```

It is possible for a packet to contain no "rxpk" array but a "stat" object.

``` json
{
    "stat":{...}
}
```

That object contains the status of the gateway, with the following fields:

 Name |  Type  | Function
:----:|:------:|--------------------------------------------------------------
 time | string | UTC 'system' time of the gateway, ISO 8601 'expanded' format
 boot | string | UTC boot time of the gateway, ISO 8601 'expanded' format
 lati | number | GPS latitude of the gateway in degree (float, N is +)
 long | number | GPS latitude of the gateway in degree (float, E is +)
 alti | number | GPS altitude of the gateway in meter RX (integer)
 rxnb | number | Number of radio packets received (unsigned integer)
 rxok | number | Number of radio packets received with a valid PHY CRC
 rxfw | number | Number of radio packets forwarded (unsigned integer)
 ackr | number | Percentage of upstream datagrams that were acknowledged
 dwnb | number | Number of downlink datagrams received (unsigned integer)
 txnb | number | Number of packets emitted (unsigned integer)
 lmok | number | Number of packets received from link testing mote, with CRC OK (unsigned integer)
 lmst | number | Sequence number of the first packet received from link testing mote (unsigned integer)
 lmnw | number | Sequence number of the last packet received from link testing mote (unsigned integer)
 lpps | number | Number of lost PPS pulses (unsigned integer)
 temp | number | Temperature of the Gateway (signed integer)
 fpga | number | Version of Gateway FPGA (unsigned integer)
 dsp  | number | Version of Gateway DSP software (unsigned integer)
 hal  | string | Version of Gateway driver (format X.X.X)

Notes:
  UTC boot time is either GPS time, if GPS is enabled, or system time if not.

Example (white-spaces, indentation and newlines added for readability):

``` json
{"stat":{
    "time":"2014-01-12 08:59:28 GMT",
    "lati":46.24000,
    "long":3.25230,
    "alti":145,
    "rxnb":2,
    "rxok":2,
    "rxfw":2,
    "ackr":100.0,
    "dwnb":2,
    "txnb":2,
    "lmok":40,
    "lmst":12237,
    "lmnw":12272,
    "lpps":0,
    "temp":23,
    "fpga":38,
    "dsp":27,
    "hal":"3.0.0"
}}
```

## 5. Downstream protocol

### 5.1. Sequence diagram ###

    +---------+                                                    +---------+
    | Gateway |                                                    | Server  |
    +---------+                                                    +---------+
         | -----------------------------------\                         |
         |-| Every N seconds (keepalive time) |                         |
         | ------------------------------------                         |
         |                                                              |
         | PULL_DATA (token Y, MAC@)                                    |
         |------------------------------------------------------------->|
         |                                                              |
         |                                           PULL_ACK (token Y) |
         |<-------------------------------------------------------------|
         |                                                              |

    +---------+                                                    +---------+
    | Gateway |                                                    | Server  |
    +---------+                                                    +---------+
         |      ------------------------------------------------------\ |
         |      | Anytime after first PULL_DATA for each packet to TX |-|
         |      ------------------------------------------------------- |
         |                                                              |
         |                            PULL_RESP (token Z, JSON payload) |
         |<-------------------------------------------------------------|
         |                                                              |
         | TX_ACK (token Z, JSON payload)                               |
         |------------------------------------------------------------->|

### 5.2. PULL_DATA packet ###

That packet type is used by the gateway to poll data from the server.

This data exchange is initialized by the gateway because it might be
impossible for the server to send packets to the gateway if the gateway is
behind a NAT.

When the gateway initialize the exchange, the network route towards the
server will open and will allow for packets to flow both directions.
The gateway must periodically send PULL_DATA packets to be sure the network
route stays open for the server to be used at any time.

 Bytes  | Function
:------:|---------------------------------------------------------------------
 0      | protocol version = 2
 1-2    | random token
 3      | PULL_DATA identifier 0x02
 4-11   | Gateway unique identifier (MAC address)

### 5.3. PULL_ACK packet ###

That packet type is used by the server to confirm that the network route is
open and that the server can send PULL_RESP packets at any time.

 Bytes  | Function
:------:|---------------------------------------------------------------------
 0      | protocol version = 2
 1-2    | same token as the PULL_DATA packet to acknowledge
 3      | PULL_ACK identifier 0x04

### 5.4. PULL_RESP packet ###

That packet type is used by the server to send RF packets and associated
metadata that will have to be emitted by the gateway.

 Bytes  | Function
:------:|---------------------------------------------------------------------
 0      | protocol version = 2
 1-2    | random token
 3      | PULL_RESP identifier 0x03
 4-end  | JSON object, starting with {, ending with }, see section 6

### 5.5. TX_ACK packet ###

That packet type is used by the gateway to send a feedback to the server
to inform if a downlink request has been accepted or rejected by the gateway.
The datagram may optionaly contain a JSON string to give more details on
acknowledge. If no JSON is present (empty string), this means than no error
occured.

 Bytes  | Function
:------:|---------------------------------------------------------------------
 0      | protocol version = 2
 1-2    | same token as the PULL_RESP packet to acknowledge
 3      | TX_ACK identifier 0x05
 4-11   | Gateway unique identifier (MAC address)
 12-end | [optional] JSON object, starting with {, ending with }, see section 6

## 6. Downstream JSON data structure

The root object of PULL_RESP packet must contain an object named "txpk":

``` json
{
    "txpk": {...}
}
```

That object contain a RF packet to be emitted and associated metadata with the following fields:

 Name |  Type  | Function
:----:|:------:|--------------------------------------------------------------
 imme | bool   | Send packet immediately (will ignore tmst & time)
 tmst | number | Send packet on a certain timestamp value (will ignore time)
 tmms | number | Send packet at a certain GPS time (GPS synchronization required)
 freq | number | TX central frequency in MHz (unsigned float, Hz precision)
 ant  | number | Concentrator antenna used for TX (unsigned integer)
 powe | number | TX output power in dBm (unsigned integer, dBm precision)
 modu | string | Modulation identifier "LORA" or "FSK"
 datr | string | LoRa datarate identifier (eg. SF12BW500, bandwidth in KHz)
 datr | number | FSK datarate (unsigned, in bits per second)
 codr | string | LoRa ECC coding rate identifier
 fdev | number | FSK frequency deviation (unsigned integer, in Hz)
 ipol | bool   | Lora modulation polarization inversion
 prea | number | RF preamble size (unsigned integer)
 size | number | RF packet payload size in bytes (unsigned integer)
 data | string | Base64 encoded RF packet payload, padding optional
 ncrc | bool   | If true, disable the CRC of the physical layer (optional)

Most fields are optional.
If a field is omitted, default parameters will be used.

Example (white-spaces, indentation and newlines added for readability):

``` json
{"txpk":{
    "imme":true,
    "freq":864.123456,
    "ant":1,
    "powe":14,
    "modu":"LORA",
    "datr":"SF11BW125",
    "codr":"4/6",
    "ipol":false,
    "size":32,
    "data":"H3P3N2i9qc4yt7rK7ldqoeCVJGBybzPY5h1Dd7P7p8v"
}}
```


The root object of TX_ACK packet must contain an object named "txpk_ack":

``` json
{
    "txpk_ack": {...}
}
```

That object contain status information concerning the associated PULL_RESP packet.

 Name |  Type  | Function
:----:|:------:|------------------------------------------------------------------------------
error | string | Indication about success or type of failure that occured for downlink request.

The possible values of "error" field are:

 Value             | Definition
:-----------------:|---------------------------------------------------------------------
 NONE              | Packet has been programmed for downlink
 TOO_LATE          | Rejected because it was already too late to program this packet for downlink
 TOO_EARLY         | Rejected because downlink packet timestamp is too much in advance
 COLLISION_PACKET  | Rejected because there was already a packet programmed in requested timeframe
 COLLISION_BEACON  | Rejected because there was already a beacon planned in requested timeframe
 TX_FREQ           | Rejected because requested frequency is not supported by TX RF chain
 TX_POWER          | Rejected because requested power is not supported by gateway
 GPS_UNLOCKED      | Rejected because GPS is unlocked, so GPS timestamp cannot be used

Examples (white-spaces, indentation and newlines added for readability):

``` json
{"txpk_ack":{
    "error":"COLLISION_PACKET"
}}
```

## 7. Revisions

### v1.6 ###

* Added LR-FHSS support

### v1.5 ###

* Added "jver" field to indicate the version of the JSON rxpk frames
* Added "ftstatus" fields for fine timestamp new information

### v1.4 ###

* Added "tmms" field to rxpk and txpk JSON structures for GPS time as a
monotonic (no leap second) number of milliseconds ellapsed since 01.01.1980 (GPS Epoch).
* Removed "time" field from txpk JSON structure.

### v1.3 ###

* Added downlink feedback from gateway to server (PULL_RESP -> TX_ACK)

### v1.2 ###
* "rxpk" JSON format:
    - removed "rfch" field
    - added "brd" and "aesk" fields
* "txpk" JSON format:
    - removed "rfch" field
    - added "brd" and "ant" fields

### v1.1 ###

* Added downlink feedback from gateway to server (PULL_RESP -> TX_ACK)

### v1.0 ###

* Initial version.
