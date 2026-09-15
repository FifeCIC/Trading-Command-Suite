import { env } from '../config/env';

const baseUrl = env.VITE_API_BASE_URL.replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 28_000; // just below the 30s server timeout

/** Fetch with timeout — prevents "Loading..." from sticking forever */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      // Surface the server's own message instead of a bare status code.
      // Nest errors are { message, error, statusCode } — business-rule
      // 400s (market closed, duplicate, diversification…) carry the reason
      // in `message` and were previously discarded here.
      let detail = '';
      let payload = null;
      try {
        payload = await res.json();
        const msg = payload?.message ?? payload?.error;
        if (typeof msg === 'string') detail = `: ${msg}`;
        else if (Array.isArray(msg)) detail = `: ${msg.join('; ')}`;
      } catch { /* non-JSON error body — keep the bare status */ }
      const err = new Error(`Request failed with ${res.status}${detail}`);
      err.status = res.status;
      // ── Structured facts for the notice registry (#826 Phase 2) ──────────
      // The message above stays exactly as it was so nothing that reads it breaks. These extra
      // fields mean a caller can render `notice(code, params)` instead of showing prose, and can
      // quote the server's own wording as the CAUSE rather than re-parsing it out of the message.
      // `code`/`params` are picked up if the server ever sends them — that is #826 Phase 1.
      err.detail = detail.replace(/^: /, '');
      if (typeof payload?.code === 'string') err.code = payload.code;
      if (payload?.params && typeof payload.params === 'object') err.params = payload.params;
      throw err;
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout = new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
      // Marked so noticeFromError() can map it to its own code — an abandoned request has no
      // HTTP status, and reporting one would be a fabrication.
      timeout.timedOut = true;
      timeout.timeoutSeconds = DEFAULT_TIMEOUT_MS / 1000;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function apiUrl(path = '') {
  if (!path) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiGet(path) {
  return fetchWithTimeout(apiUrl(path));
}

export async function apiPost(path, body) {
  return fetchWithTimeout(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiPatch(path, body) {
  return fetchWithTimeout(apiUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiPut(path, body) {
  return fetchWithTimeout(apiUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiDelete(path) {
  return fetchWithTimeout(apiUrl(path), { method: 'DELETE' });
}
