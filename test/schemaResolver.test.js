import {
  createSchemaRegistry,
  intersectCommonFields,
  normalizePropertyName,
  parseAemSchemaTree,
  resolveEffectiveFormForAsset
} from '../src/aem-assets-assetsview-1/web-src/src/services/schemaResolver';
import { MOCK_ASSETS, MOCK_SCHEMA_REGISTRY } from '../src/aem-assets-assetsview-1/web-src/src/services/mockData';

describe('schemaResolver', () => {
  test('normalizePropertyName strips JCR prefixes and rejects invalid paths', () => {
    expect(normalizePropertyName('./jcr:content/metadata/dc:title')).toBe('dc:title');
    expect(normalizePropertyName('/jcr:content/metadata/custom:region')).toBe('custom:region');
    expect(normalizePropertyName('dc:description')).toBe('dc:description');
    expect(normalizePropertyName('./jcr:content/renditions/original')).toBeNull();
    expect(normalizePropertyName('invalid prop name')).toBeNull();
    expect(normalizePropertyName('')).toBeNull();
  });

  test('resolveEffectiveFormForAsset prioritizes folder-assigned form over MIME type', () => {
    const campaignImg = MOCK_ASSETS[0]; // in /content/dam/brand/campaigns/spring-2026
    const form = resolveEffectiveFormForAsset(campaignImg, MOCK_SCHEMA_REGISTRY);

    expect(form.id).toBe('campaign-hero');
    const propNames = form.tabs.flatMap((t) => t.fields.map((f) => f.property));
    // Inherits default + image + campaign-hero fields
    expect(propNames).toContain('dc:title');
    expect(propNames).toContain('photoshop:Headline');
    expect(propNames).toContain('custom:campaignCode');
  });

  test('resolveEffectiveFormForAsset falls back to MIME type and default', () => {
    const video = MOCK_ASSETS[2];
    const pdf = MOCK_ASSETS[3];
    const unknown = {
      id: 'urn:aaid:aem:999',
      path: '/content/dam/other/archive.zip',
      mimeType: 'application/zip'
    };

    expect(resolveEffectiveFormForAsset(video, MOCK_SCHEMA_REGISTRY).id).toBe('video');
    expect(resolveEffectiveFormForAsset(pdf, MOCK_SCHEMA_REGISTRY).id).toBe('application/pdf');
    expect(resolveEffectiveFormForAsset(unknown, MOCK_SCHEMA_REGISTRY).id).toBe('default');
  });

  test('intersectCommonFields returns all fields when selection shares one schema', () => {
    const forms = [MOCK_ASSETS[0], MOCK_ASSETS[1]].map((a) =>
      resolveEffectiveFormForAsset(a, MOCK_SCHEMA_REGISTRY)
    );
    const result = intersectCommonFields(forms);

    expect(result.distinctForms).toHaveLength(1);
    expect(result.omittedFields).toHaveLength(0);
    const props = result.fields.map((f) => f.property);
    expect(props).toContain('custom:campaignCode');
    expect(props).toContain('photoshop:Headline');
    expect(props).toContain('dc:title');
  });

  test('intersectCommonFields intersects common fields across mixed MIME types & folders', () => {
    const forms = MOCK_ASSETS.map((a) =>
      resolveEffectiveFormForAsset(a, MOCK_SCHEMA_REGISTRY)
    );
    const result = intersectCommonFields(forms);

    expect(result.distinctForms).toHaveLength(3);
    const commonProps = result.fields.map((f) => f.property);
    // Common to image, video, and pdf (from default)
    expect(commonProps).toContain('dc:title');
    expect(commonProps).toContain('cq:tags');
    expect(commonProps).toContain('pur:expirationDate');
    // Type- or folder-specific fields excluded
    expect(commonProps).not.toContain('custom:campaignCode');
    expect(commonProps).not.toContain('photoshop:Headline');
    expect(commonProps).not.toContain('xmpDM:artist');
    expect(commonProps).not.toContain('pdf:Producer');
    expect(result.omittedFields.length).toBeGreaterThan(0);
  });

  test('parseAemSchemaTree parses JCR metadataforms infinity.json', () => {
    const jcrTree = {
      'jcr:primaryType': 'sling:Folder',
      'brand-custom': {
        'jcr:title': 'Brand Custom Form',
        folderPaths: ['/content/dam/brand/press'],
        items: {
          tabs: {
            items: {
              tab1: {
                'jcr:title': 'Press Info',
                items: {
                  col1: {
                    items: {
                      field1: {
                        'sling:resourceType': 'granite/ui/components/coral/foundation/form/textfield',
                        fieldLabel: 'Press Contact',
                        name: './jcr:content/metadata/brand:pressContact',
                        required: true
                      },
                      readonlyField: {
                        'sling:resourceType': 'granite/ui/components/coral/foundation/form/textfield',
                        fieldLabel: 'File Size',
                        name: './jcr:content/metadata/dam:size',
                        readOnly: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const parsed = parseAemSchemaTree(jcrTree);
    const registry = createSchemaRegistry(parsed);
    const asset = {
      id: 'urn:aaid:aem:abc',
      path: '/content/dam/brand/press/release.jpg',
      mimeType: 'image/jpeg'
    };

    const form = resolveEffectiveFormForAsset(asset, registry);
    expect(form.id).toBe('brand-custom');
    expect(form.tabs).toHaveLength(1);
    expect(form.tabs[0].fields).toEqual([
      expect.objectContaining({
        property: 'brand:pressContact',
        label: 'Press Contact',
        type: 'text',
        required: true
      })
    ]);
  });
});
