-- Close the `xmax` side channel on the organizer's direct table reads.
--
-- `grant select on <table>` is a TABLE-level privilege, and a table-level
-- SELECT also grants the system columns (`xmax`, `ctid`, `cmin`, `cmax`).
-- `xmax` carries the xid of the last transaction to lock or update the tuple,
-- and PostgREST forwards unrecognised column names straight to SQL, so the
-- organizer could read it over the Data API.
--
-- That leaked claim state before the reveal, through two FK-driven locks:
--
--   * `insert into public.claims` takes `SELECT ... FOR KEY SHARE` on the
--     parent `public.items` row, so a claimed item had `xmax <> 0` and an
--     unclaimed one had `xmax = 0` — per-item claim status, filterable with
--     `?xmax=neq.0` and countable with `Prefer: count=exact`.
--   * `private.claim_item` takes `... for share` on the `public.events` row,
--     so `events.xmax <> 0` revealed that at least one claim existed.
--
-- Both violate the organizer-blindness rule in CLAUDE.md. `get_shared_items`
-- was never the leak — the parallel direct-table read path was.
--
-- The fix is to replace the table-level SELECT with a COLUMN-scoped SELECT
-- covering exactly the business columns. System columns require the
-- table-level privilege, so they become `permission denied`, while ordinary
-- reads and `update ... where` (which needs SELECT on the predicate columns)
-- keep working unchanged.
--
-- No policy, RPC or application change is needed: `private.*` bodies are
-- SECURITY DEFINER and run as the table owner, so they are unaffected.

revoke select on public.events from authenticated;
grant select (
  id,
  owner_id,
  name,
  event_date,
  timezone,
  share_token,
  unlockable_at,
  auto_reveal_at,
  revealed_at,
  created_at,
  updated_at
) on public.events to authenticated;

revoke select on public.items from authenticated;
grant select (
  id,
  event_id,
  title,
  notes,
  link,
  price_range,
  created_at,
  updated_at
) on public.items to authenticated;
