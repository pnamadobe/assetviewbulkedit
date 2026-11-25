# AEM Assets View — Bulk Metadata Editor Extension

An Adobe App Builder UI Extension (`aem/assets/assetsview/1`) that brings **Admin View–style schema-driven bulk metadata editing** to **AEM Assets View**.

Whereas Assets View's built-in Bulk Metadata Edit is limited to 5 hardcoded fields (*Status, Expiration date, Author, Keywords, Tags*), this extension:

1. Adds a **Bulk Edit Metadata** action to the Browse View selection ActionBar (`assets`, `search`, and `collections` contexts) when 2 or more assets are selected.
2. Resolves each selected asset's effective metadata form (folder-assigned form → exact MIME-type form → MIME family form → default form).
3. Computes the **intersection of editable fields common to all selected assets**, grouped by tab, and notifies the user if any type- or folder-specific fields were hidden.
4. Displays shared values when all assets match and **`<Mixed Entries>`** when values differ—untouched fields are never overwritten.
5. Supports **Append / Remove** (preserving existing per-asset tags/keywords) as well as **Replace** mode on multi-value fields.
6. Saves only modified fields via **RFC 6902 JSON Patch** (`PATCH /adobe/assets/{assetId}/metadata` with `If-Match: <etag>`) in controlled parallel batches using the signed-in user's IMS token.

---

## Project Structure

```text
├── app.config.yaml                                   # Registers unified aem/assets/assetsview/1 extension point
├── extension-manifest.json
├── hooks/post-deploy.js                              # Prints AEM Extension Manager preview URL on deploy
├── src/aem-assets-assetsview-1/
│   ├── ext.config.yaml                               # Extension operations, web-src, and I/O Runtime proxy action
│   ├── actions/aem-metadata-proxy/index.js           # Optional CORS-free proxy forwarding caller's IMS Bearer token
│   └── web-src/
│       ├── index.html
│       └── src/
│           ├── components/
│           │   ├── App.js                            # Routes: /, /#modal-bulk-metadata, /#demo
│           │   ├── Constants.js                      # Extension ID & feature flags
│           │   ├── ExtensionRegistration.js          # Registers actionBar + quickActions with @adobe/uix-guest
│           │   ├── BulkMetadataModal.js              # Fullscreen host-connected modal
│           │   ├── BulkMetadataEditor.js             # Tabbed React Spectrum bulk editor UI
│           │   ├── MetadataFieldRenderer.js          # Field renderers + <Mixed Entries> + Append/Replace tags
│           │   └── DemoSandbox.js                    # Standalone local sandbox (no AEM host required)
│           └── services/
│               ├── schemaResolver.js                 # Form parser, precedence resolver & field intersection
│               ├── metadataDiff.js                   # Mixed-entry computation & RFC 6902 JSON Patch builder
│               ├── aemClient.js                      # Batched Assets Author API client (proxy or direct)
│               └── mockData.js                       # Mock assets & schemas for local demo/tests
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
- Switch between **2 Campaign Images** (same folder-assigned custom schema) and **Mixed (Image + Video + PDF)** to watch the common-field intersection update dynamically.
- Edit any field, test **Append / Remove** vs. **Replace** on Tags/Keywords, and click **Save** to inspect the exact RFC 6902 JSON Patch payloads generated per asset.

---

## Testing Live Inside AEM Assets View

### Prerequisites
- AEM as a Cloud Service with **Assets Ultimate** (UI Extensibility enabled).
- An Adobe Developer Console App Builder project linked to your org (`aio login && aio app use`).
- Non-admin users need `jcr:read` on `/content/dam/appdata/metadataforms` (or `/conf/global/settings/dam/adminui-extension/metadataschema`) to load custom forms directly; otherwise the extension gracefully falls back to the built-in standard AEM schema.

### Run Locally Against Assets View
```bash
aio app run
```
Then open AEM Assets View with `devMode=true` and `ext=https://localhost:9080`:
```text
https://experience.adobe.com/?devMode=true&ext=https://localhost:9080&repoId=author-pXXXXX-eYYYYY.adobeaemcloud.com#/@<your-org>/assets/workspace/
```

### Deploy to App Builder
```bash
aio app deploy
```
The `post-deploy` hook will print a developer preview URL for AEM Extension Manager.

### Optional: Intercept Built-in "Edit" on Multi-Select
In `src/aem-assets-assetsview-1/web-src/src/components/Constants.js`, set:
```js
export const OVERRIDE_BUILTIN_EDIT_ON_MULTISELECT = true;
```
to route Assets View's built-in `edit` action directly to this schema-driven bulk editor whenever 2 or more assets are selected.
