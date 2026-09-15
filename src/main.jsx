import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { getPreferences } from './core/hooks/usePreferences';
import { applyNoticeLocale } from './core/notices/apply-locale';
import './index.css';

// Apply the stored notice locale before the first render, so a reload never flashes English
// messages at a user who chose otherwise (#826 Phase 6). Every later change applies through
// usePreferences.save() — this only covers the case where nothing has been written yet.
applyNoticeLocale(getPreferences().noticeLocale);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  }
});

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
