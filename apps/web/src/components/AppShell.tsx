import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RepoProvider, useRepo } from '../context/RepoContext';

function repoNavPath(repoId: string | undefined, page: string): string {
  if (!repoId) return '/import';
  return `/repos/${repoId}/${page}`;
}

function ShellInner() {
  const { t } = useTranslation('common');
  const match = useMatch('/repos/:repoId/*');
  const repoId = match?.params.repoId;
  const repo = useRepo();
  const importFirst = t('nav.importFirst');

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-brand">
          <NavLink to="/" className="brand-link">
            CodeDelta
          </NavLink>
          <span className="brand-tagline">{t('brand.tagline')}</span>
        </div>
        {repo && (
          <div className="app-header-repo" title={repo.input}>
            <strong>{t('brand.repository')}</strong> · {repo.input}
          </div>
        )}
      </header>

      <div className="app-body">
        <nav className="app-sidebar" aria-label={t('nav.ariaMain')}>
          <section className="nav-section">
            <p className="nav-section-title">{t('nav.sectionRepository')}</p>
            <NavLink to="/import" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              {t('nav.import')}
            </NavLink>
            {repoId ? (
              <NavLink
                to={repoNavPath(repoId, 'timeline')}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {t('nav.timeline')}
              </NavLink>
            ) : null}
          </section>

          <section className="nav-section">
            <p className="nav-section-title">{t('nav.sectionAnalysis')}</p>
            {repoId ? (
              <>
                <NavLink
                  to={repoNavPath(repoId, 'delta')}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  {t('nav.delta')}
                </NavLink>
                <NavLink
                  to={repoNavPath(repoId, 'trace')}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  {t('nav.trace')}
                </NavLink>
                <NavLink
                  to={repoNavPath(repoId, 'panorama')}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  {t('nav.panorama')}
                </NavLink>
                <NavLink
                  to={repoNavPath(repoId, 'wiki')}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  {t('nav.wiki')}
                </NavLink>
                <NavLink
                  to={repoNavPath(repoId, 'training')}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  {t('nav.training')}
                </NavLink>
              </>
            ) : (
              <>
                <span className="nav-link disabled" title={importFirst}>
                  {t('nav.delta')}
                </span>
                <span className="nav-link disabled" title={importFirst}>
                  {t('nav.trace')}
                </span>
                <span className="nav-link disabled" title={importFirst}>
                  {t('nav.panorama')}
                </span>
                <span className="nav-link disabled" title={importFirst}>
                  {t('nav.wiki')}
                </span>
                <span className="nav-link disabled" title={importFirst}>
                  {t('nav.training')}
                </span>
              </>
            )}
          </section>

          <section className="nav-section">
            <p className="nav-section-title">{t('nav.sectionSettings')}</p>
            <NavLink
              to="/settings"
              end
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {t('nav.general')}
            </NavLink>
            <NavLink
              to="/settings/provider"
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {t('nav.provider')}
            </NavLink>
          </section>
        </nav>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function AppShell() {
  return (
    <RepoProvider>
      <ShellInner />
    </RepoProvider>
  );
}
