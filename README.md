# AEM Assets View — Bulk Metadata Editor Extension

An Adobe App Builder UI Extension (`aem/assets/assetsview/1`) that brings **Admin View–style schema-driven bulk metadata editing** to **AEM Assets View**.

Whereas Assets View's built-in Bulk Metadata Edit is limited to 5 hardcoded fields (*Status, Expiration date, Author, Keywords, Tags*), this extension:

1. Adds a **Bulk Edit All Metadata** action to the Browse View selection ActionBar (`assets`, `search`, and `collections` contexts) when 2 or more assets are selected.
2. Resolves each selected asset's effective metadata form:
   - Checks ancestor folders' `jcr:content` nodes in parallel (`assetsViewMetadataForm`, `metadataForm`, `metadataSchema`, `dam:metadataSchema`) so folder-assigned forms apply to every asset in that folder.
   - Falls back to Assets View forms (`/content/dam/appdata/metadataforms`), Admin View metadata schemas (`/conf/global/settings/dam/adminui-extension/metadataschema`), MIME-type forms, and built-in AEM defaults.
3. Computes the **intersection of editable fields common to all checked assets**, grouped by tab.
4. Presents an AEM-styled two-pane fullscreen modal:
   - **Left rail**: Borderless asset list with **Select All / per-asset checkboxes**, lazy-loaded **36×36 thumbnails**, and filenames. Unchecking any asset dynamically recomputes common fields, `<Mixed Entries>`, and the save target.
   - **Right panel**: Quiet Spectrum tabs with a 2-column form grid, real Spectrum `<DatePicker>`, searchable AEM `/content/cq:tags` `<ComboBox>` tag picker, `<Mixed Entries>` handling (untouched fields are never overwritten), and **Append / Remove** vs. **Replace** modes for multi-value fields.
5. Saves only modified fields via **RFC 6902 JSON Patch** (`PATCH /adobe/assets/{assetId}/metadata` with `If-Match: <etag>`) in batched proxy calls using the signed-in user's own IMS Bearer token.

---

## Project Structure

```text
├── app.config.yaml                                   # Registers unified aem/assets/assetsview/1 extension point
├── extension-manifest.json
├── hooks/post-deploy.js                              # Prints AEM Extension Manager preview URL on deploy
├── src/aem-assets-assetsview-1/
│   ├── ext.config.yaml                               # Extension operations, web-src, and I/O Runtime proxy action
│   ├── actions/aem-metadata-proxy/index.js           # CORS-free proxy: getMetadata(Batch), patchMetadata(Batch),
│   │                                                 # getFolderSchema, getMetadataForms, getThumbnail, getTags
│   └── web-src/
│       ├── index.html
│       └── src/
│           ├── components/
│           │   ├── App.js                            # Routes: /, /#modal-bulk-metadata, /#demo
│           │   ├── Constants.js                      # Extension ID & feature flags
│           │   ├── ExtensionRegistration.js          # Registers actionBar + quickActions with @adobe/uix-guest
│           │   ├── BulkMetadataModal.js              # Fullscreen host-connected modal
│           │   ├── BulkMetadataEditor.js             # Two-pane Spectrum editor (asset checklist + tabbed form)
│           │   ├── MetadataFieldRenderer.js          # Spectrum DatePicker, Tag ComboBox, Pickers, Inputs
│           │   └── DemoSandbox.js                    # Standalone local sandbox (no AEM host required)
│           └── services/
│               ├── schemaResolver.js                 # Form parser, precedence resolver & field intersection
│               ├── metadataDiff.js                   # Mixed-entry computation & RFC 6902 JSON Patch builder
│               ├── aemClient.js                      # Batched Assets Author API client with fallback
│               └── mockData.js                       # Mock assets, schemas & tags for local demo/tests
└── test/
    ├── schemaResolver.test.js
    ├── metadataDiff.test.js
    └── aemProxyAction.test.js
```

---

## Quick Start (Local Demo & Tests)

```bash
npm install
npm test
npm run dev
```

Open **`http://localhost:9080/#/demo`** in your browser to interact with the local sandbox:
- Toggle individual assets in the left rail (or switch presets between **2 Campaign Images** and **Mixed Image + Video + PDF**) to watch the common-field intersection and `<Mixed Entries>` update live.
- Test the Spectrum `<DatePicker>`, searchable Tag `<ComboBox>`, and **Append / Remove** vs. **Replace** modes, then click **Save** to inspect the exact RFC 6902 JSON Patch payloads generated per asset.

---

## Deploying & Testing in AEM Assets View

### Prerequisites
- AEM as a Cloud Service with **Assets Ultimate** (UI Extensibility enabled).
- An Adobe Developer Console App Builder project (`aio app use <workspace>.json --merge`).
- Note: Non-admin users need `jcr:read` on `/content/dam/appdata/metadataforms` (or `/conf/global/settings/dam/adminui-extension/metadataschema`) and `/content/cq:tags` to load custom forms and taxonomy tags; otherwise the extension gracefully falls back to built-in AEM defaults and free-text tags.

### Local Live Testing
```bash
aio app run
```
Open AEM Assets View with `devMode=true` and `ext=https://localhost:9080`:
```text
https://experience.adobe.com/?devMode=true&ext=https://localhost:9080&repoId=author-pXXXXX-eYYYYY.adobeaemcloud.com#/@<your-org>/assets/workspace/
```

### Deploy to Stage / Production
```bash
# Switch workspace first if needed:
aio app use <workspace>.json --merge

# Deploy (use --force-deploy when updating an already-published Production workspace):
aio app deploy --force-deploy
```
The `post-deploy` hook prints an **AEM Extension Manager** developer preview URL.

### Known Platform Notes
- **Built-in "Bulk Metadata Edit" button**: AEM Assets View does not currently expose a hideable ActionBar action ID for the built-in *Bulk Metadata Edit* button (returning undocumented IDs from `getHiddenBuiltInActions` causes Assets View to reject the extension's `actionBar` actions).
- **CDN cache after deploy**: `adobeio-static.net` caches `index.html` for up to **5 minutes (300s)** on CloudFront. Right after a deploy, wait for the TTL to roll over and hard-reload (`Cmd + Shift + R`) in Assets View if the custom ActionBar button temporarily disappears.
