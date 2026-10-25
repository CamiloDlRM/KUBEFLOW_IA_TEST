# Superset, and its MCP server

Two containers from one image:

| Service | Command | Port | What it is |
|---|---|---|---|
| `superset` | `bootstrap.sh web` | 8088 (published) | The UI a person uses |
| `superset-mcp` | `bootstrap.sh mcp` | 5008 (internal) | What the agent talks to |

Superset ships the MCP server inside its own CLI, so there is no separate MCP
image to pull: it is `apache/superset` run with a different command. They share
`superset_config.py`, the metadata database and the Superset home volume,
because the MCP server resolves users against Superset's own `ab_user` table —
a config that drifted between the two would give the agent a different Superset
from the one a person sees.

## Where the dashboard's data comes from

**From the built gold object, not from re-running the gold definition.**

This is the decision the rest of the design hangs off, so it is worth being
explicit about. "Gold" in this platform is already the result of a query: one
SQL definition, run by DuckDB over the silver Parquet, written out as a
versioned object — `s3://gold/project-4/gold/v0002.parquet`. There are two
things Superset could point at, and they are not the same thing:

- **Re-run the definition.** Superset would hold the gold SQL as a virtual
  dataset and execute it against silver on every refresh.
- **Read the build.** Superset points at the object the platform already wrote.

The second is right, for three reasons.

**Silver accumulates.** Every extraction adds rows to it. Re-running the
definition at three o'clock returns numbers that belong to no gold version at
all — not the one the last pipeline trained on, not the one the next will. The
dashboard and the model would quietly disagree, and the disagreement would be
invisible until someone tried to reconcile two reports.

**A build is the unit that can be audited.** `v0002` is a fixed set of rows. A
chart over it can be reproduced next month. A chart over "whatever the
definition returns today" cannot be, and a thesis defence is exactly the
setting where someone asks where a number came from.

**Gold is the pre-computed answer.** Re-deriving it per chart, per refresh,
repeats a full scan and join over silver to arrive back at a file that already
exists.

One clarification, because "query" is doing double duty in the question: the
charts still run SQL. A bar chart over gold issues its own `GROUP BY`, and that
is exactly as it should be. What must not happen is Superset re-executing the
*gold definition* — the definition is upstream and frozen at build time, and
Superset's own aggregations run on top of what it produced.

### Which build

Pointing at `v0002.parquet` by name pins the dashboard to that build: stable,
reproducible, and stale the moment a new one lands. Pointing at the newest
object instead tracks the project but makes "which rows was this chart showing"
unanswerable after the fact.

Both are defensible and they want different things. The intended answer is a
DuckDB view per project that resolves to the newest build, refreshed when
`rebuild_gold` writes one, with the version it resolved to recorded alongside
the dashboard so the question stays answerable. That is not built yet — see
*What is not here*.

## Bringing it up

```bash
docker compose up -d superset-db superset superset-mcp
```

The first start migrates Superset's metadata database, seeds the admin user
from `SUPERSET_ADMIN_*`, and runs `superset init`; expect it to take a minute
or two. Then <http://localhost:8088>.

### The gold connection is made for you

`bootstrap.sh web` runs `provision.py` on every start, which registers a
database called **Gold (DuckDB)** — or updates it, if it is already there. It
has to be done at startup because there is no MCP tool for creating a
connection: the agent can build datasets on a database, not make one, so
without this it meets a Superset with nothing to chart.

It is DuckDB in memory, with `httpfs` reaching MinIO, configured from the
container's own MinIO credentials. It holds no data and no views. A dataset on
it is `SELECT * FROM read_parquet('s3://gold/...')`, which reads the built gold
object directly — the agent is told the exact path with the schema.

`extension_directory` in its settings is not optional. `httpfs` is baked into
the image at `/app/duckdb_extensions` rather than under `$HOME`, because
`$HOME` is `/app/superset_home` and compose mounts a volume there — anything
baked underneath it would be hidden the moment the container starts.

### Verify it can read gold

Worth doing before blaming the agent, because it exercises the one part that is
new: DuckDB reaching MinIO. In **SQL Lab**, pick **Gold (DuckDB)** and run,
against a project that has a gold build:

```sql
SELECT count(*) FROM read_parquet('s3://gold/project-4/gold/v0002.parquet');
```

If that returns a row count, the hard part works and everything else is
Superset being Superset. If it fails, the useful distinction is *whether it is
the extension or the credentials*: `SELECT * FROM duckdb_extensions()` says
whether `httpfs` loaded at all.

## What is likely to bite

**The MCP container.** The MCP service is young. Running it in Docker has a
known failure mode — the container restart-loops with `No application found.
Either work inside a view function or push an application context`, because the
service starts outside Flask's normal lifecycle. The fix people have landed on
is a wrapper that creates the app and pushes its context before starting the
server. `bootstrap.sh` runs the documented command first; if you see that
error, that is what it is, and it is a small wrapper rather than a redesign.

**The image ships almost nothing optional.** Three things had to be added, and
each one failed in a different place:

| Missing | Where it showed up |
|---|---|
| `psycopg2` | `superset db upgrade` cannot open Superset's *own* metadata database. Drivers were dropped from the image in 4.1.0. |
| `duckdb`, `duckdb-engine` | No way to read the gold Parquet. |
| the `fastmcp` extra | `superset mcp run` prints *"fastmcp is not installed, skipping MCP initialization"* and exits — so the MCP container dies instantly and the agent meets a refused connection. |

The `fastmcp` extra is asked for as `apache-superset[fastmcp]==<installed
version>`, not as a bare `fastmcp`. The extra carries Superset's own constraint
on which fastmcp its MCP code was written against; a bare install takes the
newest, which is how you get a server that starts and then disagrees with its
own host about a schema. Naming the version already installed means the
resolver treats apache-superset as satisfied and adds only what the extra pulls
in.

**The driver versions are unpinned.** `duckdb` and `duckdb-engine` have never
been resolved against this base image here. A pin invented without running it
is a broken build rather than a reproducible one — pin them from the version
the build prints, once it has printed one.

**`pip install` is the wrong command in this image**, and it fails quietly.
Superset 6 builds its environment with `uv venv /app/.venv`, which does not put
pip inside the venv, so a plain `pip install` resolves up `PATH` to the *system*
interpreter, installs into system site-packages, and exits 0 — while the venv
that actually runs Superset never sees the package. The Dockerfile installs
with `uv pip install --python /app/.venv/bin/python` and imports what it just
installed in the same layer, so a wrong-environment install fails there rather
than at runtime.

**The MCP server authenticates as one fixed user.** `MCP_DEV_USERNAME` is the
documented development mode: anything that can reach port 5008 gets that user's
permissions, with no token. That is why the port is not published. Before it is
reachable from anywhere else it has to become the JWT mode.

## The agent

`POST /projects/{id}/dashboard` with `{"prompt": "..."}` hands the request and
gold's schema to Gemini, gives it Superset's tools, and lets it build.

Three pieces, all in the backend:

- `core/mcp.py` — an MCP client. JSON-RPC over HTTP, the handshake, `tools/list`
  and `tools/call`, and nothing else.
- `core/superset_agent.py` — the loop. MCP tool schemas are translated into
  Gemini function declarations, the model is told what gold holds rather than
  left to discover it, and it runs until the model stops asking for tools or
  hits `MAX_TURNS`.
- The endpoint, which finds the project's built gold object, reads its schema
  from the Parquet, and returns both what the model said and every tool call it
  made — so a dashboard that came out wrong can be read as the sequence that
  produced it, rather than inferred from the model's own account of itself.

It runs synchronously and can take minutes. That is the wrong shape for an HTTP
request and it should move onto the Celery queue the way the pipeline analysis
did; that is a change to how it is called, not to what it does.

## Seeing the dashboard inside the platform

The KPI maker shows the dashboard it built above the conversation, through
Superset's own embedding SDK rather than a bare iframe. A bare iframe would
need the user signed in to Superset in the same browser, and would hand them
all of Superset rather than one dashboard.

```
KPI maker ──GET /projects/{id}/dashboard/embed──▶ backend
                                                  ├ the dashboard id, read from the agent's tool calls
                                                  ├ embedding switched on in Superset → its UUID
                                                  └ a guest token signed for that one dashboard
          ◀── { uuid, token, superset_domain } ──
          └ embedDashboard() → iframe
```

The guest token is signed by the backend with `SUPERSET_GUEST_TOKEN_SECRET`,
which Superset verifies against the same variable. It names one dashboard and
lives five minutes; the SDK asks for a fresh one before it runs out. No
Superset credential ever reaches the browser. The backend does hold the admin
login, inside the compose network, and uses it for one thing: switching
embedding on for a dashboard, once.

**In production `SUPERSET_PUBLIC_URL` has to be a real address.** The iframe
loads from the user's browser, so `http://localhost:8088` only works on the
machine running compose. And the app is served over HTTPS, which a browser
will not let frame a page served over HTTP — so Superset needs its own route
through the reverse proxy, behind TLS, before this works for anyone else.

Left at the default, the KPI maker says so instead of showing a blank frame.
On the production server, behind the Cloudflare tunnel:

1. Add a public hostname to the tunnel: `superset.kubeflowia.site` →
   `http://localhost:8088` (or `http://superset:8088` if `cloudflared` runs
   inside the compose network).
2. In the server's `.env`: `SUPERSET_PUBLIC_URL=https://superset.kubeflowia.site`.
3. `docker compose up -d backend superset` — the backend to read the new
   address, Superset for `ENABLE_PROXY_FIX`, which makes it trust the
   `X-Forwarded-Proto` Cloudflare sends instead of building `http://` links.

That publishes Superset's login page to the internet, so the admin password
in `SUPERSET_ADMIN_PASSWORD` has to be a real one first.

## What is not here

- The DuckDB view per project, and refreshing it when `rebuild_gold` writes a
  new build. Today the model is told the object's path and has to point Superset
  at it.
- Any UI. The endpoint exists; nothing in the app calls it yet.
- The queue. See above.
- **Any evidence that the model and Superset can actually talk.** Docker was not
  running when this was written, so no container here has been started once and
  the agent has never met a real MCP server. What is tested is everything
  between: the client against a fake server built on `httpx.MockTransport`
  (14 tests), and the loop with both ends faked (17). Those pin the protocol and
  the loop, not the integration. Treat the bring-up steps above as the first
  real test.
