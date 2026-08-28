use anyhow::{Context, Result};
use base64::{
    engine::general_purpose::{STANDARD as BASE64, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use clap::{ArgGroup, Parser, ValueEnum};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION};
use reqwest::StatusCode;
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::{net::UdpSocket, sync::Mutex};

const PROTOCOL_VERSION: u8 = 2;
const PUSH_DATA: u8 = 0x00;
const PUSH_ACK: u8 = 0x01;
const PULL_DATA: u8 = 0x02;
const PULL_RESP: u8 = 0x03;
const PULL_ACK: u8 = 0x04;
const TX_ACK: u8 = 0x05;

#[derive(Debug, Parser)]
#[command(
    name = "lorawan-ray-collector",
    version,
    about = "Collect Semtech UDP Packet Forwarder uplinks for LoRaWAN Ray",
    group(
        ArgGroup::new("password_source")
            .required(true)
            .multiple(false)
            .args(["password", "password_file"])
    )
)]
struct Args {
    /// SurrealDB Cloud destination without the `/sql` suffix.
    #[arg(short = 'd', long, value_name = "URL")]
    destination: String,

    /// Gateway username used by the SurrealDB access method.
    #[arg(short = 'u', long)]
    username: String,

    /// Gateway password used by the SurrealDB access method.
    #[arg(short = 'p', long)]
    password: Option<String>,

    /// Read the gateway password from a file.
    #[arg(long, value_name = "FILE")]
    password_file: Option<PathBuf>,

    /// SurrealDB namespace containing the collector tables.
    #[arg(long = "ns", default_value = "lorawan")]
    namespace: String,

    /// SurrealDB database containing the collector tables.
    #[arg(long = "db", default_value = "ray")]
    database: String,

    /// SurrealDB record-access method used to authenticate the gateway.
    #[arg(long, default_value = "gateway_writer")]
    access: String,

    /// Store gateway status (`stat`) data in SurrealDB.
    #[arg(long)]
    gateway_stats: bool,

    /// Forward only messages matching these comma-separated DevAddr/DevEUI values.
    #[arg(long, value_name = "DEV_ADDR,DEV_EUI")]
    white_list: Option<String>,

    /// Local UDP address for packet-forwarder traffic.
    #[arg(short = 'l', long, default_value = "127.0.0.1:1700")]
    listen_addr: SocketAddr,

    /// Set the collector log level.
    #[arg(long, value_enum, default_value_t = LogLevel::Info)]
    log_level: LogLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, ValueEnum)]
enum LogLevel {
    Error,
    Info,
    Debug,
}

fn log_info(level: LogLevel, message: impl std::fmt::Display) {
    if level >= LogLevel::Info {
        println!("{message}");
    }
}

fn log_debug(level: LogLevel, message: impl std::fmt::Display) {
    if level >= LogLevel::Debug {
        println!("{message}");
    }
}

#[derive(Clone)]
struct Config {
    bind: SocketAddr,
    surrealdb_url: String,
    store_gateway_stats: bool,
    namespace: String,
    database: String,
    access: String,
    username: String,
    password: String,
    white_list: Option<HashSet<String>>,
    log_level: LogLevel,
}

struct SurrealWriter {
    client: reqwest::Client,
    url: String,
    store_gateway_stats: bool,
    namespace: String,
    database: String,
    authentication: Authentication,
    white_list: Option<HashSet<String>>,
    log_level: LogLevel,
}

struct Authentication {
    access: String,
    username: String,
    password: String,
    token: Mutex<Option<String>>,
}

#[derive(Serialize)]
struct SigninRequest<'a> {
    #[serde(rename = "NS")]
    ns: &'a str,
    #[serde(rename = "DB")]
    db: &'a str,
    #[serde(rename = "AC")]
    access: &'a str,
    user: &'a str,
    pass: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum TimestampSource {
    Gateway,
    Ingested,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RxpkFormat {
    Legacy,
    GatewayV1,
    GatewayV2,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum DecodeStatus {
    Decoded,
    Error,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum LoRaWanMajor {
    LoRaWANR1,
    #[serde(rename = "RFU")]
    Rfu,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum LoRaWanMessageType {
    JoinRequest,
    JoinAccept,
    UnconfirmedDataUp,
    UnconfirmedDataDown,
    ConfirmedDataUp,
    ConfirmedDataDown,
    RejoinRequest,
    Proprietary,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
enum DataRate {
    Identifier(String),
    BitsPerSecond(f64),
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
struct RadioSignal {
    #[serde(skip_serializing_if = "Option::is_none")]
    board: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    antenna: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rf_chain: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rssi_channel_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rssi_signal_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    snr_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rssi_standard_deviation_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fine_timestamp_ns: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frequency_offset_hz: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frequency_drift_hz: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fine_timestamp_status: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct RadioMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    frequency_hz: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    modulation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_rate: Option<DataRate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    spreading_factor: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bandwidth_hz: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    coding_rate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hopping_channel_width: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    crc_status: Option<i8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    best_rssi_dbm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    best_snr_db: Option<f64>,
    signals: Vec<RadioSignal>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
struct PhyPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    payload_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct DecodedLoRaWan {
    decode_status: DecodeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    decode_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mhdr_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    major: Option<LoRaWanMajor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mtype: Option<LoRaWanMessageType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dev_addr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fcnt16: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fport: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fctrl_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    adr: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    adr_ack_request: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ack: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    class_b: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fopts_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frm_payload_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mic_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    join_eui: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dev_eui: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dev_nonce: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mac_payload_hex: Option<String>,
}

impl DecodedLoRaWan {
    fn error(message: impl Into<String>) -> Self {
        Self {
            decode_status: DecodeStatus::Error,
            decode_error: Some(message.into()),
            mhdr_hex: None,
            major: None,
            mtype: None,
            dev_addr: None,
            fcnt16: None,
            fport: None,
            fctrl_hex: None,
            adr: None,
            adr_ack_request: None,
            ack: None,
            class_b: None,
            fopts_hex: None,
            frm_payload_hex: None,
            mic_hex: None,
            join_eui: None,
            dev_eui: None,
            dev_nonce: None,
            mac_payload_hex: None,
        }
    }

    fn decoded(mhdr: u8, mtype: LoRaWanMessageType) -> Self {
        Self {
            decode_status: DecodeStatus::Decoded,
            decode_error: None,
            mhdr_hex: Some(hex(&[mhdr])),
            major: Some(if mhdr & 0x03 == 0 {
                LoRaWanMajor::LoRaWANR1
            } else {
                LoRaWanMajor::Rfu
            }),
            mtype: Some(mtype),
            dev_addr: None,
            fcnt16: None,
            fport: None,
            fctrl_hex: None,
            adr: None,
            adr_ack_request: None,
            ack: None,
            class_b: None,
            fopts_hex: None,
            frm_payload_hex: None,
            mic_hex: None,
            join_eui: None,
            dev_eui: None,
            dev_nonce: None,
            mac_payload_hex: None,
        }
    }

    fn fail(mut self, message: impl Into<String>) -> Self {
        self.decode_status = DecodeStatus::Error;
        self.decode_error = Some(message.into());
        self
    }
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedGatewayReception {
    schema_version: u8,
    gateway_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    observed_at: Option<String>,
    timestamp_source: TimestampSource,
    raw_rxpk: Map<String, Value>,
    radio: RadioMetadata,
    phy: PhyPayload,
    lorawan: DecodedLoRaWan,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedGatewayStatus {
    schema_version: u8,
    gateway_id: String,
    raw_stat: Map<String, Value>,
}

fn signin_token(body: &str) -> Result<String> {
    let response: Value =
        serde_json::from_str(body).context("SurrealDB sign-in response is not valid JSON")?;
    response
        .get("token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .context("SurrealDB sign-in response did not contain a token")
}

fn ensure_gateway_identity(username: &str, gateway_id: &str) -> Result<()> {
    if !username.eq_ignore_ascii_case(gateway_id) {
        anyhow::bail!(
            "authenticated gateway ID {username} does not match packet gateway ID {gateway_id}"
        );
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02X}")).collect()
}

fn reversed_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .rev()
        .map(|byte| format!("{byte:02X}"))
        .collect()
}

fn decode_rxpk_data(encoded: &str) -> std::result::Result<Vec<u8>, base64::DecodeError> {
    BASE64
        .decode(encoded)
        .or_else(|_| STANDARD_NO_PAD.decode(encoded))
        .or_else(|_| URL_SAFE.decode(encoded))
        .or_else(|_| URL_SAFE_NO_PAD.decode(encoded))
        .or_else(|_| {
            let normalized = encoded.replace('-', "+").replace('_', "/");
            BASE64
                .decode(&normalized)
                .or_else(|_| STANDARD_NO_PAD.decode(&normalized))
        })
}

fn decode_lorawan(encoded: &str) -> DecodedLoRaWan {
    let bytes = match decode_rxpk_data(encoded) {
        Ok(bytes) => bytes,
        Err(error) => return DecodedLoRaWan::error(format!("invalid Base64 data: {error}")),
    };
    if bytes.is_empty() {
        return DecodedLoRaWan::error("empty PHYPayload");
    }

    let mhdr = bytes[0];
    let mtype_number = mhdr >> 5;
    let mtype = match mtype_number {
        0 => LoRaWanMessageType::JoinRequest,
        1 => LoRaWanMessageType::JoinAccept,
        2 => LoRaWanMessageType::UnconfirmedDataUp,
        3 => LoRaWanMessageType::UnconfirmedDataDown,
        4 => LoRaWanMessageType::ConfirmedDataUp,
        5 => LoRaWanMessageType::ConfirmedDataDown,
        6 => LoRaWanMessageType::RejoinRequest,
        7 => LoRaWanMessageType::Proprietary,
        _ => unreachable!(),
    };
    let mut decoded = DecodedLoRaWan::decoded(mhdr, mtype);

    if matches!(mtype_number, 2..=5) {
        if bytes.len() < 12 {
            return decoded.fail(format!(
                "data PHYPayload is too short: {} bytes",
                bytes.len()
            ));
        }

        let mic_start = bytes.len() - 4;
        let fctrl = bytes[5];
        let fopts_len = usize::from(fctrl & 0x0f);
        let fhdr_end = 8 + fopts_len;
        if fhdr_end > mic_start {
            return decoded.fail("FOpts extends beyond the MACPayload");
        }

        decoded.dev_addr = Some(reversed_hex(&bytes[1..5]));
        decoded.fcnt16 = Some(u16::from_le_bytes([bytes[6], bytes[7]]));
        decoded.fopts_hex = Some(hex(&bytes[8..fhdr_end]));
        if fhdr_end < mic_start {
            decoded.fport = Some(bytes[fhdr_end]);
            decoded.frm_payload_hex = Some(hex(&bytes[fhdr_end + 1..mic_start]));
        }
        decoded.adr = Some(fctrl & 0x80 != 0);
        decoded.ack = Some(fctrl & 0x20 != 0);
        decoded.adr_ack_request = Some(fctrl & 0x40 != 0);
        decoded.class_b = Some(fctrl & 0x10 != 0);
        decoded.fctrl_hex = Some(hex(&bytes[5..6]));
        decoded.mic_hex = Some(hex(&bytes[mic_start..]));
    } else if mtype_number == 0 {
        if bytes.len() != 23 {
            return decoded.fail(format!(
                "JoinRequest PHYPayload has {} bytes; expected 23",
                bytes.len()
            ));
        }
        decoded.join_eui = Some(reversed_hex(&bytes[1..9]));
        decoded.dev_eui = Some(reversed_hex(&bytes[9..17]));
        decoded.dev_nonce = Some(u16::from_le_bytes([bytes[17], bytes[18]]));
        decoded.mic_hex = Some(hex(&bytes[19..23]));
    } else {
        decoded.decode_status = DecodeStatus::Unsupported;
        if bytes.len() >= 5 {
            decoded.mac_payload_hex = Some(hex(&bytes[1..bytes.len() - 4]));
            decoded.mic_hex = Some(hex(&bytes[bytes.len() - 4..]));
        }
    }

    decoded
}

fn decode_rxpk_lorawan(fields: &Map<String, Value>) -> DecodedLoRaWan {
    match fields.get("data") {
        Some(Value::String(data)) => decode_lorawan(data),
        Some(_) => DecodedLoRaWan::error("rxpk.data is not a string"),
        None => DecodedLoRaWan::error("rxpk.data is missing"),
    }
}

fn optional_number(map: &Map<String, Value>, name: &str) -> Option<f64> {
    map.get(name).and_then(Value::as_f64)
}

fn optional_integer(map: &Map<String, Value>, name: &str) -> Option<i64> {
    map.get(name).and_then(Value::as_i64)
}

fn rxpk_format(fields: &Map<String, Value>) -> RxpkFormat {
    match fields.get("jver") {
        None => RxpkFormat::Legacy,
        Some(version) if version.as_i64() == Some(1) => RxpkFormat::GatewayV1,
        Some(version) if version.as_i64() == Some(2) => RxpkFormat::GatewayV2,
        Some(_) => RxpkFormat::Unknown,
    }
}

fn normalized_data_rate(value: &Value) -> Option<DataRate> {
    match value {
        Value::String(value) => Some(DataRate::Identifier(value.clone())),
        Value::Number(value) => value.as_f64().map(DataRate::BitsPerSecond),
        _ => None,
    }
}

fn lora_data_rate(data_rate: &DataRate) -> (Option<u8>, Option<u32>) {
    let DataRate::Identifier(data_rate) = data_rate else {
        return (None, None);
    };
    let Some(rest) = data_rate.strip_prefix("SF") else {
        return (None, None);
    };
    let Some((spreading_factor, bandwidth_khz)) = rest.split_once("BW") else {
        return (None, None);
    };
    let spreading_factor = spreading_factor.parse().ok();
    let bandwidth_hz = bandwidth_khz
        .parse::<u32>()
        .ok()
        .and_then(|value| value.checked_mul(1_000));
    (spreading_factor, bandwidth_hz)
}

fn normalized_signal(signal: &Value) -> Option<RadioSignal> {
    let signal = signal.as_object()?;
    Some(RadioSignal {
        board: optional_integer(signal, "brd"),
        antenna: optional_integer(signal, "ant"),
        channel: optional_integer(signal, "chan"),
        rf_chain: optional_integer(signal, "rfch"),
        rssi_channel_dbm: optional_number(signal, "rssic"),
        rssi_signal_dbm: optional_number(signal, "rssis"),
        snr_db: optional_number(signal, "lsnr"),
        rssi_standard_deviation_db: optional_number(signal, "rssisd"),
        fine_timestamp_ns: optional_integer(signal, "ftime"),
        frequency_offset_hz: optional_number(signal, "foff"),
        frequency_drift_hz: optional_number(signal, "fdri"),
        fine_timestamp_status: optional_integer(signal, "ftstat"),
    })
}

fn normalized_top_level_signal(fields: &Map<String, Value>) -> Option<RadioSignal> {
    let signal = RadioSignal {
        board: optional_integer(fields, "brd"),
        antenna: optional_integer(fields, "ant"),
        channel: optional_integer(fields, "chan"),
        rf_chain: optional_integer(fields, "rfch"),
        rssi_channel_dbm: optional_number(fields, "rssic")
            .or_else(|| optional_number(fields, "rssi")),
        rssi_signal_dbm: optional_number(fields, "rssis"),
        snr_db: optional_number(fields, "lsnr"),
        rssi_standard_deviation_db: optional_number(fields, "rssisd"),
        fine_timestamp_ns: optional_integer(fields, "ftime"),
        frequency_offset_hz: optional_number(fields, "foff"),
        frequency_drift_hz: optional_number(fields, "fdri"),
        fine_timestamp_status: optional_integer(fields, "ftstat"),
    };
    if signal == RadioSignal::default() {
        None
    } else {
        Some(signal)
    }
}

fn normalized_radio(fields: &Map<String, Value>) -> RadioMetadata {
    let data_rate = fields.get("datr").and_then(normalized_data_rate);
    let (spreading_factor, bandwidth_hz) = data_rate
        .as_ref()
        .map(lora_data_rate)
        .unwrap_or((None, None));
    let signals: Vec<RadioSignal> = match rxpk_format(fields) {
        RxpkFormat::Legacy | RxpkFormat::GatewayV1 => {
            normalized_top_level_signal(fields).into_iter().collect()
        }
        RxpkFormat::GatewayV2 => fields
            .get("rsig")
            .and_then(Value::as_array)
            .map(|signals| signals.iter().filter_map(normalized_signal).collect())
            .unwrap_or_default(),
        RxpkFormat::Unknown => Vec::new(),
    };
    let best_rssi = signals
        .iter()
        .filter_map(|signal| signal.rssi_signal_dbm.or(signal.rssi_channel_dbm))
        .reduce(f64::max);
    let best_snr = signals
        .iter()
        .filter_map(|signal| signal.snr_db)
        .reduce(f64::max);

    RadioMetadata {
        frequency_hz: optional_number(fields, "freq")
            .filter(|value| *value >= 0.0 && *value <= i64::MAX as f64 / 1_000_000.0)
            .map(|value| (value * 1_000_000.0).round() as i64),
        modulation: fields
            .get("modu")
            .and_then(Value::as_str)
            .map(str::to_owned),
        data_rate,
        spreading_factor,
        bandwidth_hz,
        coding_rate: fields
            .get("codr")
            .and_then(Value::as_str)
            .map(str::to_owned),
        hopping_channel_width: optional_integer(fields, "hpw"),
        crc_status: optional_integer(fields, "stat")
            .and_then(|value| i8::try_from(value).ok())
            .filter(|value| matches!(value, -1..=1)),
        best_rssi_dbm: best_rssi,
        best_snr_db: best_snr,
        signals,
    }
}

fn normalized_phy(fields: &Map<String, Value>) -> PhyPayload {
    let Some(encoded) = fields.get("data").and_then(Value::as_str) else {
        return PhyPayload::default();
    };
    let Ok(bytes) = decode_rxpk_data(encoded) else {
        return PhyPayload::default();
    };
    PhyPayload {
        payload_base64: Some(BASE64.encode(&bytes)),
        payload_hex: Some(hex(&bytes)),
        payload_size: Some(bytes.len()),
        payload_hash: Some(hex(&Sha256::digest(&bytes))),
    }
}

fn normalize_reception(
    gateway_id: &str,
    raw_rxpk: Map<String, Value>,
    index: usize,
) -> Result<NormalizedGatewayReception> {
    let (observed_at, timestamp_source) = match raw_rxpk.get("time") {
        Some(Value::String(time)) => (Some(time.clone()), TimestampSource::Gateway),
        Some(_) => anyhow::bail!("rxpk[{index}].time must be a string"),
        None => (None, TimestampSource::Ingested),
    };
    let radio = normalized_radio(&raw_rxpk);
    let phy = normalized_phy(&raw_rxpk);
    let lorawan = decode_rxpk_lorawan(&raw_rxpk);
    Ok(NormalizedGatewayReception {
        schema_version: 1,
        gateway_id: gateway_id.to_owned(),
        observed_at,
        timestamp_source,
        raw_rxpk,
        radio,
        phy,
        lorawan,
    })
}

fn reception_statement(index: usize, reception: &NormalizedGatewayReception) -> Result<String> {
    let reception_variable = format!("$reception_{index}");
    let observed_at_variable = format!("$observed_at_{index}");
    let observed_at = if reception.observed_at.is_some() {
        format!("<datetime>{reception_variable}.observed_at")
    } else {
        "$ingested_at".to_owned()
    };
    Ok(format!(
        "LET {reception_variable} = {};\nLET {observed_at_variable} = {observed_at};\nCREATE gateway_reception:[{}, $ingested_at, rand::uuid()] CONTENT {{\"schema_version\":{reception_variable}.schema_version,\"gateway_id\":{reception_variable}.gateway_id,\"observed_at\":{observed_at_variable},\"ingested_at\":$ingested_at,\"timestamp_source\":{reception_variable}.timestamp_source,\"raw_rxpk\":{reception_variable}.raw_rxpk,\"radio\":{reception_variable}.radio,\"phy\":{reception_variable}.phy,\"lorawan\":{reception_variable}.lorawan}} RETURN NONE;",
        serde_json::to_string(reception)?,
        serde_json::to_string(&reception.gateway_id)?,
    ))
}

fn reception_is_allowed(
    reception: &NormalizedGatewayReception,
    white_list: Option<&HashSet<String>>,
) -> bool {
    white_list.is_none_or(|identifiers| {
        reception
            .lorawan
            .dev_addr
            .iter()
            .chain(reception.lorawan.dev_eui.iter())
            .any(|identifier| identifiers.contains(identifier))
    })
}

fn storage_query(
    gateway_id: &str,
    payload: &Value,
    store_gateway_stats: bool,
    white_list: Option<&HashSet<String>>,
) -> Result<Option<String>> {
    let root = payload
        .as_object()
        .context("PUSH_DATA payload root must be a JSON object")?;
    let gateway = serde_json::to_string(gateway_id)?;
    let mut statements = Vec::new();

    if let Some(rxpk) = root.get("rxpk") {
        let packets = rxpk.as_array().context("PUSH_DATA rxpk must be an array")?;
        for (index, packet) in packets.iter().enumerate() {
            let raw_rxpk = packet
                .as_object()
                .cloned()
                .context("each PUSH_DATA rxpk entry must be an object")?;
            let reception = normalize_reception(gateway_id, raw_rxpk, index)?;
            if reception_is_allowed(&reception, white_list) {
                statements.push(reception_statement(index, &reception)?);
            }
        }
    }

    if store_gateway_stats {
        if let Some(stat) = root.get("stat") {
            let raw_stat = stat
                .as_object()
                .cloned()
                .context("PUSH_DATA stat must be an object")?;
            let status = NormalizedGatewayStatus {
                schema_version: 1,
                gateway_id: gateway_id.to_owned(),
                raw_stat,
            };
            statements.push(format!(
                "LET $gateway_status = {};\nCREATE gateway_stat:[{gateway}, $ingested_at, rand::uuid()] CONTENT {{\"schema_version\":$gateway_status.schema_version,\"gateway\":{{\"gateway_id\":$gateway_status.gateway_id,\"ingested_at\":$ingested_at}},\"raw_stat\":$gateway_status.raw_stat}} RETURN NONE;",
                serde_json::to_string(&status)?,
            ));
        }
    }

    if statements.is_empty() {
        return Ok(None);
    }

    Ok(Some(format!(
        "BEGIN TRANSACTION;\nLET $ingested_at = time::now();\n{}\nCOMMIT TRANSACTION;",
        statements.join("\n")
    )))
}

fn ensure_query_succeeded(body: &str) -> Result<()> {
    let response: Value =
        serde_json::from_str(body).context("SurrealDB query response is not valid JSON")?;
    let statements = response
        .as_array()
        .context("SurrealDB query response is not an array")?;

    for statement in statements {
        if statement.get("status").and_then(Value::as_str) != Some("OK") {
            let detail = statement
                .get("detail")
                .or_else(|| statement.get("result"))
                .map(Value::to_string)
                .unwrap_or_else(|| statement.to_string());
            anyhow::bail!("SurrealDB statement failed: {detail}");
        }
    }
    Ok(())
}

fn parse_white_list(value: Option<&str>) -> Result<Option<HashSet<String>>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let mut identifiers = HashSet::new();
    for item in value.split(',') {
        let item = item.trim();
        if item.is_empty() {
            anyhow::bail!("--white-list contains an empty entry");
        }
        let item = item
            .strip_prefix("0x")
            .or_else(|| item.strip_prefix("0X"))
            .unwrap_or(item);
        let normalized: String = item
            .chars()
            .filter(|character| !matches!(character, ':' | '-'))
            .collect::<String>()
            .to_ascii_uppercase();
        if !matches!(normalized.len(), 8 | 16)
            || !normalized
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            anyhow::bail!(
                "invalid --white-list entry '{item}'; expected an 8-digit DevAddr or 16-digit DevEUI"
            );
        }
        identifiers.insert(normalized);
    }
    Ok(Some(identifiers))
}

impl Config {
    fn from_args(args: Args) -> Result<Self> {
        let password = match (args.password, args.password_file) {
            (Some(password), None) => password,
            (None, Some(path)) => {
                let password = fs::read_to_string(&path)
                    .with_context(|| format!("failed to read password file: {}", path.display()))?;
                let password = password.trim_end_matches(['\r', '\n']).to_owned();
                if password.is_empty() {
                    anyhow::bail!("password file is empty: {}", path.display());
                }
                password
            }
            _ => unreachable!("clap requires exactly one password source"),
        };

        let white_list = parse_white_list(args.white_list.as_deref())?;

        Ok(Self {
            bind: args.listen_addr,
            surrealdb_url: args.destination,
            store_gateway_stats: args.gateway_stats,
            namespace: args.namespace,
            database: args.database,
            access: args.access,
            username: args.username,
            password,
            white_list,
            log_level: args.log_level,
        })
    }
}

impl SurrealWriter {
    fn new(config: &Config) -> Self {
        Self {
            client: reqwest::Client::new(),
            url: config.surrealdb_url.trim_end_matches('/').to_owned(),
            store_gateway_stats: config.store_gateway_stats,
            namespace: config.namespace.clone(),
            database: config.database.clone(),
            authentication: Authentication {
                access: config.access.clone(),
                username: config.username.clone(),
                password: config.password.clone(),
                token: Mutex::new(None),
            },
            white_list: config.white_list.clone(),
            log_level: config.log_level,
        }
    }

    async fn sign_in(&self, access: &str, username: &str, password: &str) -> Result<String> {
        let response = self
            .client
            .post(format!("{}/signin", self.url))
            .header(ACCEPT, "application/json")
            .json(&SigninRequest {
                ns: &self.namespace,
                db: &self.database,
                access,
                user: username,
                pass: password,
            })
            .send()
            .await
            .context("SurrealDB sign-in request failed")?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("SurrealDB sign-in returned {status}: {body}");
        }

        signin_token(&body)
    }

    async fn bearer_token(&self) -> Result<Option<String>> {
        let Authentication {
            access,
            username,
            password,
            token,
        } = &self.authentication;
        let mut cached = token.lock().await;
        if let Some(token) = cached.as_ref() {
            return Ok(Some(token.clone()));
        }
        let new_token = self.sign_in(access, username, password).await?;
        *cached = Some(new_token.clone());
        log_info(
            self.log_level,
            format_args!("SurrealDB authentication token obtained via access method {access}"),
        );
        Ok(Some(new_token))
    }

    async fn refresh_token(&self, rejected_token: Option<&str>) -> Result<Option<String>> {
        let Authentication {
            access,
            username,
            password,
            token,
        } = &self.authentication;

        let mut cached = token.lock().await;
        if cached.as_deref() == rejected_token {
            *cached = None;
        }
        if let Some(token) = cached.as_ref() {
            return Ok(Some(token.clone()));
        }

        let new_token = self.sign_in(access, username, password).await?;
        *cached = Some(new_token.clone());
        log_info(
            self.log_level,
            "SurrealDB authentication token renewed after the previous token was rejected",
        );
        Ok(Some(new_token))
    }

    async fn authenticate(&self) -> Result<()> {
        self.bearer_token().await?;
        Ok(())
    }

    async fn send_query(&self, query: &str, token: Option<&str>) -> Result<reqwest::Response> {
        let mut headers = HeaderMap::new();
        headers.insert("Surreal-NS", HeaderValue::from_str(&self.namespace)?);
        headers.insert("Surreal-DB", HeaderValue::from_str(&self.database)?);
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        if let Some(token) = token {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {token}"))?,
            );
        }

        self.client
            .post(format!("{}/sql", self.url))
            .headers(headers)
            .body(query.to_owned())
            .send()
            .await
            .context("SurrealDB query request failed")
    }

    async fn store(&self, gateway_id: &str, payload: &Value) -> Result<()> {
        ensure_gateway_identity(&self.authentication.username, gateway_id)?;
        let Some(query) = storage_query(
            gateway_id,
            payload,
            self.store_gateway_stats,
            self.white_list.as_ref(),
        )?
        else {
            return Ok(());
        };
        let mut token = self.bearer_token().await?;
        let mut response = self.send_query(&query, token.as_deref()).await?;

        if matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            if let Some(new_token) = self.refresh_token(token.as_deref()).await? {
                token = Some(new_token);
                response = self.send_query(&query, token.as_deref()).await?;
            }
        }

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("SurrealDB returned {status}: {body}");
        }
        ensure_query_succeeded(&body)?;
        log_debug(
            self.log_level,
            format_args!("stored time-series data in SurrealDB: {status}"),
        );
        Ok(())
    }
}

fn message_name(identifier: u8) -> &'static str {
    match identifier {
        PUSH_DATA => "PUSH_DATA",
        PUSH_ACK => "PUSH_ACK",
        PULL_DATA => "PULL_DATA",
        PULL_RESP => "PULL_RESP",
        PULL_ACK => "PULL_ACK",
        TX_ACK => "TX_ACK",
        _ => "UNKNOWN",
    }
}

fn ack(version: u8, token: [u8; 2], identifier: u8) -> [u8; 4] {
    [version, token[0], token[1], identifier]
}

fn format_gateway_id(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join("")
}

async fn handle_datagram(
    socket: &UdpSocket,
    bytes: &[u8],
    peer: SocketAddr,
    writer: Option<Arc<SurrealWriter>>,
    log_level: LogLevel,
) -> Result<()> {
    if bytes.len() < 4 {
        anyhow::bail!("datagram from {peer} is shorter than four-byte header");
    }
    let version = bytes[0];
    let token = [bytes[1], bytes[2]];
    let identifier = bytes[3];
    let token_number = u16::from_be_bytes(token);

    if version != PROTOCOL_VERSION {
        anyhow::bail!("unsupported protocol version {version}; expected {PROTOCOL_VERSION}");
    }

    match identifier {
        PUSH_DATA => {
            if bytes.len() < 12 {
                anyhow::bail!("PUSH_DATA from {peer} is missing gateway MAC");
            }
            let gateway_id = format_gateway_id(&bytes[4..12]);
            let raw_payload =
                std::str::from_utf8(&bytes[12..]).context("PUSH_DATA JSON is not UTF-8")?;
            let payload: Value =
                serde_json::from_str(raw_payload).context("PUSH_DATA payload is not valid JSON")?;
            socket.send_to(&ack(version, token, PUSH_ACK), peer).await?;
            log_debug(
                log_level,
                format_args!(
                    "{peer} PUSH_DATA gateway={gateway_id} token={token_number} payload_bytes={}",
                    bytes.len() - 12
                ),
            );
            if let Some(writer) = writer {
                tokio::spawn(async move {
                    if let Err(error) = writer.store(&gateway_id, &payload).await {
                        eprintln!("SurrealDB write failed: {error:#}");
                    }
                });
            }
        }
        PULL_DATA => {
            socket.send_to(&ack(version, token, PULL_ACK), peer).await?;
            log_debug(
                log_level,
                format_args!("{peer} PULL_DATA token={token_number}"),
            );
        }
        TX_ACK | PULL_RESP | PUSH_ACK | PULL_ACK => {
            log_debug(
                log_level,
                format_args!("{peer} {} token={token_number}", message_name(identifier)),
            );
        }
        _ => eprintln!("{peer} unknown message identifier 0x{identifier:02X}"),
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::from_args(Args::parse())?;
    let writer = Arc::new(SurrealWriter::new(&config));
    writer.authenticate().await?;
    let socket = UdpSocket::bind(config.bind).await?;
    log_info(
        config.log_level,
        format_args!(
            "lorawan-ray-collector listening for Semtech UDP Packet Forwarder datagrams on {}",
            config.bind
        ),
    );
    log_info(config.log_level, "SurrealDB persistence: enabled");
    log_info(
        config.log_level,
        format_args!(
            "Gateway status persistence: {}",
            if config.store_gateway_stats {
                "enabled"
            } else {
                "disabled"
            }
        ),
    );

    let mut buffer = [0_u8; 65_535];
    loop {
        let (length, peer) = socket.recv_from(&mut buffer).await?;
        if let Err(error) = handle_datagram(
            &socket,
            &buffer[..length],
            peer,
            Some(writer.clone()),
            config.log_level,
        )
        .await
        {
            eprintln!("discarded datagram from {peer}: {error:#}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_required_arguments_with_requested_defaults() {
        let args = Args::try_parse_from([
            "lorawan-ray-collector",
            "-d",
            "https://example.surreal.cloud",
            "-u",
            "gw_647FDAFFFE005E17",
            "-p",
            "secret",
        ])
        .unwrap();

        assert_eq!(args.listen_addr, "127.0.0.1:1700".parse().unwrap());
        assert_eq!(args.namespace, "lorawan");
        assert_eq!(args.database, "ray");
        assert_eq!(args.access, "gateway_writer");
        assert!(!args.gateway_stats);
        assert_eq!(args.log_level, LogLevel::Info);
    }

    #[test]
    fn enables_gateway_stats_and_debug_logging_from_arguments() {
        let args = Args::try_parse_from([
            "lorawan-ray-collector",
            "--destination",
            "https://example.surreal.cloud",
            "--username",
            "gw_647FDAFFFE005E17",
            "--password",
            "secret",
            "--ns",
            "test_namespace",
            "--db",
            "test_database",
            "--gateway-stats",
            "--white-list",
            "26011abc,11:22:33:44:55:66:77:88",
            "-l",
            "0.0.0.0:1701",
            "--log-level",
            "debug",
        ])
        .unwrap();

        assert!(args.gateway_stats);
        assert_eq!(args.log_level, LogLevel::Debug);
        assert_eq!(args.namespace, "test_namespace");
        assert_eq!(args.database, "test_database");
        assert_eq!(args.listen_addr, "0.0.0.0:1701".parse().unwrap());
        assert_eq!(
            args.white_list.as_deref(),
            Some("26011abc,11:22:33:44:55:66:77:88")
        );
    }

    #[test]
    fn reads_password_from_file() {
        let path = std::env::temp_dir().join(format!(
            "lorawan-ray-collector-password-{}",
            std::process::id()
        ));
        fs::write(&path, "file-secret\r\n").unwrap();

        let args = Args::try_parse_from([
            "lorawan-ray-collector",
            "--destination",
            "https://example.surreal.cloud",
            "--username",
            "gw_647FDAFFFE005E17",
            "--password-file",
            path.to_str().unwrap(),
        ])
        .unwrap();
        let config = Config::from_args(args).unwrap();

        fs::remove_file(path).unwrap();
        assert_eq!(config.password, "file-secret");
    }

    #[test]
    fn normalizes_white_list_entries() {
        let white_list = parse_white_list(Some("26011abc, 0x0403F1A0, 11:22:33:44:55:66:77:88"))
            .unwrap()
            .unwrap();

        assert!(white_list.contains("26011ABC"));
        assert!(white_list.contains("0403F1A0"));
        assert!(white_list.contains("1122334455667788"));
    }

    #[test]
    fn rejects_invalid_white_list_entries() {
        let error = parse_white_list(Some("26011ABC,not-a-device")).unwrap_err();
        assert!(error.to_string().contains("invalid --white-list entry"));
    }

    #[test]
    fn builds_protocol_ack() {
        assert_eq!(ack(2, [0x12, 0x34], PUSH_ACK), [2, 0x12, 0x34, 1]);
    }

    #[test]
    fn formats_gateway_id_as_unseparated_uppercase_hex() {
        assert_eq!(
            format_gateway_id(&[0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe]),
            "1032547698BADCFE"
        );
    }

    #[test]
    fn names_protocol_messages() {
        assert_eq!(message_name(PULL_ACK), "PULL_ACK");
        assert_eq!(message_name(0x99), "UNKNOWN");
    }

    #[test]
    fn extracts_signin_token() {
        assert_eq!(
            signin_token(r#"{"code":200,"token":"jwt-value"}"#).unwrap(),
            "jwt-value"
        );
    }

    #[test]
    fn rejects_signin_response_without_token() {
        let error = signin_token(r#"{"code":200}"#).unwrap_err();
        assert!(error.to_string().contains("did not contain a token"));
    }

    #[test]
    fn builds_record_access_signin_request() {
        let request = serde_json::to_value(SigninRequest {
            ns: "lorawan",
            db: "ray",
            access: "gateway_writer",
            user: "1032547698BADCFE",
            pass: "secret",
        })
        .unwrap();
        assert_eq!(
            request,
            serde_json::json!({
                "NS": "lorawan",
                "DB": "ray",
                "AC": "gateway_writer",
                "user": "1032547698BADCFE",
                "pass": "secret"
            })
        );
    }

    #[test]
    fn validates_authenticated_gateway_identity() {
        ensure_gateway_identity("1032547698badcfe", "1032547698BADCFE").unwrap();
        let error = ensure_gateway_identity("0102030405060708", "1032547698BADCFE").unwrap_err();
        assert!(error
            .to_string()
            .contains("does not match packet gateway ID"));
    }

    #[test]
    fn builds_normalized_storage_query() {
        let payload = serde_json::json!({
            "rxpk": [
                {
                    "jver": 2,
                    "time": "2026-08-25T12:00:00.123456Z",
                    "freq": 865.4,
                    "modu": "LR-FHSS",
                    "data": "QLwaASaCOTADBAqquxEiM0Q=",
                    "rsig": [{"ant": 0, "rssic": -105, "fdri": 4}]
                },
                {
                    "freq": 865.6,
                    "modu": "LORA",
                    "data": "VEVTVA=="
                }
            ],
            "stat": {
                "time": "2026-08-25 12:00:01 GMT",
                "rxnb": 2,
                "rxok": 2
            }
        });

        let query = storage_query("1032547698BADCFE", &payload, true, None)
            .unwrap()
            .unwrap();
        assert_eq!(query.matches("CREATE gateway_reception:").count(), 2);
        assert_eq!(query.matches("CREATE gateway_stat:").count(), 1);
        assert!(query.contains("\"observed_at\":\"2026-08-25T12:00:00.123456Z\""));
        assert!(query.contains("LET $observed_at_0 = <datetime>$reception_0.observed_at"));
        assert!(query.contains("LET $observed_at_1 = $ingested_at"));
        assert_eq!(
            query
                .matches("CREATE gateway_reception:[\"1032547698BADCFE\", $ingested_at")
                .count(),
            2
        );
        assert!(query.contains("\"gateway_id\":\"1032547698BADCFE\""));
        assert!(query.contains(
            "\"gateway_id\":$reception_0.gateway_id,\"observed_at\":$observed_at_0,\"ingested_at\":$ingested_at,\"timestamp_source\":$reception_0.timestamp_source"
        ));
        assert!(query.contains("\"timestamp_source\":\"ingested\""));
        assert!(query.contains("\"raw_rxpk\":{"));
        assert!(query.contains("\"time\":\"2026-08-25T12:00:00.123456Z\""));
        assert!(query
            .contains("\"raw_stat\":{\"rxnb\":2,\"rxok\":2,\"time\":\"2026-08-25 12:00:01 GMT\"}"));
        assert_eq!(query.matches("\"schema_version\":1").count(), 3);
        assert!(query.contains("\"radio\":{"));
        assert!(query.contains("\"frequency_hz\":865400000"));
        assert!(query.contains("\"best_rssi_dbm\":-105.0"));
        assert!(query.contains("\"phy\":{"));
        assert!(query.contains("\"payload_hex\":\"40BC1A012682393003040AAABB11223344\""));
        assert!(query.contains("\"payload_hash\":"));
        assert!(query.contains("\"lorawan\":{"));
        assert!(query.contains("\"decode_status\":\"decoded\""));
        assert!(query.contains("\"mtype\":\"UnconfirmedDataUp\""));
        assert!(query.contains("\"dev_addr\":\"26011ABC\""));
        assert!(query.contains("\"fcnt16\":12345"));
        assert!(query.contains("\"fport\":10"));
        assert!(query.contains("\"fopts_hex\":\"0304\""));
        assert!(query.contains("\"frm_payload_hex\":\"AABB\""));
        assert!(query.contains("\"adr\":true"));
        assert!(!query.contains("mic_valid"));
        assert!(query.contains("data PHYPayload is too short: 4 bytes"));
    }

    #[test]
    fn omits_gateway_status_when_disabled() {
        let payload = serde_json::json!({
            "rxpk": [{"data": "QLwaASaAOTAKqrsRIjNE"}],
            "stat": {"rxnb": 1, "rxok": 1}
        });

        let query = storage_query("1032547698BADCFE", &payload, false, None)
            .unwrap()
            .unwrap();
        assert!(query.contains("CREATE gateway_reception:"));
        assert!(!query.contains("CREATE gateway_stat:"));

        let stat_only = storage_query(
            "1032547698BADCFE",
            &serde_json::json!({"stat": {"rxnb": 1}}),
            false,
            None,
        )
        .unwrap();
        assert!(stat_only.is_none());
    }

    #[test]
    fn forwards_only_receptions_matching_the_white_list() {
        let payload = serde_json::json!({
            "rxpk": [
                {"data": "QLwaASaAOTAKqrsRIjNE"},
                {"data": "AAgHBgUEAwIBiHdmVUQzIhHSBKGyw9Q="}
            ]
        });

        let dev_addr = HashSet::from(["26011ABC".to_owned()]);
        let query = storage_query("1032547698BADCFE", &payload, false, Some(&dev_addr))
            .unwrap()
            .unwrap();
        assert_eq!(query.matches("CREATE gateway_reception:").count(), 1);
        assert!(query.contains("\"dev_addr\":\"26011ABC\""));
        assert!(!query.contains("\"dev_eui\":\"1122334455667788\""));

        let dev_eui = HashSet::from(["1122334455667788".to_owned()]);
        let query = storage_query("1032547698BADCFE", &payload, false, Some(&dev_eui))
            .unwrap()
            .unwrap();
        assert_eq!(query.matches("CREATE gateway_reception:").count(), 1);
        assert!(query.contains("\"dev_eui\":\"1122334455667788\""));
        assert!(!query.contains("\"dev_addr\":\"26011ABC\""));

        let no_match = HashSet::from(["01020304".to_owned()]);
        assert!(
            storage_query("1032547698BADCFE", &payload, false, Some(&no_match))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn decodes_lorawan_data_uplink() {
        let decoded = decode_lorawan("QLwaASaAOTAKqrsRIjNE");
        assert_eq!(decoded.decode_status, DecodeStatus::Decoded);
        assert_eq!(decoded.major, Some(LoRaWanMajor::LoRaWANR1));
        assert_eq!(decoded.mhdr_hex.as_deref(), Some("40"));
        assert_eq!(decoded.mtype, Some(LoRaWanMessageType::UnconfirmedDataUp));
        assert_eq!(decoded.dev_addr.as_deref(), Some("26011ABC"));
        assert_eq!(decoded.fcnt16, Some(12345));
        assert_eq!(decoded.fport, Some(10));
        assert_eq!(decoded.fopts_hex.as_deref(), Some(""));
        assert_eq!(decoded.frm_payload_hex.as_deref(), Some("AABB"));
        assert_eq!(decoded.adr, Some(true));
        assert_eq!(decoded.mic_hex.as_deref(), Some("11223344"));
        assert!(decoded.decode_error.is_none());
    }

    #[test]
    fn decodes_lorawan_data_uplink_with_fopts() {
        let decoded = decode_lorawan("QLwaASaCOTADBAqquxEiM0Q=");
        assert_eq!(decoded.fopts_hex.as_deref(), Some("0304"));
        assert_eq!(decoded.fport, Some(10));
        assert_eq!(decoded.frm_payload_hex.as_deref(), Some("AABB"));
        assert!(decoded.decode_error.is_none());
    }

    #[test]
    fn decodes_lorawan_data_uplink_without_fport() {
        let decoded = decode_lorawan("QLwaASaAOTARIjNE");
        assert_eq!(decoded.fopts_hex.as_deref(), Some(""));
        assert!(decoded.fport.is_none());
        assert!(decoded.frm_payload_hex.is_none());
        assert!(decoded.decode_error.is_none());
    }

    #[test]
    fn records_lorawan_decode_error_without_rejecting_rxpk() {
        let decoded = decode_lorawan("VEVTVA==");
        assert_eq!(decoded.mtype, Some(LoRaWanMessageType::UnconfirmedDataUp));
        assert_eq!(decoded.decode_status, DecodeStatus::Error);
        assert_eq!(
            decoded.decode_error.as_deref(),
            Some("data PHYPayload is too short: 4 bytes")
        );
    }

    #[test]
    fn decodes_lorawan_join_request() {
        let decoded = decode_lorawan("AAgHBgUEAwIBiHdmVUQzIhHSBKGyw9Q=");
        assert_eq!(decoded.decode_status, DecodeStatus::Decoded);
        assert_eq!(decoded.major, Some(LoRaWanMajor::LoRaWANR1));
        assert_eq!(decoded.mtype, Some(LoRaWanMessageType::JoinRequest));
        assert_eq!(decoded.join_eui.as_deref(), Some("0102030405060708"));
        assert_eq!(decoded.dev_eui.as_deref(), Some("1122334455667788"));
        assert_eq!(decoded.dev_nonce, Some(1234));
        assert_eq!(decoded.mic_hex.as_deref(), Some("A1B2C3D4"));
        assert!(decoded.decode_error.is_none());
    }

    #[test]
    fn rejects_invalid_rxpk_shape() {
        let error =
            storage_query("gateway", &serde_json::json!({"rxpk": {}}), true, None).unwrap_err();
        assert!(error.to_string().contains("rxpk must be an array"));
    }

    #[test]
    fn accepts_rxpk_without_time() {
        let query = storage_query(
            "1032547698BADCFE",
            &serde_json::json!({"rxpk": [{"data": "VEVTVA=="}]}),
            true,
            None,
        )
        .unwrap()
        .unwrap();
        assert!(query.contains("CREATE gateway_reception:[\"1032547698BADCFE\", $ingested_at"));
        assert!(query.contains("LET $observed_at_0 = $ingested_at"));
        assert!(query.contains("\"timestamp_source\":\"ingested\""));
        assert!(!query.contains("\"observed_at\":\""));
    }

    #[test]
    fn normalizes_lora_radio_metadata() {
        let packet = serde_json::json!({
            "jver": 2,
            "freq": 868.5,
            "modu": "LORA",
            "datr": "SF12BW125",
            "codr": "4/5",
            "stat": 1,
            "rsig": [
                {"ant": 0, "chan": 2, "rssic": -111, "rssis": -115, "lsnr": -8.5},
                {"ant": 1, "chan": 2, "rssic": -102, "lsnr": -6.25}
            ]
        });
        let radio = normalized_radio(packet.as_object().unwrap());
        assert_eq!(radio.frequency_hz, Some(868_500_000));
        assert_eq!(radio.spreading_factor, Some(12));
        assert_eq!(radio.bandwidth_hz, Some(125_000));
        assert_eq!(radio.best_rssi_dbm, Some(-102.0));
        assert_eq!(radio.best_snr_db, Some(-6.25));
        assert_eq!(radio.signals.len(), 2);
    }

    #[test]
    fn normalizes_lr_fhss_radio_metadata() {
        let packet = serde_json::json!({
            "jver": 2,
            "freq": 865.4,
            "modu": "LR-FHSS",
            "datr": "M0CW137",
            "codr": "1/3",
            "hpw": 4,
            "stat": 1,
            "rsig": [{
                "ant": 0,
                "chan": 3,
                "rssic": -105,
                "rssisd": 2,
                "foff": -420,
                "fdri": 14,
                "ftime": 123456789,
                "ftstat": 0
            }]
        });
        let radio = normalized_radio(packet.as_object().unwrap());
        assert_eq!(radio.modulation.as_deref(), Some("LR-FHSS"));
        assert_eq!(
            radio.data_rate,
            Some(DataRate::Identifier("M0CW137".to_owned()))
        );
        assert_eq!(radio.coding_rate.as_deref(), Some("1/3"));
        assert_eq!(radio.hopping_channel_width, Some(4));
        assert_eq!(radio.spreading_factor, None);
        assert_eq!(radio.bandwidth_hz, None);
        assert_eq!(radio.signals[0].frequency_drift_hz, Some(14.0));
        assert_eq!(radio.signals[0].frequency_offset_hz, Some(-420.0));
        assert_eq!(radio.signals[0].rssi_standard_deviation_db, Some(2.0));
        assert_eq!(radio.signals[0].fine_timestamp_ns, Some(123456789));
        assert_eq!(radio.signals[0].fine_timestamp_status, Some(0));
    }

    #[test]
    fn normalizes_legacy_top_level_signal_metadata() {
        let packet = serde_json::json!({
            "chan": 2,
            "rfch": 1,
            "rssi": -35,
            "lsnr": 5.1,
            "rsig": [{"chan": 9, "rssic": -90, "lsnr": -3.0}]
        });

        let radio = normalized_radio(packet.as_object().unwrap());
        assert_eq!(rxpk_format(packet.as_object().unwrap()), RxpkFormat::Legacy);
        assert_eq!(radio.best_rssi_dbm, Some(-35.0));
        assert_eq!(radio.best_snr_db, Some(5.1));
        assert_eq!(radio.signals.len(), 1);
        assert_eq!(radio.signals[0].channel, Some(2));
        assert_eq!(radio.signals[0].rf_chain, Some(1));
    }

    #[test]
    fn normalizes_gateway_v1_top_level_signal_metadata() {
        let packet = serde_json::json!({
            "jver": 1,
            "brd": 0,
            "ant": 1,
            "chan": 2,
            "rfch": 0,
            "rssi": -60,
            "rssis": -63,
            "lsnr": 13.5,
            "foff": -31113
        });

        let radio = normalized_radio(packet.as_object().unwrap());
        assert_eq!(
            rxpk_format(packet.as_object().unwrap()),
            RxpkFormat::GatewayV1
        );
        assert_eq!(radio.best_rssi_dbm, Some(-63.0));
        assert_eq!(radio.best_snr_db, Some(13.5));
        assert_eq!(radio.signals.len(), 1);
        assert_eq!(radio.signals[0].board, Some(0));
        assert_eq!(radio.signals[0].antenna, Some(1));
        assert_eq!(radio.signals[0].channel, Some(2));
        assert_eq!(radio.signals[0].rf_chain, Some(0));
        assert_eq!(radio.signals[0].rssi_channel_dbm, Some(-60.0));
        assert_eq!(radio.signals[0].rssi_signal_dbm, Some(-63.0));
        assert_eq!(radio.signals[0].frequency_offset_hz, Some(-31113.0));
    }

    #[test]
    fn normalizes_gateway_v2_rsig_metadata() {
        let packet = serde_json::json!({
            "jver": 2,
            "chan": 1,
            "rssi": -20,
            "lsnr": 12.0,
            "rsig": [{"ant": 0, "chan": 4, "rssic": -95, "lsnr": -2.5}]
        });

        let radio = normalized_radio(packet.as_object().unwrap());
        assert_eq!(
            rxpk_format(packet.as_object().unwrap()),
            RxpkFormat::GatewayV2
        );
        assert_eq!(radio.best_rssi_dbm, Some(-95.0));
        assert_eq!(radio.best_snr_db, Some(-2.5));
        assert_eq!(radio.signals.len(), 1);
        assert_eq!(radio.signals[0].channel, Some(4));
    }

    #[test]
    fn preserves_unknown_rxpk_version_without_guessing_signal_layout() {
        let packet = serde_json::json!({
            "jver": 3,
            "freq": 868.1,
            "modu": "LORA",
            "datr": "SF7BW125",
            "rssi": -50,
            "rsig": [{"rssic": -90}]
        });

        let radio = normalized_radio(packet.as_object().unwrap());
        assert_eq!(
            rxpk_format(packet.as_object().unwrap()),
            RxpkFormat::Unknown
        );
        assert_eq!(radio.frequency_hz, Some(868_100_000));
        assert_eq!(radio.spreading_factor, Some(7));
        assert!(radio.signals.is_empty());
        assert_eq!(radio.best_rssi_dbm, None);
    }

    #[test]
    fn decodes_legacy_url_safe_unpadded_payload() {
        let packet = serde_json::json!({
            "data": "-DS4CGaDCdG+48eJNM3Vai-zDpsR71Pn9CPA9uCON84"
        });

        let phy = normalized_phy(packet.as_object().unwrap());
        assert_eq!(phy.payload_size, Some(32));
        assert!(phy.payload_hex.is_some());
        assert!(phy.payload_base64.as_deref().unwrap().ends_with('='));
    }

    #[test]
    fn normalizes_reception_into_typed_document() {
        let raw_rxpk = serde_json::json!({
            "time": "2026-08-27T09:30:00.123Z",
            "freq": 868.3,
            "modu": "LORA",
            "datr": "SF9BW125",
            "stat": 1,
            "data": "QLwaASaAOTAKqrsRIjNE",
            "vendor_extension": {"preserved": true}
        })
        .as_object()
        .unwrap()
        .clone();

        let reception = normalize_reception("1032547698BADCFE", raw_rxpk, 0).unwrap();
        assert_eq!(reception.schema_version, 1);
        assert_eq!(reception.gateway_id, "1032547698BADCFE");
        assert_eq!(
            reception.observed_at.as_deref(),
            Some("2026-08-27T09:30:00.123Z")
        );
        assert_eq!(reception.timestamp_source, TimestampSource::Gateway);
        assert_eq!(reception.radio.frequency_hz, Some(868_300_000));
        assert_eq!(reception.radio.spreading_factor, Some(9));
        assert_eq!(reception.phy.payload_size, Some(15));
        assert_eq!(
            reception.lorawan.mtype,
            Some(LoRaWanMessageType::UnconfirmedDataUp)
        );
        assert_eq!(reception.raw_rxpk["vendor_extension"]["preserved"], true);
    }

    #[test]
    fn accepts_successful_query_response() {
        ensure_query_succeeded(r#"[{"status":"OK","result":null}]"#).unwrap();
    }

    #[test]
    fn rejects_statement_level_query_error() {
        let error =
            ensure_query_succeeded(r#"[{"status":"ERR","result":"table permission denied"}]"#)
                .unwrap_err();
        assert!(error.to_string().contains("table permission denied"));
    }
}
