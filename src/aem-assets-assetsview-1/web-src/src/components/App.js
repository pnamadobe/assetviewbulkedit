import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import ExtensionRegistration from './ExtensionRegistration';
import BulkMetadataModal from './BulkMetadataModal';
import DemoSandbox from './DemoSandbox';

function FallbackComponent({ error }) {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>Bulk Metadata Extension Error</h2>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{error?.message}</pre>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <ErrorBoundary FallbackComponent={FallbackComponent}>
        <Routes>
          <Route index element={<ExtensionRegistration />} />
          <Route path="index.html" element={<ExtensionRegistration />} />
          <Route path="modal-bulk-metadata" element={<BulkMetadataModal />} />
          <Route path="demo" element={<DemoSandbox />} />
        </Routes>
      </ErrorBoundary>
    </Router>
  );
}
