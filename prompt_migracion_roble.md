# Prompt: Migración completa de SQLite/SQLModel a ROBLE REST API

## Contexto del proyecto

Este es un backend FastAPI para una plataforma MLOps que automatiza pipelines de ML. Actualmente usa **SQLite + SQLModel (ORM)** para persistencia. Necesito migrar **completamente** a **ROBLE**, una plataforma de base de datos administrada via API REST con PostgreSQL detrás. Después de la migración, SQLModel, SQLAlchemy y SQLite deben ser eliminados del proyecto.

## Qué es ROBLE

ROBLE es una plataforma que provee base de datos administrada via API REST. No requiere configurar servidores propios. Usa JWT para autenticación.

### URLs Base
- **Autenticación:** `https://roble-api.openlab.uninorte.edu.co/auth/:mlops_platform_1d2a289c51`
- **Base de datos:** `https://roble-api.openlab.uninorte.edu.co/database/:mlops_platform_1d2a289c51`

### Autenticación
Todos los endpoints de la API de database requieren un JWT (`accessToken`) en el header `Authorization: Bearer <accessToken>`.

| Endpoint | Método | Descripción |
|---|---|---|
| `/auth/:mlops_platform_1d2a289c51/login` | POST | Login con `{ email, password }`. Retorna `{ accessToken, refreshToken }` |
| `/auth/:mlops_platform_1d2a289c51/refresh-token` | POST | Renueva accessToken usando `{ refreshToken }` |
| `/auth/:mlops_platform_1d2a289c51/verify-token` | GET | Verifica si el accessToken es válido (requiere Bearer token) |

### Gestión de Tablas
Todos requieren `Authorization: Bearer <accessToken>`.

| Endpoint | Método | Descripción |
|---|---|---|
| `/database/:mlops_platform_1d2a289c51/create-table` | POST | Crea una tabla. Body: `{ tableName, description, columns[] }` |
| `/database/:mlops_platform_1d2a289c51/table-data?schema=public&table=X` | GET | Lee columnas y filas de una tabla |
| `/database/:mlops_platform_1d2a289c51/add-column` | POST | Agrega columna. Body: `{ tableName, column }` |
| `/database/:mlops_platform_1d2a289c51/drop-column` | POST | Elimina columna. Body: `{ tableName, columnName }` |
| `/database/:mlops_platform_1d2a289c51/delete-table/:tableName` | DELETE | Elimina tabla completamente |

**Nota importante:** Cada tabla recibe automáticamente una columna `_id` (VARCHAR(12)) como identificador único autogenerado. No se puede definir manualmente. Si no se define otra clave primaria, `_id` es la PK por defecto.

### CRUD de registros
| Endpoint | Método | Descripción |
|---|---|---|
| `/database/:mlops_platform_1d2a289c51/insert` | POST | Inserta registros. Body: `{ tableName, records[] }` |
| `/database/:mlops_platform_1d2a289c51/read?tableName=X&campo=valor` | GET | Consulta registros con filtros opcionales via query params |
| `/database/:mlops_platform_1d2a289c51/update` | PUT | Actualiza registro. Body: `{ tableName, idColumn, idValue, updates }` |
| `/database/:mlops_platform_1d2a289c51/delete` | DELETE | Elimina registro. Body: `{ tableName, idColumn, idValue }` |

### Tipos de datos SQL disponibles en ROBLE
| Tipo ROBLE | SQL Type |
|---|---|
| int4 | INTEGER |
| int8 | BIGINT |
| float8 | DOUBLE PRECISION |
| text | TEXT |
| varchar | VARCHAR |
| bool | BOOLEAN |
| json | JSON |
| jsonb | JSONB |
| timestamp | TIMESTAMP |
| timestamptz | TIMESTAMP WITH TIME ZONE |

---

## Estado actual del código (lo que hay que migrar)

### Modelos actuales en `backend/models/schemas.py`

Hay 3 tablas SQLModel:

**1. `repositories`** — Repositorios de GitHub registrados
```
id: int (PK, autoincrement)
github_url: str (indexed)
github_token_masked: str (default "")
branch: str (default "main")
notebook_path: str
webhook_id: int | None
webhook_url: str | None
created_at: datetime (UTC)
is_active: bool (default True)
```

**2. `pipelines`** — Ejecuciones de pipeline
```
id: str (PK, UUID generado con uuid4)
repo_id: int (FK -> repositories.id)
status: str (default "queued")  — valores: queued | running | success | failed
commit_sha: str (default "")
started_at: datetime | None
finished_at: datetime | None
phases: list[dict] (columna JSON)
metrics: dict (columna JSON)
```

**3. `model_deployments`** — Modelos desplegados
```
id: int (PK, autoincrement)
model_name: str (indexed)
version: str (default "1")
accuracy: float (default 0.0)
endpoint_url: str (default "")
deployed_at: datetime (UTC)
is_active: bool (default True)
pipeline_id: str | None (FK -> pipelines.id)
```

### Archivos que usan la base de datos directamente

1. **`backend/main.py`** (líneas 70-81) — Lifespan crea tablas con `SQLModel.metadata.create_all(engine)`.
2. **`backend/routers/repos.py`** — Funciones `_get_session()`, y endpoints que hacen `session.add()`, `session.commit()`, `session.exec(select(...))`, `session.get()`, `session.delete()`.
3. **`backend/routers/pipelines.py`** — Mismo patrón: `_get_session()`, queries con `select()`, `func.count()`, paginación con `offset/limit`.
4. **`backend/routers/models.py`** — Mismo patrón: queries por `model_name`, `is_active`, updates de flags.
5. **`backend/routers/webhook.py`** — Queries de búsqueda por `github_url`, creación de Pipeline, deduplicación.
6. **`backend/tasks/celery_tasks.py`** — Función `_update_pipeline_db()` que crea su propio engine y session para actualizar pipelines desde el worker Celery. También en `run_pipeline()` hay queries directas a Repository y ModelDeployment.

### Dependencias a eliminar
En `backend/requirements.txt`: `sqlmodel==0.0.22` debe eliminarse.

---

## Mapeo de tablas a ROBLE

Crea las siguientes 3 tablas en ROBLE. Recuerda que ROBLE autogenera `_id` (VARCHAR(12)) para cada tabla.

### Tabla: `repositories`
| Columna | Tipo ROBLE | Notas |
|---|---|---|
| _(ROBLE genera `_id` automáticamente)_ | | Usar este `_id` como identificador en vez del int autoincrement |
| github_url | text | |
| github_token_masked | varchar | default "" |
| branch | varchar | default "main" |
| notebook_path | text | |
| webhook_id | int4 | nullable |
| webhook_url | text | nullable |
| created_at | timestamptz | generado al insertar |
| is_active | bool | default true |

### Tabla: `pipelines`
| Columna | Tipo ROBLE | Notas |
|---|---|---|
| _(ROBLE genera `_id` automáticamente)_ | | Usar este `_id` como PK. Reemplaza el UUID actual. |
| pipeline_uuid | varchar | UUID generado por el backend para compatibilidad con Celery task_id |
| repo_id | varchar | Antes era int FK, ahora es el `_id` string del repo en ROBLE |
| status | varchar | queued / running / success / failed |
| commit_sha | varchar | |
| started_at | timestamptz | nullable |
| finished_at | timestamptz | nullable |
| phases | jsonb | array de objetos de fase |
| metrics | jsonb | métricas del pipeline |

**Nota importante sobre `pipeline_uuid`:** Actualmente el pipeline `id` es un UUID que también se usa como `task_id` de Celery (`run_pipeline.apply_async(..., task_id=pipeline_id)`). Después de la migración, el `_id` de ROBLE será el identificador en la base de datos, pero necesitamos mantener un `pipeline_uuid` separado que se use como task_id de Celery y para el pub/sub de Redis. Alternativamente, se puede seguir generando un UUID antes de insertar y guardarlo en `pipeline_uuid`, usando ese valor para Celery y WebSockets.

### Tabla: `model_deployments`
| Columna | Tipo ROBLE | Notas |
|---|---|---|
| _(ROBLE genera `_id` automáticamente)_ | | |
| model_name | varchar | |
| version | varchar | default "1" |
| accuracy | float8 | default 0.0 |
| endpoint_url | text | |
| deployed_at | timestamptz | |
| is_active | bool | default true |
| pipeline_id | varchar | referencia al `_id` o `pipeline_uuid` del pipeline |

---

## Instrucciones de implementación

### Paso 1: Crear el cliente ROBLE (`backend/core/roble_client.py`)

Crea un módulo nuevo que encapsule toda la comunicación con ROBLE:

```
class RobleClient:
    def __init__(self, auth_base_url, db_base_url, email, password):
        # Almacena configuración
        # self._access_token = None
        # self._refresh_token = None

    async def _ensure_authenticated(self):
        # Si no hay token o está expirado, hacer login
        # Si el token existe, verificarlo con verify-token
        # Si falla verificación, intentar refresh-token
        # Si falla refresh, hacer login de nuevo

    async def _request(self, method, url, **kwargs):
        # Wrapper que agrega Authorization header
        # Si recibe 401, intenta refresh y reintenta una vez

    # --- Operaciones de tabla ---
    async def create_table(self, table_name, description, columns):
    async def table_exists(self, table_name) -> bool:
        # Intenta GET table-data, si 404 o error -> no existe

    # --- CRUD ---
    async def insert(self, table_name, records: list[dict]) -> list[dict]:
    async def read(self, table_name, filters: dict = None) -> list[dict]:
    async def read_one(self, table_name, id_column, id_value) -> dict | None:
    async def update(self, table_name, id_column, id_value, updates: dict):
    async def delete(self, table_name, id_column, id_value):

    # --- Helpers de consulta ---
    async def read_paginated(self, table_name, page, size, order_by=None) -> tuple[list[dict], int]:
        # ROBLE no tiene paginación nativa, así que:
        # Lee todos los registros, ordénalos en Python, aplica offset/limit
        # Retorna (items, total_count)
```

**Importante sobre el cliente síncrono para Celery:**
El worker Celery ejecuta código síncrono (no async). Necesitas una versión síncrona del cliente o un wrapper que use `httpx.Client` (síncrono) en vez de `httpx.AsyncClient`. Opciones:
- Crear `RobleClientSync` con `httpx.Client` para Celery.
- O usar `asyncio.run()` dentro del worker (menos limpio pero funcional).

Recomendación: crea ambas versiones, `RobleClient` (async con httpx.AsyncClient) para FastAPI y `RobleClientSync` (sync con httpx.Client) para Celery.

### Paso 2: Configuración (`backend/core/config.py`)

Agrega estas variables al `AppSettings`:

```python
# --- ROBLE Database ---
roble_auth_url: str = Field(
    default="https://roble-api.openlab.uninorte.edu.co/auth/:mlops_platform_1d2a289c51",
    description="URL base de autenticación de ROBLE.",
)
roble_db_url: str = Field(
    default="https://roble-api.openlab.uninorte.edu.co/database/:mlops_platform_1d2a289c51",
    description="URL base de la API de database de ROBLE.",
)
roble_email: str = Field(
    default="",
    description="Email para autenticación en ROBLE.",
)
roble_password: str = Field(
    default="",
    description="Password para autenticación en ROBLE.",
)
```

**Elimina** el campo `database_url` que apunta a SQLite.

### Paso 3: Inicialización de tablas (`backend/main.py`)

Reemplaza el lifespan actual:

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # 1. Crear instancia de RobleClient
    # 2. Autenticarse con login
    # 3. Para cada tabla (repositories, pipelines, model_deployments):
    #    - Verificar si existe (table_exists)
    #    - Si no existe, crearla con create_table y las columnas definidas
    # 4. Guardar el client en app.state para que los routers lo usen
    app.state.roble = client
    logger.info("app.startup", roble="connected")
    yield
    logger.info("app.shutdown")
```

### Paso 4: Dependency injection para routers

Reemplaza todas las funciones `_get_session()` en los 4 routers con:

```python
from fastapi import Request

def get_roble(request: Request) -> RobleClient:
    return request.app.state.roble
```

### Paso 5: Migrar cada router

#### `backend/routers/repos.py`
- `create_repo`: Cambiar `session.add(repo)` + `session.commit()` por `await roble.insert("repositories", [{ ... }])`. El `_id` lo genera ROBLE, así que hay que leer la respuesta del insert para obtenerlo.
- `list_repos`: Cambiar `session.exec(select(Repository))` por `await roble.read("repositories")`.
- `delete_repo`: Cambiar `session.delete(repo)` por `await roble.delete("repositories", "_id", repo_id)`. Nota: `repo_id` ahora es un string (el `_id` de ROBLE), no un int.

#### `backend/routers/pipelines.py`
- `list_pipelines`: Usar `roble.read_paginated("pipelines", page, size)`. Ordenar por `started_at` descendente en Python.
- `get_pipeline`: Usar `roble.read_one("pipelines", "_id", pipeline_id)`.
- `get_pipeline_logs`: Misma lógica de Redis, solo cambia la verificación de existencia del pipeline.
- `ws_pipeline_logs`: Sin cambios (usa Redis, no la DB).

#### `backend/routers/models.py`
- `list_models`: `roble.read("model_deployments", {"is_active": "true"})`.
- `predict`: Sin cambios significativos (llama al model-server, no a la DB).
- `rollback_model`: Buscar deployment por `model_name` y `version`, actualizar flags `is_active`.
- `delete_model`: Actualizar `is_active` a false.

#### `backend/routers/webhook.py`
- Buscar repo por `github_url`: `roble.read("repositories", {"github_url": repo_url})`.
- Crear pipeline: `roble.insert("pipelines", [{ ... }])`.
- Deduplicación: Leer pipelines filtrados y verificar en Python.

#### `backend/tasks/celery_tasks.py`
- `_update_pipeline_db`: Usar `RobleClientSync` en vez de SQLModel Session.
- `run_pipeline`: Reemplazar todas las queries SQLModel:
  - Leer repo: `roble_sync.read_one("repositories", "_id", repo_id)`
  - Actualizar pipeline: `roble_sync.update("pipelines", "_id", pipeline_id, updates)`
  - Insertar deployment: `roble_sync.insert("model_deployments", [{ ... }])`
  - Desactivar deployments previos: Leer activos, luego actualizar cada uno.

### Paso 6: Actualizar schemas (`backend/models/schemas.py`)

- **Elimina** las clases `Repository`, `Pipeline`, `ModelDeployment` que heredan de `SQLModel` con `table=True`.
- **Mantén** las clases de request/response (BaseModel) que ya existen.
- Actualiza `RepoResponse` para que `id` sea `str` (antes `int`), ya que ROBLE usa `_id` string.
- Actualiza `PipelineResponse` para que `repo_id` sea `str` (antes `int`).
- Agrega funciones helper para convertir dicts de ROBLE a los response schemas:
  ```python
  def repo_from_roble(data: dict) -> RepoResponse:
      return RepoResponse(
          id=data["_id"],
          github_url=data["github_url"],
          # ... mapear campos
      )
  ```

### Paso 7: Actualizar tipos del frontend

En `frontend/src/types/index.ts`, cambia:
- `Repository.id`: de `number` a `string`
- `Pipeline.repo_id`: de `number` a `string`

En `frontend/src/api/client.ts`, cambia `deleteRepo(repoId: number)` a `deleteRepo(repoId: string)`.

En `frontend/src/pages/Dashboard.tsx`, revisa las comparaciones `r.id === p.repo_id` que antes eran number === number y ahora serán string === string (debería funcionar igual).

### Paso 8: Limpieza

- **Elimina** `sqlmodel` de `backend/requirements.txt`.
- **Elimina** el campo `DATABASE_URL` del `.env` y `.env.example`.
- **Agrega** al `.env`:
  ```
  ROBLE_AUTH_URL=https://roble-api.openlab.uninorte.edu.co/auth/:mlops_platform_1d2a289c51
  ROBLE_DB_URL=https://roble-api.openlab.uninorte.edu.co/database/:mlops_platform_1d2a289c51
  ROBLE_EMAIL=<email_del_usuario>
  ROBLE_PASSWORD=<password_del_usuario>
  ```
- **Elimina** el volumen `mlops-db` de `docker-compose.yml` y la variable `DATABASE_URL` del environment del backend y worker.
- **Actualiza** los tests en `backend/tests/` para mockear `RobleClient` en vez de usar sessions SQLite.

### Paso 9: Actualizar `docker-compose.yml`

- Elimina la variable `DATABASE_URL=sqlite:////data/mlops.db` de los servicios `backend` y `worker`.
- Elimina el volumen `mlops-db` del servicio backend y worker.
- Elimina la declaración del volumen `mlops-db` al final del archivo.
- Agrega variables ROBLE al `env_file` (ya están en `.env`).
- Agrega `dns: 8.8.8.8` al worker si no lo tiene (necesita resolver el dominio de ROBLE).

---

## Consideraciones críticas

1. **Los `_id` de ROBLE son VARCHAR(12) autogenerados.** No puedes predecir el valor antes del insert. El flujo cambia de "creo el objeto con ID → lo guardo" a "lo guardo → ROBLE me da el ID".

2. **Celery task_id:** Actualmente se usa `pipeline.id` (UUID) como `task_id` de Celery. Como ROBLE genera su propio `_id`, necesitas generar un UUID aparte (`pipeline_uuid`), insertarlo como campo en la tabla, y usarlo como task_id de Celery y para Redis pub/sub. Ejemplo:
   ```python
   pipeline_uuid = str(uuid.uuid4())
   result = await roble.insert("pipelines", [{
       "pipeline_uuid": pipeline_uuid,
       "repo_id": repo_id,
       "status": "queued",
       "commit_sha": commit_sha,
   }])
   pipeline_roble_id = result[0]["_id"]  # el _id de ROBLE
   # Usar pipeline_uuid para Celery y WebSocket
   runner.run(pipeline_uuid, repo_id, commit_sha)
   ```

3. **ROBLE no tiene JOINs ni queries complejas.** Las foreign keys son conceptuales. Para cosas como "buscar el pipeline por repo_id", usas filtros en query params: `roble.read("pipelines", {"repo_id": "abc123"})`.

4. **ROBLE no tiene paginación nativa ni ORDER BY.** La paginación y ordenamiento deben hacerse en Python después de leer los datos. Para tablas grandes, esto puede ser un problema. Por ahora es aceptable dado el tamaño esperado del dataset.

5. **Manejo de tokens JWT:** El access token expira. El cliente ROBLE debe manejar refresh automático. Implementa retry con refresh en el wrapper `_request()`.

6. **Concurrencia en Celery:** Múltiples workers pueden estar autenticándose simultáneamente. Considera compartir el token via Redis para evitar múltiples logins, o simplemente deja que cada worker maneje su propio token.

7. **No cambies la lógica de Redis** para logs de pipeline ni la comunicación WebSocket. Eso sigue igual.

8. **No cambies nada del model-server** (`model-server/server.py`). Ese servicio no usa la base de datos.
