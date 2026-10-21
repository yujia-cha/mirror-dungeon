// First, before any module that parses with Zod at import time (the store's persisted state).
import './app/lib/zod-config.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { registerServiceWorker } from './app/lib/register-sw.ts';
import { installFeedback } from './app/feedback/install.ts';
import { installOverlayLog } from './app/overlay/overlay-log.ts';
import { useApp } from './app/store.ts';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

// Offline support is additive: the app is mounted first and never waits on it.
registerServiceWorker();

// The feedback form's error and action log (M127). In memory; nothing is sent unless the visitor
// sends feedback themselves.
installFeedback();
// The overlay window's 「방금 한 행동」 (M151): the run's changes as facts it says in sentences.
installOverlayLog(useApp);

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
