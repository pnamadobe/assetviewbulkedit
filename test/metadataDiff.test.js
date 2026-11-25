import {
  buildJsonPatchForAsset,
  computeCommonFieldStates
} from '../src/aem-assets-assetsview-1/web-src/src/services/metadataDiff';
import { MOCK_ASSETS } from '../src/aem-assets-assetsview-1/web-src/src/services/mockData';

describe('metadataDiff', () => {
  const sampleFields = [
    { property: 'dc:title', label: 'Title', type: 'text' },
    { property: 'dc:rights', label: 'Copyright', type: 'text' },
    { property: 'pur:expirationDate', label: 'Expiration Date', type: 'date' },
    { property: 'cq:tags', label: 'Tags', type: 'tags', multiValue: true },
    { property: 'custom:embargoed', label: 'Embargoed', type: 'boolean' }
  ];

  const fieldsByProperty = Object.fromEntries(sampleFields.map((f) => [f.property, f]));

  test('computeCommonFieldStates identifies shared vs. mixed scalar and multi-value fields', () => {
    const states = computeCommonFieldStates(sampleFields, [MOCK_ASSETS[0], MOCK_ASSETS[1]]);

    expect(states['dc:title'].isMixed).toBe(true);
    expect(states['dc:title'].sharedValue).toBeNull();

    expect(states['dc:rights'].isMixed).toBe(false);
    expect(states['dc:rights'].sharedValue).toBe('© 2026 Acme Corp');

    expect(states['pur:expirationDate'].isMixed).toBe(false);
    expect(states['pur:expirationDate'].sharedValue).toBe('2026-12-31');

    expect(states['custom:embargoed'].isMixed).toBe(false);
    expect(states['custom:embargoed'].sharedValue).toBe(false);

    expect(states['cq:tags'].isMixed).toBe(true);
    expect(states['cq:tags'].commonValues).toEqual(['brand:spring-2026']);
    expect(states['cq:tags'].partialValues).toEqual([
      'channel:social',
      'channel:web',
      'format:hero'
    ]);
  });

  test('buildJsonPatchForAsset only patches dirty fields and preserves existing tags in append mode', () => {
    const dirtyEdits = {
      'dc:rights': { value: '© 2027 Acme Corp' },
      'cq:tags': {
        mode: 'append',
        values: ['campaign:q2-refresh'],
        removedValues: ['format:hero']
      }
    };

    const patch0 = buildJsonPatchForAsset(MOCK_ASSETS[0].assetMetadata, dirtyEdits, fieldsByProperty);
    expect(patch0).toEqual([
      { op: 'add', path: '/assetMetadata/dc:rights', value: '© 2027 Acme Corp' },
      {
        op: 'add',
        path: '/assetMetadata/cq:tags',
        value: ['brand:spring-2026', 'channel:web', 'campaign:q2-refresh']
      }
    ]);

    const patch1 = buildJsonPatchForAsset(MOCK_ASSETS[1].assetMetadata, dirtyEdits, fieldsByProperty);
    expect(patch1).toEqual([
      { op: 'add', path: '/assetMetadata/dc:rights', value: '© 2027 Acme Corp' },
      {
        op: 'add',
        path: '/assetMetadata/cq:tags',
        value: ['brand:spring-2026', 'channel:social', 'campaign:q2-refresh']
      }
    ]);
  });

  test('buildJsonPatchForAsset supports replace mode, date ISO formatting, and clearing fields', () => {
    const dirtyEdits = {
      'dc:title': { value: '' },
      'pur:expirationDate': { value: '2027-06-30' },
      'cq:tags': { mode: 'replace', values: ['brand:evergreen'] }
    };

    const patch = buildJsonPatchForAsset(MOCK_ASSETS[0].assetMetadata, dirtyEdits, fieldsByProperty);
    expect(patch).toEqual([
      { op: 'remove', path: '/assetMetadata/dc:title' },
      {
        op: 'add',
        path: '/assetMetadata/pur:expirationDate',
        value: '2027-06-30T00:00:00.000Z'
      },
      { op: 'add', path: '/assetMetadata/cq:tags', value: ['brand:evergreen'] }
    ]);
  });
});
