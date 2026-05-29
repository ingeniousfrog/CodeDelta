import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ServerBootGate } from './components/ServerBootGate';
import { AppRoutes } from './routes';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ServerBootGate>
        <AppRoutes />
      </ServerBootGate>
    </BrowserRouter>
  </StrictMode>,
);
