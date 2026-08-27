export type LoRaWANMessageType =
  | 'JoinRequest'
  | 'JoinAccept'
  | 'UnconfirmedDataUp'
  | 'UnconfirmedDataDown'
  | 'ConfirmedDataUp'
  | 'ConfirmedDataDown'
  | 'RejoinRequest'
  | 'Proprietary';

export type LoRaWANMajor = 'LoRaWANR1' | 'RFU';

export interface MacHeader {
  rawHex: string;
  mType: LoRaWANMessageType;
  major: LoRaWANMajor;
}

export interface FrameControl {
  rawHex: string;
  adr: boolean;
  adrAckRequest: boolean;
  ack: boolean;
  classB: boolean;
  fOptsLength: number;
}

export interface FrameHeader {
  devAddr: string;
  fCtrl: FrameControl;
  /** The 16-bit counter value carried in the radio frame. */
  fCnt16: number;
  fOptsHex: string;
}

export interface DataUplinkFrame {
  kind: 'data-uplink';
  mhdr: MacHeader;
  macPayload: {
    fhdr: FrameHeader;
    fPort: number | null;
    frmPayloadHex: string | null;
  };
  micHex: string;
}

export interface JoinRequestFrame {
  kind: 'join-request';
  mhdr: MacHeader;
  macPayload: {
    joinEui: string;
    devEui: string;
    devNonce: number;
  };
  micHex: string;
}

export interface UnsupportedFrame {
  kind: 'unsupported';
  mhdr: MacHeader;
  macPayloadHex: string;
  micHex: string | null;
  reason: string;
}

export type DecodedLoRaWANFrame = DataUplinkFrame | JoinRequestFrame | UnsupportedFrame;
