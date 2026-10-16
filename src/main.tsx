import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { registerServiceWorker } from './app/lib/register-sw.ts';
import { installFeedback } from './app/feedback/install.ts';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

// Offline support is additive: the app is mounted first and never waits on it.
registerServiceWorker();

// The feedback form's error and action log (M127). In memory; nothing is sent unless the visitor
// sends feedback themselves.
installFeedback();

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
