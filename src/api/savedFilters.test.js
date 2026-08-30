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
  });

  assert.deepEqual(definition, {
    type: 'per',
    version: 1,
    devAddr: '26011ABC',
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
