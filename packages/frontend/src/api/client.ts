import { ApiRequestError } from './errors';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const AUTH_TOKEN_KEY = 'singbox_meta_token';

export function getApiBase() {
  return API_BASE;
}

export function getAuthToken() {
  return sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function setAuthToken(token: string) {
  sessionStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

export function hasAuthToken() {
  return Boolean(getAuthToken());
}

export async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getAuthToken();

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const rawText = await res.text();
    let message = `请求失败 (${res.status})`;
    let code = 'HTTP_ERROR';

    if (rawText) {
      try {
        const payload = JSON.parse(rawText);
        if (payload?.error?.message) message = payload.error.message;
        if (payload?.error?.code) code = payload.error.code;
      } catch {
        message = rawText;
      }
    }

    throw new ApiRequestError({
      status: res.status,
      message,
      code,
      details: rawText || message
    });
  }
  return res;
}
