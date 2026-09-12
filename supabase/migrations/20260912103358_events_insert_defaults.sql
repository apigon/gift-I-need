-- Harmless placeholder DEFAULTs on three trigger-computed `events` columns so
-- the generated TypeScript Insert type matches what callers may actually
-- supply. `private.events_guard`'s BEFORE INSERT branch
-- (supabase/migrations/20260911211956_surprise_rule_schema.sql) unconditionally
-- overwrites all three on every insert, so these defaults are never
-- observably stored — see context/changes/create-and-share-event-list/plan.md
-- "Critical Implementation Details" for the full rationale. No RLS, grant, or
-- trigger-behavior change.
alter table public.events
  alter column unlockable_at set default now(),
  alter column auto_reveal_at set default now(),
  alter column share_token set default '';
