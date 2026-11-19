# Plan de pruebas E2E

Rama: `feat/e2e-plan` (desde `Feat/pruebas-e2e`, f0a14cf). Este documento es solo el plan; no incluye implementación.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Arquitectura | La descrita en `CLAUDE.md`: dos proyectos Playwright, `mock` y `smoke`. |
| Alcance | Al menos un spec `mock` por ruta. `smoke` cubre solo flujos troncales. |
| Stack smoke | Backend + postgres/redis/minio/mlflow. Sin worker, sin GitHub, sin IA. |
| Seed smoke | Script Python idempotente en el backend (`backend/scripts/seed_e2e.py`). |
| Navegadores | Solo Chromium desktop. |

Fuera de alcance: la ejecución real de pipelines (papermill → MLflow → deploy) y el AI advisor. Ya los cubre pytest en el backend. En la UI se cubren con `mock`.

## Estado actual

- `frontend/playwright.config.ts`: un solo proyecto `chromium` con `baseURL` `localhost:3000`, que depende de un frontend ya levantado.
- Hay 2 specs (`add_repo_and_trigger_pipeline.spec.ts`, `models_predict.spec.ts`) y 4 page objects en `tests/e2e/pages/`.
- Cada spec mockea a mano con `page.route`. No hay sesión, aunque las rutas están protegidas por `AuthContext` (el token vive en `localStorage`). Lo más probable es que esos specs fallen hoy, así que hay que verificarlos en la fase 1.
- No existen `tests/e2e/fixtures/`, `mock/`, `smoke/`, `docker-compose.e2e.yml` ni jobs e2e en `.github/workflows/main.yml`. `CLAUDE.md` ya los documenta como si existieran.

## Fase 1: infraestructura común

1. **`playwright.config.ts`** con dos proyectos:
   - `mock`: `testDir: tests/e2e/mock`, `webServer` Vite en el puerto 3100, `VITE_API_URL=http://localhost:8000`.
   - `smoke`: `testDir: tests/e2e/smoke`, `baseURL` `localhost:3000`, depende de un proyecto `setup` (`auth.setup.ts`) y usa `storageState: playwright/.auth/smoke-admin.json`.
   - `video` desactivado salvo con `E2E_VIDEO=1`, por el canvas WebGL del login.
   - `reporter`: `html` en local; `github` + `html` en CI.
2. **`tests/e2e/fixtures/data.ts`**: builders tipados contra `src/types` (`user()`, `admin()`, `project()`, `repo()`, `pipeline()`, `model()`, `dataset()`, `insight()`, etc.), con overrides parciales.
3. **`tests/e2e/fixtures/api.ts`**: un backend falso.
   - Intercepta `http://localhost:8000/**` y el WebSocket (`page.routeWebSocket`, Playwright ≥ 1.48).
   - `installDefaults(mockApi, me)` registra un handler por endpoint de `src/api/client.ts`.
   - `mockApi.on(method, path, handler)` permite overrides; el último registrado gana.
   - `mockApi.ws(pipelineId).send(msg)` empuja fases al detalle del pipeline.
   - Cualquier request sin handler queda registrado y hace fallar el test en el teardown.
   - `mockApi.calls(method, path)` permite verificar payloads enviados.
4. **`tests/e2e/fixtures/test.ts`**: `test` extendido.
   - Opción `me` (por defecto `admin()`; `null` = visitante). Si hay usuario, inyecta el token en `localStorage` vía `addInitScript` antes de navegar.
   - Fixture `mockApi` automático.
   - Falla ante cualquier `pageerror` o `console.error` no permitido.
5. **Page objects**: `tests/e2e/pages/` se queda como carpeta compartida por `mock` y `smoke`. Crear uno por página nueva solo cuando el spec lo necesite.
6. **Migrar los 2 specs existentes** a `mock/`, quitando los `page.route` manuales.
7. **Scripts npm**: `test:e2e:mock`, `test:e2e:smoke`, `typecheck:e2e` (`tsc -p tests/e2e/tsconfig.json`).

Criterio de terminado: `npm run test:e2e -- --project=mock` pasa con los 2 specs migrados y `typecheck:e2e` queda limpio.

## Fase 2: specs mock por ruta

Cada spec cubre como mínimo: (a) la ruta renderiza con datos, (b) el flujo principal, (c) un error de API visible (4xx/5xx), y (d) permisos (visitante → `/login`; miembro vs admin cuando aplica).

| Spec | Rutas | Flujos clave |
|---|---|---|
| `auth.spec.ts` | `/login`, `/register`, `/set-password`, `/confirm-change`, `/auth/github` | Login ok/err, registro, set password por token, callback de GitHub, redirección del visitante, refresh del token expirado (401 → logout). |
| `public-docs.spec.ts` | `/docs`, `/tech-docs`, `/user-manual` (+ alias `_`), `*` | Renderizan sin sesión; los alias redirigen; 404. |
| `dashboard.spec.ts` | `/` | KPIs, pipelines recientes con su repo, navegación a proyectos. |
| `projects.spec.ts` | `/projects`, `/projects/:id` | Listar, crear, editar, borrar; ajeno → 404. |
| `add-repo.spec.ts` | `/repos/new` | Alta ok, duplicado 409 (migrado). |
| `data-factory.spec.ts` | `/projects/:id/data` | Fuentes, ingesta, recipe de limpieza, capas bronze/silver/gold, definición de gold, diff de capas. |
| `datasets.spec.ts` | `/projects/:id/datasets` | Upload, activar, elegir input medallion (`PUT /repos/{id}/pipeline-input`), limpiar. |
| `pipelines.spec.ts` | `/pipelines` | Lista, filtros, paginación, run manual por rama. |
| `pipeline-canvas.spec.ts` | `/pipelines/canvas/:projectId?`, `/projects/:id/pipeline` | Nodos y panel de nodo con logs en vivo (WS). |
| `pipeline-detail.spec.ts` | `/pipelines/:id` | Fases por WS, celdas, `mounted_input`, métricas, insight IA, "Apply & push" (`apply_status` queued → pushed/failed). |
| `notebook-editor.spec.ts` | `/repos/:repoId/notebook` | Carga, edición, validación de tags `mlops:*`, guardado. |
| `models.spec.ts` | `/models` | Lista, predicción (migrado), versiones, política de deploy, share link. |
| `dashboards.spec.ts` | `/dashboards` | Superset/Grafana embebido (iframe stub), KPI maker. |
| `admin.spec.ts` | `/admin` | Solo admin; el miembro es redirigido o recibe 404. Gestión de usuarios. |
| `account.spec.ts` | `/account`, `/settings` | Perfil, cambio de contraseña, alias de settings. |

Criterio de terminado: toda ruta de `App.tsx` aparece en al menos un spec. Hay que añadir un test meta que lea `App.tsx` y falle si aparece una ruta sin cubrir.

## Fase 3: smoke contra el stack real

1. **`docker-compose.e2e.yml`** (`-p mlops-e2e`): postgres, redis, minio + minio-init, mlflow, backend y frontend. Sin worker, sin GitHub y sin IA (`AI_ADVISOR_PROVIDER` vacío), con puertos propios y volúmenes efímeros.
2. **`backend/scripts/seed_e2e.py`**: corre tras `alembic upgrade head` cuando `E2E_SEED=1`. Es idempotente y crea:
   - `e2e-admin` (admin) y `e2e-member` (miembro).
   - Un proyecto con un repo de URL ficticia y sin webhook.
   - Un `Pipeline` en estado `success` y un `ModelDeployment` para tener datos de lectura.
   Necesita un test pytest propio que lo ejecute dos veces sobre SQLite.
3. **`smoke/auth.setup.ts`**: login por UI como `e2e-admin`, guarda `playwright/.auth/smoke-admin.json` (en `.gitignore`).
4. **Specs smoke** (4-6):
   - `login.smoke.ts`: login/logout reales y error de credenciales.
   - `projects.smoke.ts`: crear, editar y borrar un proyecto contra postgres.
   - `datasets.smoke.ts`: subir un CSV real a MinIO, activarlo y verlo listado.
   - `models.smoke.ts`: listar el modelo sembrado; `/ready` responde.
   - `tenancy.smoke.ts`: `e2e-member` pide el recurso de admin y recibe 404.
   - `health.smoke.ts`: `/health`, `/ready` y el proxy `/grafana` (si está habilitado).
5. Cada spec crea sus propios datos con prefijo único y los limpia, para no depender del orden.

## Fase 4: CI

En `.github/workflows/main.yml`, sobre los PR a `dev`:
- `test-e2e-mock`: `npm ci`, `npx playwright install --with-deps chromium`, `npm run typecheck:e2e`, `npm run test:e2e:mock`. Sube `playwright-report` como artefacto.
- `test-e2e-smoke`: `docker compose -f docker-compose.e2e.yml -p mlops-e2e up -d --build --wait`, `npm run test:e2e:smoke`, logs del compose y el reporte si falla, y `down -v` siempre.
- Ambos jobs son requeridos para hacer merge. `retries: 2` solo en CI.

## Riesgos

- **Drift entre el mock y el backend real.** Mitigación: los builders tipados contra `src/types`, el fallo ante endpoints no mockeados y smoke sobre los flujos troncales.
- **Tests flaky por carreras de red.** Mitigación: el override con `mockApi.on` va solo después de que la página renderiza; se esperan elementos, nunca timeouts fijos.
- **Canvas WebGL del login.** Mitigación: video desactivado y una opción para desactivar la animación si `navigator.webdriver`.
- **Tiempo de CI.** El job smoke depende del build de imágenes. Mitigación: cache de Docker layers con `docker/build-push-action` + `cache-from: gha`.

## Orden de entrega sugerido

1. Fase 1 (desbloquea todo lo demás).
2. Fase 2 por bloques: auth/públicas → proyectos/repos → data factory/datasets → pipelines → models/dashboards → admin/account.
3. Fase 3.
4. Fase 4.

Cada bloque es un PR pequeño contra `Feat/pruebas-e2e`.
