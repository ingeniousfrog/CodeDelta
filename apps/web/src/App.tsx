import { NavLink, Outlet, useMatch } from 'react-router-dom';

function repoNavPath(repoId: string | undefined, page: string): string {
  if (!repoId) return '/import';
  return `/repos/${repoId}/${page}`;
}

export default function App() {
  const match = useMatch('/repos/:repoId/*');
  const repoId = match?.params.repoId;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <NavLink to="/" className="brand-link">
            CodeDelta
          </NavLink>
          <span className="tagline">commit-aware structural code intelligence</span>
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar">
          <section className="nav-section">
            <h2>Repository</h2>
            <NavLink to="/import" className={({ isActive }) => (isActive ? 'nav active' : 'nav')}>
              Import
            </NavLink>
            {repoId && (
              <NavLink
                to={repoNavPath(repoId, 'timeline')}
                className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
              >
                Commit Timeline
              </NavLink>
            )}
          </section>

          <section className="nav-section">
            <h2>Analysis</h2>
            <NavLink
              to={repoId ? repoNavPath(repoId, 'delta') : '/import'}
              className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
              onClick={(e) => {
                if (!repoId) e.preventDefault();
              }}
            >
              Delta View
            </NavLink>
            <NavLink
              to={repoId ? repoNavPath(repoId, 'trace') : '/import'}
              className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
              onClick={(e) => {
                if (!repoId) e.preventDefault();
              }}
            >
              Trace View
            </NavLink>
          </section>

          <section className="nav-section">
            <h2>Settings</h2>
            <NavLink
              to="/settings/provider"
              className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
            >
              Provider Settings
            </NavLink>
          </section>
        </nav>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
