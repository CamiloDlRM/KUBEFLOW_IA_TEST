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

### Verify it can read gold

This is the step worth doing before anything is built on top, because it
exercises the one part that is new: DuckDB reaching MinIO over `httpfs`.

In **SQL Lab**, add a database with URI `duckdb:///:memory:` and these engine
parameters:

```json
{
  "connect_args": {
    "preload_extensions": ["httpfs"],
    "config": {
      "s3_endpoint": "minio:9000",
      "s3_access_key_id": "minioadmin",
      "s3_secret_access_key": "minioadmin",
      "s3_use_ssl": false,
      "s3_url_style": "path"
    }
  }
}
```

Then run, against a project that has a gold build:

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

**The driver versions are unpinned.** `duckdb` and `duckdb-engine` have never
been resolved against this base image here. A pin invented without running it
is a broken build rather than a reproducible one — pin them from `pip freeze`
after the first successful bring-up.

**The MCP server authenticates as one fixed user.** `MCP_DEV_USERNAME` is the
documented development mode: anything that can reach port 5008 gets that user's
permissions, with no token. That is why the port is not published. Before it is
reachable from anywhere else it has to become the JWT mode.

## What is not here

- The DuckDB view per project, and refreshing it when `rebuild_gold` writes a
  new build.
- The agent. The platform's advisor (`core/ai_advisor.py`) calls Gemini over
  plain REST and has no MCP client and no tool-calling loop; giving it one — MCP
  tool schemas translated into Gemini function declarations, and a loop that
  runs until the model stops calling tools — is its own piece of work.
- Anything verified. Docker was not running when this was written, so none of
  the above has been started once. Treat the bring-up steps as the first test,
  not as a description of something that worked.
