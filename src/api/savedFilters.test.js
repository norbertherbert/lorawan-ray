import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSavedFilterDefinition,
  savedFilterDefinitionSignature,
  savedFilterDefinitionToFilters,
} from './savedFilters.ts';

test('creates a versioned PER definition from its restricted packet filters', () => {
  const definition = createSavedFilterDefinition('per', {
    packet: {
      devAddrs: ['26:01:1a:bc'],
      from: '2026-08-29T10:00:00.000Z',
      to: '2026-08-29T11:00:00.000Z',
      fCnt: { minimum: 100, maximum: 500 },
    },
    reception: { gatewayIds: ['64:7f:da:ff:fe:00:5e:17'] },
  });

  assert.deepEqual(definition, {
    type: 'per',
    version: 1,
    devAddr: '26011ABC',
    gatewayId: '647FDAFFFE005E17',
    observedFrom: '2026-08-29T10:00:00.000Z',
    observedTo: '2026-08-29T11:00:00.000Z',
    fCntFrom: 100,
    fCntTo: 500,
  });
  assert.deepEqual(savedFilterDefinitionToFilters(definition), {
    packet: {
      devAddrs: ['26011ABC'],
      from: '2026-08-29T10:00:00.000Z',
      to: '2026-08-29T11:00:00.000Z',
      fCnt: { minimum: 100, maximum: 500 },
    },
    reception: { gatewayIds: ['647FDAFFFE005E17'] },
  });
});

test('keeps existing PER definitions without a Gateway ID compatible', () => {
  assert.deepEqual(savedFilterDefinitionToFilters({
    type: 'per',
    version: 1,
    devAddr: '26011ABC',
  }), {
    packet: { devAddrs: ['26011ABC'] },
  });
});

test('rejects a PER definition without exactly one valid Device Address', () => {
  assert.throws(
    () => createSavedFilterDefinition('per', { packet: { devAddrs: [] } }),
    /exactly one Device Address/,
  );
  assert.throws(
    () => createSavedFilterDefinition('per', { packet: { devAddrs: ['not-hex'] } }),
    /8 hexadecimal digits/,
  );
  assert.throws(
    () => createSavedFilterDefinition('per', {
      packet: { devAddrs: ['26011ABC'] },
      reception: { gatewayIds: ['1032547698BADCFE', '647FDAFFFE005E17'] },
    }),
    /at most one Gateway ID/,
  );
  assert.throws(
    () => createSavedFilterDefinition('per', {
      packet: { devAddrs: ['26011ABC'] },
      reception: { gatewayIds: ['not-hex'] },
    }),
    /16 hexadecimal digits/,
  );
});

test('creates an Arad PER definition from its four prefix-derived Device Addresses', () => {
  const definition = createSavedFilterDefinition('per-arad', {
    packet: {
      devAddrs: ['26011A05', '26011A06', '26011A00', '26011A01'],
      from: '2026-08-29T10:00:00.000Z',
      to: '2026-08-29T11:00:00.000Z',
    },
    reception: { gatewayIds: ['64:7f:da:ff:fe:00:5e:17'] },
  });

  assert.deepEqual(definition, {
    type: 'per-arad',
    version: 1,
    devAddrPrefix: '26011A',
    gatewayId: '647FDAFFFE005E17',
    observedFrom: '2026-08-29T10:00:00.000Z',
    observedTo: '2026-08-29T11:00:00.000Z',
  });
  assert.deepEqual(savedFilterDefinitionToFilters(definition), {
    packet: {
      devAddrs: ['26011A05', '26011A06', '26011A00', '26011A01'],
      from: '2026-08-29T10:00:00.000Z',
      to: '2026-08-29T11:00:00.000Z',
    },
    reception: { gatewayIds: ['647FDAFFFE005E17'] },
  });
});

test('validates Arad PER prefixes and the complete address group', () => {
  assert.throws(
    () => savedFilterDefinitionToFilters({ type: 'per-arad', version: 1, devAddrPrefix: '26011' }),
    /6 hexadecimal digits/,
  );
  assert.throws(
    () => createSavedFilterDefinition('per-arad', {
      packet: { devAddrs: ['26011A05', '26011A06', '26011A00', '26011AFF'] },
    }),
    /suffixes 05, 06, 00, and 01/,
  );
});

test('saved-filter signatures ignore object key order', () => {
  const left = createSavedFilterDefinition('sniffer', {
    packet: { devAddrs: ['26011ABC'], text: 'UPLINK' },
  });
  const right = createSavedFilterDefinition('sniffer', {
    packet: { text: 'UPLINK', devAddrs: ['26011ABC'] },
  });

  assert.equal(savedFilterDefinitionSignature(left), savedFilterDefinitionSignature(right));
});
