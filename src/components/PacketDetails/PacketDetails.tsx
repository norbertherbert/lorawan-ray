import { Badge } from 'flowbite-react';
import type { UplinkDetails } from '../../api/types.ts';
import { formatDate } from '../../lib.js';

interface PacketDetailsProps {
  packet?: UplinkDetails;
  loading: boolean;
  error?: Error | null;
}

export default function PacketDetails({ packet, loading, error }: PacketDetailsProps) {
  return (
    <section className="packet-details" aria-live="polite">
      <div className="packet-details-heading">
        <div>
          <p className="section-label">Packet details</p>
          <h3>{packet ? `${packet.mType} · ${packet.devAddr ?? packet.devEui ?? packet.id}` : 'Select a packet'}</h3>
        </div>
        {packet ? <Badge color="gray">{packet.receptionCount} gateway reception{packet.receptionCount === 1 ? '' : 's'}</Badge> : null}
      </div>
      {loading ? <p className="packet-details-placeholder">Loading decoded frame…</p> : null}
      {error ? <p className="packet-details-error">Could not load packet details: {error.message}</p> : null}
      {!loading && !error && !packet ? <p className="packet-details-placeholder">Choose a row above to inspect its decoded LoRaWAN structure.</p> : null}
      {packet ? (
        <div className="packet-details-columns">
          <div className="protocol-tree">
            <TreeGroup label="MHDR">
              <TreeValue label="Raw" value={packet.frame.mhdr.rawHex} mono />
              <TreeValue label="MType" value={packet.frame.mhdr.mType} />
              <TreeValue label="Major" value={packet.frame.mhdr.major} />
            </TreeGroup>
            {packet.frame.kind === 'data-uplink' ? (
              <TreeGroup label="MACPayload">
                <TreeGroup label="FHDR">
                  <TreeValue label="DevAddr" value={packet.frame.macPayload.fhdr.devAddr} mono />
                  <TreeValue label="FCtrl" value={packet.frame.macPayload.fhdr.fCtrl.rawHex} mono />
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
          </div>
          <div className="packet-raw-pane">
            <h4>Radio parameters</h4>
            <dl className="radio-parameter-grid">
              <div><dt>Modulation</dt><dd>{packet.modulation ?? '—'}</dd></div>
              <div><dt>Data rate</dt><dd>{packet.dataRate ?? '—'}</dd></div>
              <div><dt>Coding rate</dt><dd>{packet.codingRate ?? '—'}</dd></div>
              {packet.modulation === 'LORA' ? <div><dt>Spreading factor</dt><dd>{packet.spreadingFactor ? `SF${packet.spreadingFactor}` : '—'}</dd></div> : null}
              {packet.modulation === 'LR-FHSS' ? <div><dt>Hopping width</dt><dd>{packet.hoppingChannelWidth ?? '—'}</dd></div> : null}
              <div><dt>Frequency</dt><dd>{packet.frequencyMHz === null ? '—' : `${packet.frequencyMHz.toFixed(3)} MHz`}</dd></div>
            </dl>
            <h4>PHY payload</h4>
            <code>{groupHex(packet.phyPayloadHex)}</code>
            <h4>Gateway receptions</h4>
            <div className="gateway-reception-list">
              {packet.receptions.map((reception) => (
                <article key={reception.id}>
                  <strong>{reception.gatewayId}</strong>
                  <span>{formatDate(reception.receivedAt ?? reception.ingestedAt)}</span>
                  <span>{reception.modulation ?? '—'} · {reception.dataRate ?? '—'} · {reception.bestRssiDbm ?? '—'} dBm · {reception.bestSnrDb ?? '—'} dB</span>
                  {reception.modulation === 'LR-FHSS' ? (
                    <span className="lr-fhss-diagnostics">
                      HPW {reception.hoppingChannelWidth ?? '—'}
                      {reception.signals.map((signal, index) => (
                        <span key={index}> · signal {index + 1}: drift {signal.frequencyDriftHz ?? '—'} Hz, offset {signal.frequencyOffsetHz ?? '—'} Hz, RSSI σ {signal.rssiStandardDeviationDb ?? '—'} dB</span>
                      ))}
                    </span>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
