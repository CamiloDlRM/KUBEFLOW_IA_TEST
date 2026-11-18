/**
 * Where the real stack is and who signs in to it. The defaults match
 * docker-compose.e2e.yml, so a local run needs no variables at all.
 */
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { APIRequestContext } from '@playwright/test';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000';
export const ADMIN = {
  username: process.env.E2E_ADMIN_USERNAME ?? 'e2e-admin',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password',
};

/** The signed-in browser state the setup project saves and every smoke test reuses. */
export const STORAGE_STATE = fileURLToPath(new URL('../../../playwright/.auth/smoke-admin.json', import.meta.url));

const TOKEN_KEY = 'mlops_token';

/** The JWT the setup sign-in left in localStorage, for API calls made around the UI. */
export function savedToken(): string {
  const state = JSON.parse(fs.readFileSync(STORAGE_STATE, 'utf-8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  for (const origin of state.origins) {
    const entry = origin.localStorage.find((item) => item.name === TOKEN_KEY);
    if (entry) return entry.value;
  }
  throw new Error(`No ${TOKEN_KEY} in ${STORAGE_STATE}: did the smoke-setup project run?`);
}

/** An authenticated call to the real API, for setup and cleanup that has no UI. */
export async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  urlPath: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`${API_URL}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${savedToken()}` },
    data,
  });
  if (!response.ok()) {
    throw new Error(`${method} ${urlPath} → ${response.status()}: ${await response.text()}`);
  }
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

/** A name no earlier run left behind, so runs never trip over each other's data. */
export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}
