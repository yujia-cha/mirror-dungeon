import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { registerServiceWorker } from './app/lib/register-sw.ts';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

// Offline support is additive: the app is mounted first and never waits on it.
registerServiceWorker();

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
