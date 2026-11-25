/**
 * Realistic mock dataset for the standalone local demo sandbox (`/#/demo`).
 * Lets you test schema resolution, common-field intersection, <Mixed Entries>,
 * and Append vs. Replace multi-value editing without connecting to an AEM environment.
 */

import { createSchemaRegistry } from './schemaResolver';

export const MOCK_SCHEMA_REGISTRY = createSchemaRegistry({
  formsById: {
    'campaign-hero': {
      id: 'campaign-hero',
      name: 'Campaign Hero Form (Folder Custom)',
      extends: 'image',
      tabs: [
        {
          id: 'campaign',
          label: 'Campaign',
          fields: [
            { property: 'custom:campaignCode', label: 'Campaign Code', type: 'text', required: true },
            {
              property: 'custom:region',
              label: 'Target Region',
              type: 'select',
              options: [
                { label: 'Global', value: 'global' },
                { label: 'North America', value: 'na' },
                { label: 'EMEA', value: 'emea' },
                { label: 'APAC', value: 'apac' }
              ]
            },
            { property: 'custom:embargoed', label: 'Embargoed Asset', type: 'boolean' }
          ]
        }
      ]
    }
  },
  folderAssignments: {
    '/content/dam/brand/campaigns/spring-2026': 'campaign-hero'
  }
});

export const MOCK_TAGS = [
  { id: 'brand:spring-2026', title: 'Spring 2026', displayPath: 'Brand / Spring 2026' },
  { id: 'brand:evergreen', title: 'Evergreen', displayPath: 'Brand / Evergreen' },
  { id: 'channel:web', title: 'Web', displayPath: 'Channel / Web' },
  { id: 'channel:social', title: 'Social', displayPath: 'Channel / Social' },
  { id: 'channel:video', title: 'Video', displayPath: 'Channel / Video' },
  { id: 'channel:press', title: 'Press', displayPath: 'Channel / Press' },
  { id: 'format:hero', title: 'Hero Banner', displayPath: 'Format / Hero Banner' },
  { id: 'campaign:q2-refresh', title: 'Q2 Refresh', displayPath: 'Campaign / Q2 Refresh' }
];

export const MOCK_ASSETS = [
  {
    id: 'urn:aaid:aem:11111111-1111-4111-8111-111111111111',
    path: '/content/dam/brand/campaigns/spring-2026/hero-banner.jpg',
    name: 'hero-banner.jpg',
    mimeType: 'image/jpeg',
    etag: '"etag-hero-1"',
    assetMetadata: {
      'dc:title': 'Spring 2026 Hero Banner',
      'dc:description': 'Primary hero visual for homepage launch.',
      'dam:status': 'approved',
      'dc:creator': 'Maya Lin',
      'dc:language': 'en-US',
      'cq:tags': ['brand:spring-2026', 'channel:web', 'format:hero'],
      'dc:subject': ['spring', 'launch', 'hero'],
      'pur:expirationDate': '2026-12-31T00:00:00.000Z',
      'dc:rights': '© 2026 Acme Corp',
      'photoshop:Headline': 'Refresh Your Workspace',
      'photoshop:Credit': 'Studio North',
      'custom:campaignCode': 'SPR-2026-Q2',
      'custom:region': 'global',
      'custom:embargoed': false
    },
    repositoryMetadata: {
      'repo:name': 'hero-banner.jpg',
      'dc:format': 'image/jpeg'
    }
  },
  {
    id: 'urn:aaid:aem:22222222-2222-4222-8222-222222222222',
    path: '/content/dam/brand/campaigns/spring-2026/product-closeup.png',
    name: 'product-closeup.png',
    mimeType: 'image/png',
    etag: '"etag-product-2"',
    assetMetadata: {
      'dc:title': 'Spring 2026 Product Close-up',
      'dc:description': 'Studio close-up shot for social cards.',
      'dam:status': 'approved',
      'dc:creator': 'Alex Rivera',
      'dc:language': 'en-US',
      'cq:tags': ['brand:spring-2026', 'channel:social'],
      'dc:subject': ['spring', 'product'],
      'pur:expirationDate': '2026-12-31T00:00:00.000Z',
      'dc:rights': '© 2026 Acme Corp',
      'photoshop:Headline': 'Crafted for Speed',
      'photoshop:Credit': 'Studio North',
      'custom:campaignCode': 'SPR-2026-Q2',
      'custom:region': 'na',
      'custom:embargoed': false
    },
    repositoryMetadata: {
      'repo:name': 'product-closeup.png',
      'dc:format': 'image/png'
    }
  },
  {
    id: 'urn:aaid:aem:33333333-3333-4333-8333-333333333333',
    path: '/content/dam/brand/videos/launch-teaser.mp4',
    name: 'launch-teaser.mp4',
    mimeType: 'video/mp4',
    etag: '"etag-video-3"',
    assetMetadata: {
      'dc:title': 'Spring Launch Teaser 30s',
      'dc:description': '30-second cutdown for paid social.',
      'dam:status': 'inReview',
      'dc:creator': 'Maya Lin',
      'dc:language': 'en-US',
      'cq:tags': ['brand:spring-2026', 'channel:video'],
      'dc:subject': ['spring', 'teaser', 'video'],
      'pur:expirationDate': '2026-12-31T00:00:00.000Z',
      'dc:rights': '© 2026 Acme Corp',
      'xmpDM:artist': 'Motion Lab',
      'xmpDM:genre': 'Commercial'
    },
    repositoryMetadata: {
      'repo:name': 'launch-teaser.mp4',
      'dc:format': 'video/mp4'
    }
  },
  {
    id: 'urn:aaid:aem:44444444-4444-4444-8444-444444444444',
    path: '/content/dam/brand/docs/spring-lookbook.pdf',
    name: 'spring-lookbook.pdf',
    mimeType: 'application/pdf',
    etag: '"etag-pdf-4"',
    assetMetadata: {
      'dc:title': 'Spring 2026 Lookbook',
      'dc:description': 'Press & partner PDF lookbook.',
      'dam:status': 'approved',
      'dc:creator': 'Brand Ops',
      'dc:language': 'en-US',
      'cq:tags': ['brand:spring-2026', 'channel:press'],
      'dc:subject': ['spring', 'lookbook'],
      'pur:expirationDate': '2026-12-31T00:00:00.000Z',
      'dc:rights': '© 2026 Acme Corp',
      'pdf:Producer': 'Adobe InDesign',
      'dc:publisher': 'Acme Marketing'
    },
    repositoryMetadata: {
      'repo:name': 'spring-lookbook.pdf',
      'dc:format': 'application/pdf'
    }
  }
];
