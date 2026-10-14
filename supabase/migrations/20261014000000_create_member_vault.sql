-- One encrypted vault per signed-in Supabase user.
-- The browser encrypts all member details and QR material before it reaches Supabase.
create table if not exists public.member_vault (
  user_id uuid primary key references auth.users (id) on delete cascade,
  salt text not null,
  iv text not null,
  ciphertext text not null,
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.member_vault enable row level security;
revoke all on table public.member_vault from anon, authenticated;
grant select, insert, update on table public.member_vault to authenticated;

drop policy if exists "Read own encrypted member vault" on public.member_vault;
create policy "Read own encrypted member vault"
  on public.member_vault for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Create own encrypted member vault" on public.member_vault;
create policy "Create own encrypted member vault"
  on public.member_vault for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Update own encrypted member vault" on public.member_vault;
create policy "Update own encrypted member vault"
  on public.member_vault for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.touch_member_vault_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists member_vault_updated_at on public.member_vault;
create trigger member_vault_updated_at
  before update on public.member_vault
  for each row execute function public.touch_member_vault_updated_at();

-- QR screenshots are encrypted locally, then stored in a private bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-qr-vault', 'member-qr-vault', false, 2097216, array['application/octet-stream'])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Read own encrypted member QR" on storage.objects;
create policy "Read own encrypted member QR"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'member-qr-vault'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Upload own encrypted member QR" on storage.objects;
create policy "Upload own encrypted member QR"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'member-qr-vault'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Replace own encrypted member QR" on storage.objects;
create policy "Replace own encrypted member QR"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'member-qr-vault'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'member-qr-vault'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Delete own encrypted member QR" on storage.objects;
create policy "Delete own encrypted member QR"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'member-qr-vault'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
