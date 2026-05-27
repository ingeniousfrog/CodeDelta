import { Navigate, Route, Routes } from 'react-router-dom';
import App from './App';
import ImportPage from './pages/ImportPage';
import TimelinePage from './pages/TimelinePage';
import DeltaViewPage from './pages/DeltaViewPage';
import TraceViewPage from './pages/TraceViewPage';
import ProviderSettingsPage from './pages/ProviderSettingsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<App />}>
        <Route index element={<Navigate to="/import" replace />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="repos/:repoId/timeline" element={<TimelinePage />} />
        <Route path="repos/:repoId/delta" element={<DeltaViewPage />} />
        <Route path="repos/:repoId/trace" element={<TraceViewPage />} />
        <Route path="settings/provider" element={<ProviderSettingsPage />} />
      </Route>
    </Routes>
  );
}
