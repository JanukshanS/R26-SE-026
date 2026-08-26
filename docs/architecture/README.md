# Architecture model (Structurizr)

`workspace.dsl` is the C4 model of where data travels across Kaduna.lk — one
version-controlled file, no build step. Every relationship names **what** travels and
**over which protocol**; the dynamic views replay each flow step by step with the
status transitions in the step labels.

## Run it

From the repo root:

```bash
podman run --rm -u 0 -p 8080:8080 \
  -v "$PWD/docs/architecture:/usr/local/structurizr:Z" \
  docker.io/structurizr/structurizr local
```

Open <http://localhost:8080/workspace/1/diagrams>. Edit `workspace.dsl`, refresh the
browser — it re-parses on every page load, and parse errors show up in `podman logs`.

Two flags that are not optional here:

- `:Z` — Fedora/SELinux relabels the mount; without it the container can't read the DSL.
- `-u 0` — the image runs as uid 65532, which can't write into a rootless bind mount, and
  Structurizr refuses to start on a read-only data directory. Under rootless podman
  uid 0 in the container maps to your own user, so the files it writes stay yours.

`structurizr/lite` is retired and now only prints a migration notice; the image above is
its replacement.

## Views

| View | What it answers |
|---|---|
| **Context** | Who uses the platform and which external systems it depends on |
| **Containers** | The whole data-flow map: apps, services, stores, and every labelled edge |
| **EmergencySpine** | Driver taps *Get help* → incident → triage → geo score → provider assigned |
| **ProviderJobLoop** | Assigned → accepted → resolved, including the PostgREST ownership probe |
| **ObdTrip** | Dongle → summarised trip → component health |
| **ClaimCapture** | Guided capture → Edge Function → presigned PUT → R2 |
| **Deployment** | Which container runs where (Dokploy VPS, Supabase, R2, device) |
| **Documentation** | Status enums and the payload table (`docs/01-data-dictionary.md`) |

Export any view from the toolbar: PNG, SVG, PlantUML, Mermaid, or DOT.

## Keeping it honest

Change an endpoint, a store, or a status and update the matching relationship or dynamic
step here. `../flows.md` stays canonical for **screen navigation** (Mermaid, renders on
GitHub); this workspace is canonical for **system data flow**.
