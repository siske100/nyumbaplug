-- 0007_storage: private storage for landlord ID and KRA documents.
-- Files live in <landlord id>/... Nobody can change or delete a file once it is uploaded (evidence).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-documents', 'kyc-documents', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A landlord may upload only into their own folder, only while documents are being asked for,
-- and no more than 12 files in total (a cap on storage abuse).
create policy kyc_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'kyc-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'landlord' and p.landlord_state = 'pending_kyc')
  and (select count(*) from storage.objects o where o.bucket_id = 'kyc-documents' and (storage.foldername(o.name))[1] = auth.uid()::text) < 12
);
create policy kyc_read_own on storage.objects for select to authenticated using (
  bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy kyc_read_admin on storage.objects for select to authenticated using (
  bucket_id = 'kyc-documents' and public.is_admin()
);
-- No update or delete policy exists on purpose.
