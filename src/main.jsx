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
      /**
       * ⚠️⚠️ `networkMode: 'always'` IS LOAD-BEARING. DO NOT REMOVE. (#964)
       *
       * The default (`'online'`) makes TanStack PAUSE a query whenever it believes the browser is
       * offline — and it decides that from `navigator.onLine`, which reports INTERNET connectivity.
       * This app's API is on **localhost**, which is reachable whatever the internet is doing, so
       * the two are unrelated and the default is simply wrong here.
       *
       * The measured consequence (2026-09-23) was severe and silent. A paused query reports
       * `{ status: 'pending', fetchStatus: 'paused', isError: false, isSuccess: false }` —
       * **`isError` never becomes true**, so the error branch constructed in 66 files can never
       * render. Every page sat on its empty-state branch instead, rendering ideas like
       * "0 symbols" as a confident statement about an empty registry. The app's own header showed
       * "Offline" at that same moment.
       *
       * ⇒ With `'always'`, the request is always attempted and **the request itself is the ground
       * truth**: it either returns data or raises an error. Nothing is inferred from a flag that
       * does not track the thing it is being used to mean.
       *
       * ⚠️ `src/utils/networkStatus.js` has a SECOND, different notion of "online" (it probes
       * `/api/health` for real and corrects `navigator.onLine`). That one drives the header badge
       * only and is deliberately NOT wired to `onlineManager`: a probe that fails would pause every
       * query and reproduce exactly this defect. Do not connect them.
       */
      networkMode: 'always',
    },
    mutations: {
      retry: 0,
      // A mutation must never be silently swallowed by an offline guess either — see above.
      networkMode: 'always',
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
