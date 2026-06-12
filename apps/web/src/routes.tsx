import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import ImportPage from './pages/ImportPage';

// Route-level code splitting: heavy views (xyflow graph, markdown/mermaid) load on demand.
const TimelinePage = lazy(() => import('./pages/TimelinePage'));
const DeltaViewPage = lazy(() => import('./pages/DeltaViewPage'));
const TraceViewPage = lazy(() => import('./pages/TraceViewPage'));
const PanoramaPage = lazy(() => import('./pages/PanoramaPage'));
const WikiPage = lazy(() => import('./pages/WikiPage'));
const ProviderSettingsPage = lazy(() => import('./pages/ProviderSettingsPage'));

function PageFallback() {
  return <p className="hint" style={{ padding: '2rem' }}>Loading…</p>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/import" replace />} />
        <Route path="import" element={<ImportPage />} />
        <Route
          path="repos/:repoId/timeline"
          element={
            <Suspense fallback={<PageFallback />}>
              <TimelinePage />
            </Suspense>
          }
        />
        <Route
          path="repos/:repoId/delta"
          element={
            <Suspense fallback={<PageFallback />}>
              <DeltaViewPage />
            </Suspense>
          }
        />
        <Route
          path="repos/:repoId/trace"
          element={
            <Suspense fallback={<PageFallback />}>
              <TraceViewPage />
            </Suspense>
          }
        />
        <Route
          path="repos/:repoId/panorama"
          element={
            <Suspense fallback={<PageFallback />}>
              <PanoramaPage />
            </Suspense>
          }
        />
        <Route
          path="repos/:repoId/wiki"
          element={
            <Suspense fallback={<PageFallback />}>
              <WikiPage />
            </Suspense>
          }
        />
        <Route
          path="settings/provider"
          element={
            <Suspense fallback={<PageFallback />}>
              <ProviderSettingsPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
