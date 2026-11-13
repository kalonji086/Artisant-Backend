begin;

create table if not exists public.artisan_projects (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  description text not null check (length(trim(description)) between 1 and 3000),
  pptx_path text,
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artisan_projects_feed
  on public.artisan_projects (artisan_id, created_at desc);

alter table public.artisan_projects enable row level security;

drop policy if exists "Réalisations visibles par tous" on public.artisan_projects;
create policy "Réalisations visibles par tous"
  on public.artisan_projects for select to anon, authenticated using (true);

drop policy if exists "Artisans créent leurs réalisations" on public.artisan_projects;
create policy "Artisans créent leurs réalisations"
  on public.artisan_projects for insert to authenticated
  with check (
    auth.uid() = artisan_id
    and (pptx_path is null or pptx_path like auth.uid()::text || '/%')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan')
  );

drop policy if exists "Artisans modifient leurs réalisations" on public.artisan_projects;
create policy "Artisans modifient leurs réalisations"
  on public.artisan_projects for update to authenticated
  using (auth.uid() = artisan_id)
  with check (
    auth.uid() = artisan_id
    and (pptx_path is null or pptx_path like auth.uid()::text || '/%')
  );

drop policy if exists "Artisans suppriment leurs réalisations" on public.artisan_projects;
create policy "Artisans suppriment leurs réalisations"
  on public.artisan_projects for delete to authenticated
  using (auth.uid() = artisan_id);

grant select on public.artisan_projects to anon, authenticated;
grant insert, update, delete on public.artisan_projects to authenticated;

create table if not exists public.artisan_project_media (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.artisan_projects(id) on delete cascade,
  storage_path text not null,
  caption text not null default '',
  position integer not null check (position >= 0),
  created_at timestamptz not null default now()
);

create index if not exists artisan_project_media_order
  on public.artisan_project_media (project_id, position);

alter table public.artisan_project_media enable row level security;

drop policy if exists "Photos des réalisations visibles par tous" on public.artisan_project_media;
create policy "Photos des réalisations visibles par tous"
  on public.artisan_project_media for select to anon, authenticated using (true);

drop policy if exists "Artisans gèrent les photos de leurs réalisations" on public.artisan_project_media;
create policy "Artisans gèrent les photos de leurs réalisations"
  on public.artisan_project_media for all to authenticated
  using (
    exists (
      select 1 from public.artisan_projects p
      where p.id = project_id and p.artisan_id = auth.uid()
    )
  )
  with check (
    storage_path like auth.uid()::text || '/%'
    and exists (
      select 1 from public.artisan_projects p
      where p.id = project_id and p.artisan_id = auth.uid()
    )
  );

grant select on public.artisan_project_media to anon, authenticated;
grant insert, update, delete on public.artisan_project_media to authenticated;

create table if not exists public.artisan_project_likes (
  project_id uuid not null references public.artisan_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.artisan_project_likes enable row level security;

drop policy if exists "Likes visibles par tous" on public.artisan_project_likes;
drop policy if exists "Utilisateurs voient leurs likes" on public.artisan_project_likes;
create policy "Utilisateurs voient leurs likes"
  on public.artisan_project_likes for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Les clients aiment une réalisation" on public.artisan_project_likes;
create policy "Les clients aiment une réalisation"
  on public.artisan_project_likes for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client')
    and exists (select 1 from public.artisan_projects p where p.id = project_id and p.artisan_id <> auth.uid())
  );

drop policy if exists "Les clients retirent leur like" on public.artisan_project_likes;
create policy "Les clients retirent leur like"
  on public.artisan_project_likes for delete to authenticated using (auth.uid() = user_id);

revoke select on public.artisan_project_likes from anon, authenticated;
grant select (project_id, user_id) on public.artisan_project_likes to authenticated;
grant insert, delete on public.artisan_project_likes to authenticated;

create table if not exists public.artisan_project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.artisan_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default 'Client',
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists artisan_project_comments_feed
  on public.artisan_project_comments (project_id, created_at desc);

alter table public.artisan_project_comments enable row level security;

drop policy if exists "Commentaires visibles par tous" on public.artisan_project_comments;
create policy "Commentaires visibles par tous"
  on public.artisan_project_comments for select to anon, authenticated using (true);

drop policy if exists "Les clients commentent les réalisations" on public.artisan_project_comments;
create policy "Les clients commentent les réalisations"
  on public.artisan_project_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client')
    and exists (select 1 from public.artisan_projects p where p.id = project_id and p.artisan_id <> auth.uid())
  );

drop policy if exists "Auteurs et artisans suppriment les commentaires" on public.artisan_project_comments;
create policy "Auteurs et artisans suppriment les commentaires"
  on public.artisan_project_comments for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.artisan_projects p
      where p.id = project_id and p.artisan_id = auth.uid()
    )
  );

revoke select on public.artisan_project_comments from anon, authenticated;
grant select (id, project_id, author_name, body, created_at) on public.artisan_project_comments to anon, authenticated;
grant insert, delete on public.artisan_project_comments to authenticated;

create or replace function public.set_artisan_project_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select coalesce(nullif(trim(full_name), ''), 'Client')
  into new.author_name
  from public.profiles
  where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists artisan_project_comment_author on public.artisan_project_comments;
create trigger artisan_project_comment_author
  before insert on public.artisan_project_comments
  for each row execute function public.set_artisan_project_comment_author();

create or replace function public.update_artisan_project_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.artisan_projects set like_count = like_count + 1 where id = new.project_id;
    return new;
  end if;
  update public.artisan_projects set like_count = greatest(like_count - 1, 0) where id = old.project_id;
  return old;
end;
$$;

drop trigger if exists artisan_project_like_count on public.artisan_project_likes;
create trigger artisan_project_like_count
  after insert or delete on public.artisan_project_likes
  for each row execute function public.update_artisan_project_like_count();

create or replace function public.update_artisan_project_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.artisan_projects set comment_count = comment_count + 1 where id = new.project_id;
    return new;
  end if;
  update public.artisan_projects set comment_count = greatest(comment_count - 1, 0) where id = old.project_id;
  return old;
end;
$$;

drop trigger if exists artisan_project_comment_count on public.artisan_project_comments;
create trigger artisan_project_comment_count
  after insert or delete on public.artisan_project_comments
  for each row execute function public.update_artisan_project_comment_count();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artisan-projects',
  'artisan-projects',
  true,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
set public = true,
    file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];

drop policy if exists "Médias des réalisations lisibles par tous" on storage.objects;
create policy "Médias des réalisations lisibles par tous"
  on storage.objects for select to public using (bucket_id = 'artisan-projects');

drop policy if exists "Artisans ajoutent leurs médias" on storage.objects;
create policy "Artisans ajoutent leurs médias"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'artisan-projects'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Artisans modifient leurs médias" on storage.objects;
create policy "Artisans modifient leurs médias"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'artisan-projects'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'artisan-projects'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Artisans suppriment leurs médias" on storage.objects;
create policy "Artisans suppriment leurs médias"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'artisan-projects'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

notify pgrst, 'reload schema';
