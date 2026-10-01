import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/*
      Providers sit outside the ErrorBoundary so a crash-and-reset can still
      report itself through a toast rather than failing silently.
    */}
    <ToastProvider>
      <ConfirmProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>
);