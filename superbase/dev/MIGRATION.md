# Moving a course site to another Supabase project

How to move one course's database (and everything around it) from one
Supabase project to another — another region, another account — with no data
lost and about 5 minutes of read-only site. First done for phys161 on
2026-11-03 (Tokyo → Frankfurt, see the record at the end); everything needed
is in this folder.

Placeholders below: `OLD_REF` / `NEW_REF` = the projects' refs (the
`xxxxxxxxxxxxxxxxxxxx` in `https://xxxxxxxxxxxxxxxxxxxx.supabase.co`).

## The kit

| File | What it is for |
|---|---|
| [`../migrations/ALL.sql`](../migrations/ALL.sql) | Builds an empty project into the current schema in one go (all migrations folded). Keep it up to date: fold every new migration into it. |
| [`restore_backup.py`](restore_backup.py) | Copies the data, checks it. Commands: `schema` (compare structure), `db --dry-run` (rehearse), `db` (copy), `verify` (compare data). |
| [`supabase/functions/export-secrets/`](supabase/functions/export-secrets/index.ts) | Temporary function that reads back the Edge Function secrets (the dashboard never shows their values). |
| [`stage_functions.py`](stage_functions.py) | Puts `../edge-functions/*.ts` into the folder layout the CLI deploys from. |
| [`freeze.sql`](freeze.sql) / [`unfreeze.sql`](unfreeze.sql) | Make the old database refuse every write / undo that. |

## Things to know first

- **Tools**: Python with `pip install "psycopg[binary]"`; the Supabase CLI runs
  through `npx supabase ...` (no install). Netlify CLI for `minify.py --deploy`.
- **Connection strings**: dashboard → Connect → Direct → **Session pooler**,
  type **URI**: `postgresql://postgres.REF:PASSWORD@aws-…pooler.supabase.com:5432/postgres`.
  The plain direct address is IPv6-only and fails on most home networks.
  A password with `@ : / ? # %` must be URL-encoded — or reset it to letters
  and digits. `restore_backup.py` reads them from `OLD_DB_URL` and
  `SUPABASE_DB_URL` (new), or asks.
- **The CLI is logged in to one Supabase account at a time** (`npx supabase
  login`). If the projects are in different accounts, do everything that
  needs the old project (step 3) first, then log in to the new account.
- **Always name the project**: `--remote=REF` on every CLI command. An
  account may hold other live projects (the new account also has PHYS 162's).
- The CLI asks before changing a live project; in a script/agent run that
  means adding `--yes` once the change is approved.
- The SQL Editor can't run big data scripts ("query too large") — that is why
  the copy runs from Python over a direct connection.
- Never put passwords or secret values in the repo or a chat. If they were
  pasted somewhere, reset them at the end (step 15).

---

## Part A — Build the new project (live site untouched)

**1. Create the schema.** New project → SQL Editor → run `ALL.sql`
(one transaction: all or nothing). It includes the tables, view, functions,
triggers, RLS + policies, the realtime broadcast policy, `forum_messages` in
the `supabase_realtime` publication (live forum), the `share-cards` bucket
and the automatic-RLS safety net (`ensure_rls`).

**2. Compare the structure with the old project.**
```
python restore_backup.py schema
```
Must say **"Same structure."** Anything listed "only in OLD" was changed
by hand in the old project and is missing from the migrations: add it to the
new project **and** as a new migration + to `ALL.sql`. (In 2026-11 this found
`rls_auto_enable` / `ensure_rls`, Supabase's optional automatic-RLS trigger.)

**3. Recover the old secrets** (CLI logged in to the OLD account).
```
npx supabase secrets list --remote=OLD_REF            # names only
# EXPORT_TOKEN = a long random value, e.g. python -c "import secrets; print(secrets.token_hex(32))"
npx supabase secrets set EXPORT_TOKEN=<token> --remote=OLD_REF
cd superbase/dev
npx supabase functions deploy export-secrets --remote=OLD_REF --no-verify-jwt --use-api
# open https://OLD_REF.supabase.co/functions/v1/export-secrets?token=<token>
#   → save the JSON outside the repo (password manager / temp file)
npx supabase functions delete export-secrets --remote=OLD_REF
npx supabase secrets unset EXPORT_TOKEN --remote=OLD_REF
```
Check the values: `secrets list -o json` shows each secret's SHA-256 — the
recovered values must hash to the same. (Without the CLI the same works in
the dashboard: Edge Functions → Secrets / Deploy via Editor.)

What must be copied **with identical values**, or things break:

| Secret | If it changed |
|---|---|
| `PIN_PEPPER` | no PIN works (sign-in on a new device) |
| `DEVICE_SECRET_PEPPER` | every device is rejected (posting, syncing) |
| `DEVICE_TOKEN_SECRET` | harmless (12 h tokens are reissued) — copy anyway |
| `SOLUTIONS_KEY_PEPPER` | every editor key stops working |
| `SOLUTIONS_ADMIN_KEY` | only the admin key changes |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | push subscriptions die (public key is also in `js/course-config.js`) |
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | can be re-taken from Google / OpenAI |

`VAPID_SUBJECT` is optional (post-message.ts has a fallback). Skip every
`SUPABASE_*` / `SB_*` / `DENO_*` value — the new project has its own.

**4. Set the secrets on the new project** (CLI logged in to the NEW account).
Put them in a temp `.env` file (`NAME="value"` per line), then
```
npx supabase secrets set --env-file <file> --remote=NEW_REF
```
and compare the digests again (`secrets list -o json`). Delete the file at the end.

**5. Deploy the Edge Functions.**
```
python superbase/dev/stage_functions.py NEW_REF     # prints the folder + command
```
All with JWT verification off. Check: `npx supabase functions list
--remote=NEW_REF` shows them ACTIVE, `verify_jwt=false`.

**6. Rehearse the copy.**
```
python restore_backup.py db --dry-run
```
Full copy old → new, row counts per table, then rolled back. Must end with
"Dry run: everything checked and rolled back". The new project is untouched
afterwards.

## Part B — Prepare the site change (still nothing live)

**7. Edit the files** (all of it before the freeze, so the read-only window
stays short):
- `js/course-config.js` → this course's `supabase.url` and `publishableKey`
  (new project → Project Settings → API Keys, `sb_publishable_…`).
- `course/manual.json` → the privacy section names the database's city.
- Version bump only if the user asks (`site-version.json`, `CURRENT_VERSION`
  in `js/quiz-engine.js`, changelog entry), and set/clear `DEPLOY_MESSAGE`.
- Optional: `min_version` = the new version in `site-version.json`, so open
  tabs on the old version reload soon (otherwise they keep using the frozen
  old database for up to 48 h; their writes wait on the device meanwhile).

**8. Test build** — `python minify.py` (no deploy), and check that
`git status` contains nothing you don't want to ship. Check the netlify
link: `npx netlify status` shows the right site.

## Part C — The switch (≈ 5 min read-only; pick a quiet time)

**9. Freeze the old database** — run `freeze.sql` on it (SQL Editor or
psycopg). It lists the frozen tables; a test write must fail with "Database
is read-only".

**10. Copy** — `python restore_backup.py db`
(one consistent snapshot of the old DB, one transaction into the new one;
user triggers off while loading, sequences moved past the copied ids).

**11. Verify** — `python restore_backup.py verify` → must say **"All tables
identical."** (row count + fingerprint of every row).
If not: `unfreeze.sql` on the old database, stop, investigate. The site never
left the old database, nothing is lost.

**12. Deploy** — `python minify.py --deploy`.

## Part D — Check and clean up

**13. Check:**
- the live `js/course-config.js` contains `NEW_REF` (fetch it from the site);
- new rows arrive in the new database (`site_visits`, `quiz_attempts`, …);
- you: forum (post a test message, live update on a 2nd device), stats,
  sign-in with nickname + PIN on another browser, editor key, a solution.

**14. Share cards** (pictures in the `share-cards` bucket are not copied):
```sql
update public.problem_solutions set share = null where share is not null;
```
on the new database — shared links then fall back to the site's preview —
and in the editor press the "make them all" button to redraw them.

**15. Clean up:** delete the temp secrets/`.env` files; reset the database
passwords (Project Settings → Database) if they were pasted anywhere;
`npx supabase logout` if wanted. **Leave the old project frozen** for a few
days (stale tabs can't write there), then pause or delete it.

## Undo at each stage

| When | State | Undo |
|---|---|---|
| Part A–B | live site untouched | nothing to undo |
| steps 9–11 | old DB frozen, site read-only | `unfreeze.sql` |
| after step 12 | site on the new DB | revert `course-config.js`, redeploy, `unfreeze.sql` — only if nothing important was written to the new DB yet |

---

## Record: phys161, 2026-11-03

- Old `ntlonovwrpspqncmejdm` (Tokyo, ap-northeast-1, old account) →
  new `srbwxqixcqbkgziqehuf` (Frankfurt, eu-central-1, the account that also
  holds PHYS 162 `eammcjjsjyvmbjsloxpz`).
- Schema found already built from `ALL.sql`; `schema`-type comparison found
  `rls_auto_enable` / `ensure_rls` missing → added (and to `ALL.sql`).
- Secrets: 9 recovered, all matched their digests; `VAPID_SUBJECT` was never set.
- Dry run: 19 tables, 15 614 rows. Switch: freeze 10:13:30 UTC, copy
  15 619 rows (5 written in between), verify identical, site 13.4.1 live
  10:17:52 UTC — ≈ 4½ min read-only, nothing lost.
- Afterwards: migration 015 (view `forum_messages_public` with
  `security_invoker`, fixing Supabase's "Security Definer View" warning).
- Speed from Kazakhstan (median): ping 310 → 89 ms; opening a solution
  0.6 → 0.3 s (small/typical), 1.4–1.7 → 0.2–0.45 s (largest, 153 KB).
