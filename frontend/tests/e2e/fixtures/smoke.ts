/**
 * Helpers for the smoke suite, which runs against the real stack of
 * docker-compose.e2e.yml. The users and rows come from backend/scripts/seed_e2e.py.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API_URL = process.env.SMOKE_API_URL || 'http://localhost:8800';

export const ADMIN = { username: 'e2e-admin', password: process.env.E2E_ADMIN_PASSWORD || 'e2e-admin-pass' };
export const MEMBER = { username: 'e2e-member', password: process.env.E2E_MEMBER_PASSWORD || 'e2e-member-pass' };

export const SEEDED = {
  adminProject: 'E2E Seeded',
  memberProject: 'E2E Member Project',
  runId: 'e2e-seeded-run',
  model: 'e2e-model',
};

/** A name no other run of the suite will have used, for rows a spec creates. */
export const unique = (prefix: string) =>
  `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export async function signInThroughUi(page: Page, user: { username: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
}

export async function tokenFor(request: APIRequestContext, user: { username: string; password: string }): Promise<string> {
  const response = await request.post(`${API_URL}/auth/login`, { form: user });
  expect(response.ok(), `login of ${user.username}`).toBe(true);
  return (await response.json()).access_token as string;
}

/** The REST API as `token`, for setting up and cleaning up around the UI. */
export function api(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: (path: string) => request.get(`${API_URL}${path}`, { headers }),
    post: (path: string, data?: unknown) => request.post(`${API_URL}${path}`, { headers, data }),
    delete: (path: string) => request.delete(`${API_URL}${path}`, { headers }),
  };
}

export async function projectIdByName(request: APIRequestContext, token: string, name: string): Promise<number> {
  const projects = (await (await api(request, token).get('/projects')).json()) as { id: number; name: string }[];
  const found = projects.find((project) => project.name === name);
  expect(found, `project ${name}`).toBeDefined();
  return found!.id;
}
