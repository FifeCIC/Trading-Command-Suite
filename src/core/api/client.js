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
      throw new Error(`Request failed with ${res.status}`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
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
