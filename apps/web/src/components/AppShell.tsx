import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { RepoProvider, useRepo } from '../context/RepoContext';

function repoNavPath(repoId: string | undefined, page: string): string {
  if (!repoId) return '/import';
  return `/repos/${repoId}/${page}`;
}

function ShellInner() {
  const match = useMatch('/repos/:repoId/*');
  const repoId = match?.params.repoId;
  const repo = useRepo();

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-brand">
          <NavLink to="/" className="brand-link">
            CodeDelta
          </NavLink>
          <span className="brand-tagline">commit-aware structural intelligence</span>
        </div>
        {repo && (
          <div className="app-header-repo" title={repo.input}>
            <strong>Repository</strong> · {repo.input}
          </div>
        )}
      </header>

      <div className="app-body">
        <nav className="app-sidebar" aria-label="Main">
          <section className="nav-section">
            <p className="nav-section-title">Repository</p>
            <NavLink to="/import" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              Import
            </NavLink>
            {repoId ? (
              <NavLink
                to={repoNavPath(repoId, 'timeline')}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                Commit Timeline
              </NavLink>
            ) : null}
          </section>

          <section className="nav-section">
            <p className="nav-section-title">Analysis</p>
            {repoId ? (
              <>
                <NavLink
                  to={repoNavPath(repoId, 'delta')}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  Delta View
                </NavLink>
                <NavLink
                  to={repoNavPath(repoId, 'trace')}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  Trace View
                </NavLink>
                <NavLink
                  to={repoNavPath(repoId, 'panorama')}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  Panorama
                </NavLink>
              </>
            ) : (
              <>
                <span className="nav-link disabled" title="Import a repository first">
                  Delta View
                </span>
                <span className="nav-link disabled" title="Import a repository first">
                  Trace View
                </span>
                <span className="nav-link disabled" title="Import a repository first">
                  Panorama
                </span>
              </>
            )}
          </section>

          <section className="nav-section">
            <p className="nav-section-title">Settings</p>
            <NavLink
              to="/settings/provider"
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              Provider Settings
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
