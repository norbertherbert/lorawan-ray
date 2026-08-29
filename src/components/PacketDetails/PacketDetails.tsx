import { Alert, Badge, Card, Spinner } from 'flowbite-react';
import type { UplinkDetails } from '../../api/types.ts';
import { formatDate } from '../../lib.js';

interface PacketDetailsProps {
  packet?: UplinkDetails;
  loading: boolean;
  error?: Error | null;
}

export default function PacketDetails({ packet, loading, error }: PacketDetailsProps) {
  return (
    <Card className="packet-details" aria-live="polite">
      <div className="packet-details-heading">
        <h3 className="text-sm font-bold text-gray-900">Packet details</h3>
        {packet ? <Badge className="compact-heading-badge" color="gray" size="xs">{packet.receptionCount} gateway reception{packet.receptionCount === 1 ? '' : 's'}</Badge> : null}
      </div>
      {loading ? <div className="flex items-center justify-center gap-3 py-8"><Spinner /><span>Loading decoded frame…</span></div> : null}
      {error ? <Alert color="failure">Could not load packet details: {error.message}</Alert> : null}
      {!loading && !error && !packet ? <Alert color="gray">Choose a row above to inspect its decoded LoRaWAN structure.</Alert> : null}
      {packet ? (
        <div className="packet-details-columns">
          <Card className="protocol-tree">
            <TreeGroup label="MHDR">
              <TreeValue label="Raw" value={packet.frame.mhdr.rawHex} mono />
              <TreeValue label="MType" value={packet.frame.mhdr.mType} />
              <TreeValue label="Major" value={packet.frame.mhdr.major} />
            </TreeGroup>
            {packet.frame.kind === 'data-uplink' ? (
              <TreeGroup label="MACPayload">
                <TreeGroup label="FHDR">
                  <TreeValue label="DevAddr" value={packet.frame.macPayload.fhdr.devAddr} mono />
                  <TreeGroup label="FCtrl">
                    <TreeValue label="Raw" value={packet.frame.macPayload.fhdr.fCtrl.rawHex} mono />
                    <TreeValue label="ADR" value={flagValue(packet.frame.macPayload.fhdr.fCtrl.adr)} />
                    <TreeValue label="ADRACKReq" value={flagValue(packet.frame.macPayload.fhdr.fCtrl.adrAckRequest)} />
                    <TreeValue label="ACK" value={flagValue(packet.frame.macPayload.fhdr.fCtrl.ack)} />
                    <TreeValue label="ClassB" value={flagValue(packet.frame.macPayload.fhdr.fCtrl.classB)} />
                    <TreeValue label="FOptsLen" value={packet.frame.macPayload.fhdr.fCtrl.fOptsLength} />
                  </TreeGroup>
                  <TreeValue label="FCnt" value={packet.frame.macPayload.fhdr.fCnt16} />
                  <TreeValue label="FOpts" value={packet.frame.macPayload.fhdr.fOptsHex || '—'} mono />
                </TreeGroup>
                <TreeValue label="FPort" value={packet.frame.macPayload.fPort ?? '—'} />
                <TreeValue label="FRMPayload" value={packet.frame.macPayload.frmPayloadHex ?? '—'} mono />
                <TreeValue label="MIC" value={packet.frame.micHex} mono />
              </TreeGroup>
            ) : null}
            {packet.frame.kind === 'join-request' ? (
              <TreeGroup label="MACPayload">
                <TreeValue label="JoinEUI" value={packet.frame.macPayload.joinEui} mono />
                <TreeValue label="DevEUI" value={packet.frame.macPayload.devEui} mono />
                <TreeValue label="DevNonce" value={packet.frame.macPayload.devNonce} />
                <TreeValue label="MIC" value={packet.frame.micHex} mono />
              </TreeGroup>
            ) : null}
            {packet.frame.kind === 'unsupported' ? <TreeValue label="Decode" value={packet.frame.reason} /> : null}
          </Card>
          <Card className="packet-raw-pane">
            <h4 className="text-sm font-semibold text-gray-900">Radio parameters</h4>
            <dl className="radio-parameter-grid">
              <div><dt>Modulation</dt><dd>{packet.modulation ?? '—'}</dd></div>
              <div><dt>Data rate</dt><dd>{packet.dataRate ?? '—'}</dd></div>
              <div><dt>Coding rate</dt><dd>{packet.codingRate ?? '—'}</dd></div>
              {packet.modulation === 'LORA' ? <div><dt>Spreading factor</dt><dd>{packet.spreadingFactor ? `SF${packet.spreadingFactor}` : '—'}</dd></div> : null}
              {packet.modulation === 'LR-FHSS' ? <div><dt>LR-FHSS hop. ch. width</dt><dd>{packet.hoppingChannelWidth ?? '—'}</dd></div> : null}
              <div><dt>Frequency</dt><dd>{packet.frequencyMHz === null ? '—' : `${packet.frequencyMHz.toFixed(3)} MHz`}</dd></div>
            </dl>
            <h4 className="text-sm font-semibold text-gray-900">PHY payload</h4>
            <code>{groupHex(packet.phyPayloadHex)}</code>
            <h4 className="text-sm font-semibold text-gray-900">Gateway receptions</h4>
            <div className="gateway-reception-list">
              {packet.receptions.map((reception) => (
                <Card key={reception.id}>
                  <header className="gateway-reception-heading">
                    <div>
                      <span>Gateway</span>
                      <strong>{reception.gatewayId}</strong>
                    </div>
                    <div>
                      <span>Received</span>
                      <time>{formatDate(reception.receivedAt ?? reception.ingestedAt)}</time>
                    </div>
                  </header>
                  <dl className="gateway-reception-metrics">
                    <div><dt>Modulation</dt><dd>{reception.modulation ?? '—'}</dd></div>
                    <div><dt>Data rate</dt><dd>{reception.dataRate ?? '—'}</dd></div>
                    <div><dt>RSSI</dt><dd>{reception.bestRssiDbm ?? '—'} dBm</dd></div>
                    <div><dt>SNR</dt><dd>{reception.bestSnrDb ?? '—'} dB</dd></div>
                    {reception.modulation === 'LR-FHSS' ? reception.signals.flatMap((signal, index) => {
                      const source = signal.antenna === null ? `signal ${index + 1}` : `A${signal.antenna}`;
                      return [
                        <div key={`signal-${index}-drift`}><dt>LR-FHSS {source} freq. drift</dt><dd>{signal.frequencyDriftHz ?? '—'} Hz</dd></div>,
                        <div key={`signal-${index}-offset`}><dt>LR-FHSS {source} freq. offs.</dt><dd>{signal.frequencyOffsetHz ?? '—'} Hz</dd></div>,
                        <div key={`signal-${index}-rssi-deviation`}><dt>LR-FHSS {source} RSSI dev.</dt><dd>{signal.rssiStandardDeviationDb ?? '—'} dB</dd></div>,
                      ];
                    }) : null}
                  </dl>
                </Card>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </Card>
  );
}

function TreeGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="tree-group"><strong>{label}</strong><div>{children}</div></div>;
}

function TreeValue({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  return <div className="tree-value"><span>{label}</span><code className={mono ? '' : 'plain'}>{String(value)}</code></div>;
}

function groupHex(value: string): string {
  return value.match(/.{1,2}/g)?.join(' ') ?? value;
}

function flagValue(value: boolean): string {
  return value ? '1 (set)' : '0 (not set)';
}
