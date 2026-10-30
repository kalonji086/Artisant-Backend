-- Le dashboard admin trie les profils par date de création.
-- Les lignes existantes reçoivent la date courante lors de l'ajout de la colonne.

begin;

alter table public.profiles
  add column if not exists created_at timestamptz not null default now();

create index if not exists profiles_created_at_idx
  on public.profiles(created_at desc);

commit;

notify pgrst, 'reload schema';
