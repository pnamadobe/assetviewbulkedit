const {
  main,
  validateAemHost,
  validateAssetId,
  validateDamPath,
  flattenTagTree
} = require('../src/aem-assets-assetsview-1/actions/aem-metadata-proxy/index');

describe('aem-metadata-proxy action', () => {
  test('validateAemHost only permits adobeaemcloud.com and adobecqms.net hosts', () => {
    expect(validateAemHost('author-p12345-e67890.adobeaemcloud.com')).toBe(
      'https://author-p12345-e67890.adobeaemcloud.com'
    );
    expect(validateAemHost('https://author-p12345-e67890.adobeaemcloud.com/')).toBe(
      'https://author-p12345-e67890.adobeaemcloud.com'
    );
    expect(validateAemHost('https://evil.example.com')).toBeNull();
    expect(validateAemHost('http://author-p12345-e67890.adobeaemcloud.com')).toBeNull();
    expect(validateAemHost('https://author.adobeaemcloud.com.evil.com')).toBeNull();
  });

  test('validateAssetId validates urn:aaid:aem:<uuid> format', () => {
    expect(validateAssetId('urn:aaid:aem:11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(validateAssetId('../etc/passwd')).toBe(false);
    expect(validateAssetId('')).toBe(false);
  });

  test('validateDamPath only permits /content/dam paths without traversal', () => {
    expect(validateDamPath('/content/dam/26H2/hilton-hgv/')).toBe('/content/dam/26H2/hilton-hgv');
    expect(validateDamPath('/content/dam/brand/my folder')).toBe('/content/dam/brand/my folder');
    expect(validateDamPath('/content/dam/../etc/passwd')).toBeNull();
    expect(validateDamPath('/etc/passwd')).toBeNull();
    expect(validateDamPath('')).toBeNull();
  });

  test('flattenTagTree extracts namespace:path tag IDs and display paths', () => {
    const tree = {
      'jcr:primaryType': 'sling:Folder',
      brand: {
        'jcr:primaryType': 'cq:Tag',
        'jcr:title': 'Brand',
        campaigns: {
          'jcr:primaryType': 'cq:Tag',
          'jcr:title': 'Campaigns',
          spring: {
            'jcr:primaryType': 'cq:Tag',
            'jcr:title': 'Spring 2026'
          }
        }
      }
    };

    expect(flattenTagTree(tree)).toEqual([
      { id: 'brand:campaigns', title: 'Campaigns', displayPath: 'Brand / Campaigns' },
      {
        id: 'brand:campaigns/spring',
        title: 'Spring 2026',
        displayPath: 'Brand / Campaigns / Spring 2026'
      }
    ]);
  });

  test('main rejects requests without Authorization header', async () => {
    const res = await main({
      aemHost: 'https://author-p12345-e67890.adobeaemcloud.com',
      operation: 'getMetadata'
    });
    expect(res.statusCode).toBe(401);
  });

  test('main rejects disallowed hosts and unknown operations', async () => {
    const badHost = await main({
      __ow_headers: { authorization: 'Bearer test-token' },
      aemHost: 'https://example.com',
      operation: 'getMetadata'
    });
    expect(badHost.statusCode).toBe(400);

    const badOp = await main({
      __ow_headers: { authorization: 'Bearer test-token' },
      aemHost: 'https://author-p12345-e67890.adobeaemcloud.com',
      operation: 'deleteEverything'
    });
    expect(badOp.statusCode).toBe(400);

    const emptyBatch = await main({
      __ow_headers: { authorization: 'Bearer test-token' },
      aemHost: 'https://author-p12345-e67890.adobeaemcloud.com',
      operation: 'getMetadataBatch',
      assetIds: []
    });
    expect(emptyBatch.statusCode).toBe(400);

    const emptyPatchBatch = await main({
      __ow_headers: { authorization: 'Bearer test-token' },
      aemHost: 'https://author-p12345-e67890.adobeaemcloud.com',
      operation: 'patchMetadataBatch',
      patches: []
    });
    expect(emptyPatchBatch.statusCode).toBe(400);
  });
});
