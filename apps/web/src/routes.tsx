import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import ImportPage from './pages/ImportPage';
import TimelinePage from './pages/TimelinePage';
import DeltaViewPage from './pages/DeltaViewPage';
import TraceViewPage from './pages/TraceViewPage';
import PanoramaPage from './pages/PanoramaPage';
import ProviderSettingsPage from './pages/ProviderSettingsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/import" replace />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="repos/:repoId/timeline" element={<TimelinePage />} />
        <Route path="repos/:repoId/delta" element={<DeltaViewPage />} />
        <Route path="repos/:repoId/trace" element={<TraceViewPage />} />
        <Route path="repos/:repoId/panorama" element={<PanoramaPage />} />
        <Route path="settings/provider" element={<ProviderSettingsPage />} />
      </Route>
    </Routes>
  );
}
