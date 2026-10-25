-- Scheduled jobs for project hostel-new. Run once in the SQL editor AFTER deploying the `cron` function and setting CRON_SECRET.
-- Replace PASTE_CRON_SECRET with the same value you gave `supabase secrets set CRON_SECRET=...`.
-- Times are UTC. Nairobi is UTC+3. Every job is safe to run twice.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  base text := 'https://gzhyorqbpvpoevaeiuvz.supabase.co/functions/v1/cron';
  hdr  text := '{"Content-Type":"application/json","x-cron-secret":"PASTE_CRON_SECRET"}';
  job  record;
begin
  for job in select * from (values
    ('rh-generate-charges',     '5 21 * * *',  'generate-charges'),      -- 00:05 Nairobi: this month's rent charge for every running tenancy
    ('rh-expire-subscriptions', '10 21 * * *', 'expire-subscriptions'),  -- 00:10 Nairobi: unpaid plans become expired
    ('rh-reminders',            '30 4 * * *',  'reminders'),             -- 07:30 Nairobi: rent reminder texts
    ('rh-reconcile',            '*/5 * * * *', 'reconcile'),             -- every 5 minutes: settle M-Pesa prompts that never answered
    ('rh-payouts',              '0 6 * * 5',   'payouts')                -- Friday 09:00 Nairobi: prepare payouts for the admin to pay
  ) as t(name, schedule, task) loop
    perform cron.unschedule(job.name) where exists (select 1 from cron.job where jobname = job.name);
    perform cron.schedule(job.name, job.schedule,
      format($c$select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)$c$, base, hdr, json_build_object('task', job.task)::text));
  end loop;
end $$;
