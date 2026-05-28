import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMatch } from 'react-router-dom';
import { api, type RepoRef } from '../api/client';

const RepoContext = createContext<RepoRef | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  const match = useMatch('/repos/:repoId/*');
  const repoId = match?.params.repoId;
  const [repo, setRepo] = useState<RepoRef | null>(null);

  useEffect(() => {
    if (!repoId) {
      setRepo(null);
      return;
    }
    let cancelled = false;
    api
      .getRepo(repoId)
      .then((r) => {
        if (!cancelled) setRepo(r);
      })
      .catch(() => {
        if (!cancelled) setRepo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  return <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoRef | null {
  return useContext(RepoContext);
}
