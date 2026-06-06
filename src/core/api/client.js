import { env } from '../config/env';

const baseUrl = env.VITE_API_BASE_URL.replace(/\/$/, '');

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
  const response = await fetch(apiUrl(path));
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json();
}
