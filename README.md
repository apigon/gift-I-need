# GIN — Gift I Need

A gift-coordination web app. Event organizers create a gift-idea list and share a link; guests browse and claim items.

**The core rule:** the organizer cannot see claim status, claimer identity, or claim counts until the event date has passed. This is a hard business rule enforced at the data layer, not just in the UI.

- Requirements: [`context/foundation/prd.md`](context/foundation/prd.md)
- Stack rationale: [`context/foundation/tech-stack.md`](context/foundation/tech-stack.md)
- Roadmap: [`context/foundation/roadmap.md`](context/foundation/roadmap.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Supabase (Postgres + Auth) · Cloudflare Workers via `@opennextjs/cloudflare`

**Package manager: pnpm only.** Never npm or yarn.

---

## Prerequisites

| Tool | Notes |
| --- | --- |
| Node | See `.nvmrc`. `nvm use` picks it up. |
| pnpm | `corepack enable` or `brew install pnpm` |
| Docker | Only needed for the **local** Supabase stack. See below. |
| Supabase CLI | `brew install supabase/tap/supabase` |

### Docker

The local Supabase stack needs a Docker daemon. This project has been run with **colima** (there is no Docker Desktop dependency):

```bash
colima start --cpu 4 --memory 6    # first run creates the VM; ~2GB default is too small for Supabase
docker ps                          # verify the daemon is reachable
colima stop                        # when you're done for the day
```

If you use Docker Desktop or OrbStack instead, just make sure `docker ps` works — nothing here is colima-specific.

---

## Running the app

There are **two** ways to run it, and they point at **different databases**. This trips people up, so check which one you want.

### Against hosted Supabase (default)

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Reads `.env`, which points at the **hosted** Supabase project. Real data. Use this for everyday feature work.

### Against the local Supabase stack

```bash
supabase start      # boots Postgres, Auth, Studio, Mailpit (~10 containers)
pnpm dev:local      # http://localhost:3000
```

Reads `.env.localdb` instead, via `dotenv-cli`. Use this when you need to touch schema, inspect the database freely, or test email flows.

> **Gotcha:** `pnpm dev:local` still prints `- Environments: .env`. That is Next reporting which files it loaded, **not** which values won. `dotenv-cli` populates `process.env` first and Next does not override existing values, so `.env.localdb` does take effect. To be certain:
>
> ```bash
> PID=$(lsof -tiTCP:3000 -sTCP:LISTEN); ps eww -p $(ps -o ppid= -p $PID) | tr ' ' '\n' | grep NEXT_PUBLIC_SUPABASE_URL
> ```
>
> Local is `http://127.0.0.1:54321`; hosted is `https://<ref>.supabase.co`.

### Stopping

```bash
# app: Ctrl-C in its terminal, or
lsof -tiTCP:3000 -sTCP:LISTEN | xargs kill

supabase stop       # stops containers, KEEPS data
supabase stop --no-backup   # stops and DISCARDS local data
colima stop         # release the VM's RAM
```

---

## Local services

Once `supabase start` is running:

| Service | URL | What it's for |
| --- | --- | --- |
| **Studio** | http://localhost:54323 | Table editor, SQL editor, auth users — the main UI |
| **Mailpit** | http://localhost:54324 | **Captures every outgoing email.** Nothing is really sent locally. |
| API | http://localhost:54321 | Supabase REST / Auth endpoints |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Direct DB connection |

`supabase status` reprints these along with the local anon/service keys.

### Inspecting the database

Via **Studio** (http://localhost:54323) for browsing, or `psql` for anything scripted:

```bash
# through the running container — no local psql install needed
docker exec supabase_db_gin psql -U postgres -c "select email, email_confirmed_at from auth.users;"

# or directly, if you have psql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Useful during auth work:

```bash
docker exec supabase_db_gin psql -U postgres -c "select count(*) from auth.users;"
docker exec supabase_db_gin psql -U postgres -c "delete from auth.users;"   # reset test accounts
```

### Reading captured email

Open **http://localhost:54324**. Sign-up confirmations, password resets and magic links all land there instead of being delivered.

It also has an API, which is handy for scripting:

```bash
curl -s 'http://localhost:54324/api/v1/messages?limit=5'     # list
curl -s -X DELETE 'http://localhost:54324/api/v1/messages'   # clear the mailbox
```

> Email confirmations are **disabled** in v1 (`enable_confirmations = false`). The `/auth/confirm` route exists and works but is dormant. To exercise it, set `enable_confirmations = true` in `supabase/config.toml`, run `supabase stop && supabase start`, then use `pnpm dev:local` — **not** `pnpm dev`, because hosted SMTP is capped at ~2 emails/hour. Revert the flag afterwards.

---

## Checks

```bash
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm build        # production build
pnpm test             # unit tests (Vitest)
pnpm test:db          # pgTAP suite — needs `colima start` and `supabase start`
pnpm test:integration # local-stack race test — needs `colima start` and `supabase start`
```

## Cloudflare Workers

```bash
pnpm preview      # build with OpenNext + run workerd locally -> http://localhost:8787
pnpm deploy       # build and deploy
pnpm cf-typegen   # regenerate cloudflare-env.d.ts from wrangler config
```

`pnpm preview` runs the **real Workers runtime**, which is where deployment problems actually surface — always run it before merging anything touching middleware, cookies, or sessions.

> `pnpm preview` is **not** a deployed preview. It has no Cloudflare edge cache, so edge-caching bugs are invisible to it. Pushing a branch triggers a real Cloudflare preview deployment; use that for anything cache- or header-related.

`wrangler.jsonc` and `open-next.config.ts` are authoritative. Middleware runs on the **Edge** runtime.

---

## Gotchas

- **`.env` vs `.env.localdb`** — see above. `pnpm dev` is hosted; `pnpm dev:local` is local.
- **Never put a localhost URL in `.env`** — `workerd` can't reach it.
- **`[analytics]` is disabled** in `supabase/config.toml`. Its `vector` container bind-mounts the Docker socket, which fails on colima and breaks `supabase start` outright. Logflare is unused in v1.
- **Supabase matches redirect URLs including the query string.** An entry for `/auth/confirm` will not match `/auth/confirm?next=/foo`; the mismatch is silent and falls back to `site_url`. Hence the `/**` wildcards in `additional_redirect_urls`.
- **Hosted dashboard settings are not in this repo.** `supabase/config.toml` configures the **local** stack only. Confirmations-off and minimum password length must be set by hand in the hosted project.
- **Every route is dynamically rendered** — the root layout reads the session. There is no static output to lose today; see `wrangler.jsonc` for why.
