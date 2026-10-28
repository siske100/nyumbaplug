-- Viewings are managed by the landlord who owns the listed house, not by admins.
drop view if exists admin_viewings;
drop policy if exists visits_admin_read on visit_requests;
drop policy if exists visits_admin_update on visit_requests;
drop policy if exists visits_landlord_read on visit_requests;

create policy visits_landlord_read on visit_requests for select to authenticated using (
  exists (select 1 from houses h where h.id = house_id and h.landlord_id = auth.uid() and landlord_active(auth.uid())));
create policy visits_landlord_update on visit_requests for update to authenticated
  using (exists (select 1 from houses h where h.id = house_id and h.landlord_id = auth.uid() and landlord_active(auth.uid())))
  with check (exists (select 1 from houses h where h.id = house_id and h.landlord_id = auth.uid() and landlord_active(auth.uid())));

revoke update (status, admin_notes, scheduled_date, scheduled_window) on visit_requests from authenticated;
grant update (status, scheduled_date, scheduled_window) on visit_requests to authenticated;

drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select to authenticated using (
  actor = auth.uid() or (is_admin() and entity in ('kyc','subscription','house','profile')));
