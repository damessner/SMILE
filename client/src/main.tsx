import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ThemeProvider, applyStoredTheme } from './components/ThemeToggle';
import './index.css';

// Belt-and-braces with the inline script in index.html: guarantees the attribute
// is set even if the inline script was blocked.
applyStoredTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/*
      Providers sit outside the ErrorBoundary so a crash-and-reset can still
      report itself through a toast rather than failing silently.
    */}
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);