# Admin dashboard

Open `/admin` while signed in as an admin to see who is online, which API calls the app is making, and which monitoring rules are triggered.

## Setup (once)

1. Supabase > SQL Editor: run `supabase/admin-monitoring.sql`.
2. In the same editor, make yourself an admin (use your login email):
   ```sql
   insert into public.admins (user_id)
     select id from auth.users where email = 'you@example.com'
     on conflict do nothing;
   ```
3. `npm run dev`, sign in, and an **Admin dashboard** link appears in the sidebar (or go to `/admin`).

## How it works

- `lib/tracker.js` wraps each Supabase call in `InventoryApp.js` (`tracked(...)`) and sends batches to the `log_activity` function every few seconds. It also sends a heartbeat every 30 s while the tab is visible.
- Both write through database functions that read the user id and email from the login token, so users cannot log activity as someone else.
- `/admin` reads aggregates through `admin_snapshot()` and `admin_alerts()`. Both refuse anyone who is not in `public.admins`; hiding the page is not the only protection.

## Rules

Each rule is: **metric** goes above **threshold** within **window** minutes, at a **severity**. Edit them on the Rules tab. Metrics: requests per user, errors per user, failed sign-ins per email, deletes per user, total requests, error rate (%, needs 10+ requests). Alerts clear by themselves when activity drops.

To add a new API to monitoring, wrap its call: `tracked("orders.insert", "POST", () => supabase.from("orders").insert(row))`.

## Limits to know about

- Tracking happens in the browser, so it shows what the app does, not what someone does by calling Supabase directly with a stolen key. For that, use Supabase Dashboard > Logs.
- "Online" = a heartbeat in the last 90 s; users with the tab in the background drop to offline.
- Signed-out visitors can only log sign-in/sign-up attempts, which is how failed-login rules work. Anyone can post those, so treat that rule as a hint, not proof.
- The log table grows. Trim it now and then: `select public.purge_activity_logs(30);` (run as an admin, or schedule it with pg_cron).
