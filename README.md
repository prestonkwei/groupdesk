# Tickets

A shared inbox for mail sent to the support team Google Group.
Gmail pushes changes to Pub/Sub, this app turns them into tickets, and agents
reply from the portal with threading that lands correctly in the requester's
inbox.

Google Cloud (project `your-gcp-project`) is already set up: APIs enabled,
Internal consent screen, Web OAuth client, the `gmail-tickets` topic, and the
`gmail-tickets-push` push subscription with a dead-letter topic.

## Stack

| Piece | Choice |
| --- | --- |
| Framework | Next.js 16 App Router, React 19, TypeScript |
| Database | Neon Postgres via Drizzle (`drizzle-orm/neon-serverless`, pooled URL) |
| Styling | Tailwind v4, shadcn-style components in `src/components/ui` |
| Attachments | Vercel Blob |
| Login | Cloudflare Access, JWT verified with `jose` in `src/proxy.ts` |
| Mail | `@googleapis/gmail`, `postal-mime` to parse, `mimetext` to compose |

## How mail becomes a ticket

```
Gmail (helpdesk label)
  └─ users.watch ──► Pub/Sub topic gmail-tickets
                        └─ push (OIDC) ──► POST /api/gmail/push
                                              ├─ verify the OIDC token
                                              ├─ SELECT ... FOR UPDATE on gmail_sync
                                              ├─ history.list from OUR stored cursor
                                              ├─ messages.get(format: raw) → postal-mime
                                              └─ ingest → tickets / messages / events
```

Two things make this safe to retry:

- **Idempotence.** `messages.gmail_message_id` is unique, so a redelivered push
  is a no-op. The handler returns 500 on failure specifically so Pub/Sub retries.
- **Our cursor, not theirs.** The `historyId` in the notification is treated as
  a signal only. We always resume from `gmail_sync.last_history_id`, so a
  notification that arrives out of order or gets dropped costs nothing.

If `history.list` returns 404 the stored cursor has aged out (Gmail keeps about
a week). The sync falls back to `messages.list` with `newer_than:7d` and
re-anchors on the mailbox's current `historyId`. Dedupe makes that cheap.

`/api/cron/gmail-reconcile` runs the identical sync on a timer. Pushes give
speed; the cron gives the guarantee that a dropped push costs minutes rather
than a lost ticket.

## Local setup

```bash
pnpm install
cp .env.example .env.local     # .env.local already exists with the OAuth client filled in
```

Fill in at minimum:

- `DATABASE_URL` — Neon **pooled** connection string (host contains `-pooler`)
- `DEV_BYPASS_EMAIL` — your school address; stands in for Cloudflare Access locally
- `SEED_ADMIN_EMAIL` — same address, for the seed script

`TOKEN_ENC_KEY` and `CRON_SECRET` were generated into `.env.local` already.

```bash
pnpm db:migrate      # creates the schema and the ticket-number sequence
pnpm db:seed         # adds starter teams and tags; creates the admin if
                     # SEED_ADMIN_EMAIL is set
pnpm db:verify       # prints the tables, enums, constraints and row counts
pnpm dev
```

`db:seed` is safe to re-run — every insert is `on conflict do nothing`.

Then visit `/admin/gmail` and press **Connect Gmail**. The local OAuth client
already allows `http://localhost:3000/api/admin/gmail/callback`.

## Build order

The plan's risky part is steps 1–3. Everything after is ordinary CRUD.

1. **Connect.** `pnpm db:migrate && pnpm db:seed`, then Connect at `/admin/gmail`.
   Done when `gmail_sync` holds an encrypted refresh token.
2. **Ingest by hand.** `pnpm gmail:sync` runs the pipeline against real group
   mail without any watch or push involved. This is where the edge cases show
   up — run it repeatedly and read the tickets it creates.
   `pnpm test:ingest` covers the header parsing offline.
3. **Watch and push.** `pnpm gmail:watch` (or the button on `/admin/gmail`)
   registers the watch. Done when an email to the group appears in the database
   within seconds of sending it.
4. **Access + read-only views.** Cloudflare Access, then `/tickets`.
5. **Replies.** Check threading in the requester's inbox and that the echo back
   through the group dedupes instead of duplicating.
6. **Assignment, teams, tags, status, notes, events.**
7. **Admin pages, alerts, attachments.**

## Gmail filter (still to do)

In the connected Gmail account, create a filter:

- Matches: `list:help.example.org`
- Apply label: `helpdesk`
- Optionally skip the inbox, so a personal inbox stays clean

The watch is scoped to this label (`labelFilterBehavior: 'include'`), so nothing
else in the mailbox produces a push. `GMAIL_LABEL_NAME` must match the label
name exactly; the app resolves it to a label id and caches it on `gmail_sync`.

## Deploying

1. Create the Vercel project and a Neon database, then set every variable from
   `.env.example` in Vercel (Production and Preview).
2. `APP_URL=https://tickets.example.org`, and keep `GMAIL_PUSH_AUDIENCE`
   identical to the push subscription's audience.
3. Add the domain, then create the Cloudflare Access application:
   - Allow policy listing agent emails, Google or one-time PIN
   - **Bypass** policies for `/api/gmail/push` and `/api/cron/*` — Access would
     otherwise block Google's push requests, which carry no Access cookie
   - Copy the team domain into `CF_ACCESS_TEAM_DOMAIN` and the Application
     Audience tag into `CF_ACCESS_AUD`
4. `vercel-build` runs `db:migrate` before `next build`, so schema changes ship
   with the deploy.

### Crons

`vercel.json` schedules `/api/cron/gmail-watch` daily, which the Hobby plan
allows. The 5-minute reconcile needs one of:

- Vercel Pro, adding
  `{ "path": "/api/cron/gmail-reconcile", "schedule": "*/5 * * * *" }`
- A Cloudflare Worker cron trigger
- n8n on the Mac mini

calling the endpoint with `Authorization: Bearer $CRON_SECRET`.

## Security notes

- **Email HTML is untrusted.** Message bodies render inside an iframe with an
  empty `sandbox` attribute — no scripts, no same-origin, no forms. See
  `src/components/message-body.tsx`.
- **Refresh tokens are encrypted at rest** with AES-256-GCM under
  `TOKEN_ENC_KEY` (`src/lib/crypto.ts`), not stored in plaintext.
- **Two independent gates.** Cloudflare Access decides who reaches the app;
  the `agents` table decides who the app will act for. Deactivating an agent
  here does not remove them from Access — update both.
- The consent screen is **Internal**, so refresh tokens do not expire after
  7 days the way an External app stuck in Testing would.

## Layout

```
src/
  proxy.ts                  Access JWT gate (Next 16's middleware convention)
  app/
    (portal)/               tickets list, ticket page, admin pages
    api/gmail/push          Pub/Sub push handler
    api/cron/*              watch renewal, reconcile
    api/admin/gmail/*       OAuth connect and callback
    api/tickets/updates     poll target for live refresh
  db/                       schema + lazy Neon client
  lib/
    gmail/{client,sync,ingest,send}.ts
    actions/{tickets,admin}.ts
    auth.ts access-jwt.ts crypto.ts queries.ts alerts.ts env.ts
  components/               ui/, thread, composer, sidebar, admin forms
scripts/                    migrate, seed, gmail:watch, gmail:sync, test:ingest
```

## Commands

```bash
pnpm dev            # local dev
pnpm test           # typecheck + lint + offline ingest checks
pnpm db:generate    # new migration after editing src/db/schema.ts
pnpm db:migrate
pnpm db:verify      # read-only: what actually exists in the database
pnpm gmail:sync     # run the ingest pipeline by hand
pnpm gmail:watch    # start or renew the Gmail watch
```
