"""
Restore a pg_temp.backup_all() export into an empty Supabase project.

The SQL Editor refuses a restore query that carries the whole backup, so this
connects to the database directly and loads one table at a time, all inside a
single transaction (any error -> nothing is written).

Usage:
    pip install "psycopg[binary]"
    python restore_backup.py backup.csv        # or backup.json
    python restore_backup.py backup.csv --dry-run
    python restore_backup.py db --dry-run      # copy straight from the old DB
    python restore_backup.py verify            # compare old and new, table by table
    python restore_backup.py schema            # compare old and new STRUCTURE (read-only)

With `db` the old database is read directly (read-only transaction, nothing
there is changed) instead of from a file; its connection string is asked for.

Connection strings are read from OLD_DB_URL / SUPABASE_DB_URL (new), or asked for. Take it from
the dashboard: Connect -> Direct -> "Session pooler" (works on IPv4 networks),
and put the database password in place of [YOUR-PASSWORD].

What it does:
  * reads the backup (the SQL Editor's CSV download or plain JSON);
  * checks every table exists in the target and is empty (the single seed row
    of quiz_attempts_counter that ALL.sql inserts is removed first);
  * turns off user triggers while loading, so counters are not incremented
    twice, realtime pings are not sent, and the solution triggers do not
    rewrite is_default / author_id;
  * inserts tables parents-first (foreign keys stay checked), rows by id;
  * moves identity sequences past the restored ids;
  * prints the row count per table.
"""

import csv
import getpass
import json
import os
import re
import sys

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb


def read_source_db(url):
    """Read every public table straight from the old database, read-only."""
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        # one snapshot for all tables: the copy is consistent even if writes happen meanwhile
        cur.execute("set transaction isolation level repeatable read, read only")
        cur.execute("""
            select table_name from information_schema.tables
             where table_schema = 'public' and table_type = 'BASE TABLE'
             order by table_name
        """)
        data = {}
        for (t,) in cur.fetchall():
            cur.execute(sql.SQL("select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.{} x")
                           .format(sql.Identifier(t)))
            data[t] = cur.fetchone()[0]
        conn.rollback()
    return data


def fingerprints(url):
    """Per table: (row count, md5 of all rows). Same data -> same fingerprint,
    whatever the column order or the order rows are stored in."""
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("set transaction isolation level repeatable read, read only")
        cur.execute("set local timezone = 'UTC'")
        cur.execute("""
            select table_name from information_schema.tables
             where table_schema = 'public' and table_type = 'BASE TABLE'
        """)
        out = {}
        for (t,) in cur.fetchall():
            cur.execute(sql.SQL("""
                select count(*), md5(coalesce(string_agg(r, E'\\n' order by r), ''))
                  from (select to_jsonb(x)::text r from public.{} x) s
            """).format(sql.Identifier(t)))
            out[t] = cur.fetchone()
        conn.rollback()
    return out


def verify():
    old = fingerprints(os.environ.get("OLD_DB_URL")
                       or getpass.getpass("OLD database connection string (read only): "))
    new = fingerprints(os.environ.get("SUPABASE_DB_URL")
                       or getpass.getpass("NEW database connection string (read only): "))
    ok = True
    for t in sorted(set(old) | set(new)):
        a, b = old.get(t), new.get(t)
        if a == b:
            print(f"  OK        {t}: {a[0]} rows")
        else:
            ok = False
            print(f"  DIFFERENT {t}: old {a[0] if a else 'missing'} rows, new {b[0] if b else 'missing'} rows")
    print("All tables identical." if ok else "MISMATCH: do not switch the site.")
    sys.exit(0 if ok else 1)


SCHEMA_COLUMNS = """
    select table_name, column_name, data_type, is_nullable, coalesce(column_default, ''), is_identity
      from information_schema.columns where table_schema = 'public'
"""
SCHEMA_OBJECTS = """
    select 'index ' || indexname || ': ' || indexdef from pg_indexes where schemaname = 'public'
    union all
    select 'trigger ' || event_object_table || '.' || trigger_name || ' ' || event_manipulation
      from information_schema.triggers where trigger_schema = 'public'
    union all
    select 'policy ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' ' || roles::text
           || ' ' || coalesce(qual, '')
      from pg_policies where schemaname in ('public', 'realtime')
    union all
    select 'constraint ' || conrelid::regclass || ' ' || pg_get_constraintdef(oid)
      from pg_constraint where connamespace = 'public'::regnamespace
    union all
    select 'rls on ' || relname from pg_class
     where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
    union all
    select 'view option ' || relname || ' ' || array_to_string(reloptions, ',') from pg_class
     where relnamespace = 'public'::regnamespace and relkind = 'v' and reloptions is not null
    union all
    select 'event trigger ' || evtname || ' -> ' || evtfoid::regproc from pg_event_trigger
    union all
    select 'realtime publication ' || schemaname || '.' || tablename
      from pg_publication_tables where pubname = 'supabase_realtime'
    union all
    select 'bucket ' || id from storage.buckets
    union all
    select 'grant ' || table_name || '.' || column_name || ' ' || privilege_type || ' to ' || grantee
      from information_schema.column_privileges
     where table_schema = 'public' and grantee in ('anon', 'authenticated')
       and table_name not in (select table_name from information_schema.role_table_grants
                               where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT')
"""


def schema_of(url):
    """Columns, objects and function bodies (comments/whitespace ignored)."""
    norm = lambda s: re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", s)).strip()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("set transaction read only")
        cur.execute(SCHEMA_COLUMNS)
        items = {"column " + " | ".join(map(str, r)) for r in cur.fetchall()}
        cur.execute(SCHEMA_OBJECTS)
        items |= {r[0] for r in cur.fetchall()}
        cur.execute("select proname, pg_get_functiondef(oid) from pg_proc where pronamespace = 'public'::regnamespace")
        items |= {f"function {name}: {norm(body)}" for name, body in cur.fetchall()}
        conn.rollback()
    return items


def compare_schema():
    old = schema_of(os.environ.get("OLD_DB_URL")
                    or getpass.getpass("OLD database connection string (read only): "))
    new = schema_of(os.environ.get("SUPABASE_DB_URL")
                    or getpass.getpass("NEW database connection string (read only): "))
    short = lambda s: s if len(s) < 160 else s[:157] + "..."
    for label, diff in (("only in OLD", old - new), ("only in NEW", new - old)):
        for item in sorted(diff):
            print(f"  {label}: {short(item)}")
    print("Same structure." if old == new else
          "DIFFERENT structure: fix the new project (or ALL.sql) before copying.")
    sys.exit(0 if old == new else 1)


def read_backup(path):
    if path == "db":
        return read_source_db(os.environ.get("OLD_DB_URL")
                              or getpass.getpass("OLD database connection string (read only): "))
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    if text.lstrip().startswith("{"):
        return json.loads(text)
    csv.field_size_limit(2**31 - 1)
    rows = list(csv.reader(text.splitlines(keepends=True)))
    return json.loads(rows[1][0])  # row 0 is the column name


def parents_first(cur, tables):
    """Order tables so every table comes after the tables it references."""
    cur.execute("""
        select c.conrelid::regclass::text, c.confrelid::regclass::text
          from pg_constraint c
          join pg_namespace n on n.oid = c.connamespace
         where c.contype = 'f' and n.nspname = 'public'
           and c.conrelid <> c.confrelid
    """)
    deps = {t: set() for t in tables}
    for child, parent in cur.fetchall():
        child, parent = child.removeprefix("public."), parent.removeprefix("public.")
        if child in deps and parent in deps:
            deps[child].add(parent)
    ordered = []
    while deps:
        ready = sorted(t for t, p in deps.items() if not p)
        if not ready:
            raise SystemExit(f"Foreign-key cycle between: {', '.join(deps)}")
        for t in ready:
            ordered.append(t)
            del deps[t]
        for p in deps.values():
            p.difference_update(ready)
    return ordered


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    if args == ["verify"]:
        verify()
    if args == ["schema"]:
        compare_schema()
    if len(args) != 1:
        raise SystemExit(__doc__)

    data = read_backup(args[0])
    print(f"Backup has {len(data)} tables, {sum(len(v) for v in data.values())} rows.")

    url = os.environ.get("SUPABASE_DB_URL") or getpass.getpass("NEW database connection string: ")
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("""
            select table_name from information_schema.tables
             where table_schema = 'public' and table_type = 'BASE TABLE'
        """)
        existing = {r[0] for r in cur.fetchall()}
        missing = sorted(set(data) - existing)
        if missing:
            raise SystemExit(f"Not in the target database (run ALL.sql first?): {', '.join(missing)}")

        cur.execute("delete from public.quiz_attempts_counter where id = 1 and total_ever = 0")
        for t in data:
            cur.execute(sql.SQL("select exists (select 1 from public.{})").format(sql.Identifier(t)))
            if cur.fetchone()[0]:
                raise SystemExit(f"Table {t} is not empty; restore only into empty tables.")

        order = parents_first(cur, list(data))
        for t in order:
            cur.execute(sql.SQL("alter table public.{} disable trigger user").format(sql.Identifier(t)))

        for t in order:
            rows = data[t]
            if not rows:
                print(f"  {t}: 0")
                continue
            cur.execute("""
                select column_name from information_schema.columns
                 where table_schema = 'public' and table_name = %s
                   and is_generated = 'NEVER'
                 order by ordinal_position
            """, (t,))
            keys = set().union(*rows)
            cols = [c for c, in cur.fetchall() if c in keys]
            dropped = sorted(keys - set(cols))
            if dropped:
                print(f"  {t}: backup columns not in target, skipped: {', '.join(dropped)}")
            if "id" in keys:
                rows = sorted(rows, key=lambda r: (r.get("id") is None, r.get("id")))
            col_list = sql.SQL(", ").join(map(sql.Identifier, cols))
            cur.execute(
                sql.SQL("insert into public.{t} ({cols}) overriding system value "
                        "select {cols} from jsonb_populate_recordset(null::public.{t}, %s)")
                   .format(t=sql.Identifier(t), cols=col_list),
                (Jsonb(rows),))
            print(f"  {t}: {cur.rowcount}")

        for t in order:
            cur.execute(sql.SQL("alter table public.{} enable trigger user").format(sql.Identifier(t)))

        cur.execute("""
            select c.relname, a.attname,
                   pg_get_serial_sequence(format('public.%I', c.relname), a.attname)
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
              join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
             where n.nspname = 'public' and c.relkind = 'r'
               and pg_get_serial_sequence(format('public.%I', c.relname), a.attname) is not null
        """)
        for table, col, seq in cur.fetchall():
            cur.execute(
                sql.SQL("select setval(%s, coalesce(max({c}), 0) + 1, false) from public.{t}")
                   .format(c=sql.Identifier(col), t=sql.Identifier(table)),
                (seq,))

        if dry_run:
            conn.rollback()
            print("Dry run: everything checked and rolled back, nothing written.")
        else:
            conn.commit()
            print("Restored.")


if __name__ == "__main__":
    main()
