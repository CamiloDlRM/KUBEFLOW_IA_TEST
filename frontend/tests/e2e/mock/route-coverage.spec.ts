/**
 * Every route in App.tsx has a mock spec that visits it.
 *
 * Adding a route without a spec fails here: add the route to COVERED with the
 * spec that exercises it. The spec must mention the route's static prefix
 * (`/projects/` for `/projects/:projectId/data`), which is what a visit does.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const COVERED: Record<string, string> = {
  '/login': 'auth.spec.ts',
  '/register': 'auth.spec.ts',
  '/confirm-change': 'auth.spec.ts',
  '/auth/github': 'auth.spec.ts',
  '/set-password': 'auth.spec.ts',
  '/user-manual': 'public-pages.spec.ts',
  '/user_manual': 'public-pages.spec.ts',
  '/docs': 'public-pages.spec.ts',
  '/tech-docs': 'public-pages.spec.ts',
  '/tech_docs': 'public-pages.spec.ts',
  '*': 'public-pages.spec.ts',
  '/': 'dashboard.spec.ts',
  '/dashboards': 'dashboard.spec.ts',
  '/repos/:repoId/notebook': 'notebook-editor.spec.ts',
  '/repos/new': 'projects.spec.ts',
  '/projects': 'projects.spec.ts',
  '/projects/:projectId': 'projects.spec.ts',
  '/projects/:projectId/pipeline': 'projects.spec.ts',
  '/projects/:projectId/data': 'data-factory.spec.ts',
  '/projects/:projectId/datasets': 'data-factory.spec.ts',
  '/pipelines': 'pipelines.spec.ts',
  '/pipelines/:id': 'pipelines.spec.ts',
  '/pipelines/canvas/:projectId?': 'pipeline-canvas.spec.ts',
  '/models': 'models.spec.ts',
  '/admin': 'account-admin.spec.ts',
  '/account': 'account-admin.spec.ts',
  '/settings': 'account-admin.spec.ts',
};

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..', '..', '..');
const routes = [...readFileSync(join(FRONTEND, 'src', 'App.tsx'), 'utf8').matchAll(/path="([^"]+)"/g)].map(
  (match) => match[1],
);

test('every route in App.tsx is listed', () => {
  expect(routes.length).toBeGreaterThan(0);
  expect(routes.filter((route) => !(route in COVERED)), 'routes with no spec in COVERED').toEqual([]);
  expect(Object.keys(COVERED).filter((route) => !routes.includes(route)), 'COVERED routes no longer in App.tsx').toEqual([]);
});

for (const [route, spec] of Object.entries(COVERED)) {
  test(`${route} is visited by ${spec}`, () => {
    const file = join(HERE, spec);
    expect(existsSync(file), `${spec} exists`).toBe(true);
    if (route === '*' || route === '/') return;
    const prefix = route.split('/:')[0];
    expect(readFileSync(file, 'utf8'), `${spec} mentions ${prefix}`).toContain(prefix);
  });
}
