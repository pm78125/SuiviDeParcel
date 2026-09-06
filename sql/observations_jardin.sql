-- Faune & flore : tables + colonnes photo / catégorie animale
-- Exécuter une fois dans Supabase → SQL Editor

-- Observations
create table if not exists public.observations_jardin (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('faune', 'flore')),
  espece text not null,
  notes text,
  date_observation date default current_date,
  categorie text,
  image_url text,
  created_at timestamptz not null default now()
);

alter table public.observations_jardin
  add column if not exists categorie text;
alter table public.observations_jardin
  add column if not exists image_url text;

create index if not exists observations_jardin_type_idx
  on public.observations_jardin (type);
create index if not exists observations_jardin_espece_idx
  on public.observations_jardin (espece);

alter table public.observations_jardin enable row level security;

drop policy if exists "observations_jardin_select_all" on public.observations_jardin;
drop policy if exists "observations_jardin_insert_all" on public.observations_jardin;
drop policy if exists "observations_jardin_update_all" on public.observations_jardin;
drop policy if exists "observations_jardin_delete_all" on public.observations_jardin;

create policy "observations_jardin_select_all"
  on public.observations_jardin for select using (true);
create policy "observations_jardin_insert_all"
  on public.observations_jardin for insert with check (true);
create policy "observations_jardin_update_all"
  on public.observations_jardin for update using (true) with check (true);
create policy "observations_jardin_delete_all"
  on public.observations_jardin for delete using (true);

grant select, insert, update, delete on public.observations_jardin to anon, authenticated;

-- Catégories animaux (oiseaux, insectes, …)
create table if not exists public.categories_faune (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  created_at timestamptz not null default now()
);

alter table public.categories_faune enable row level security;

drop policy if exists "categories_faune_select_all" on public.categories_faune;
drop policy if exists "categories_faune_insert_all" on public.categories_faune;
drop policy if exists "categories_faune_update_all" on public.categories_faune;
drop policy if exists "categories_faune_delete_all" on public.categories_faune;

create policy "categories_faune_select_all"
  on public.categories_faune for select using (true);
create policy "categories_faune_insert_all"
  on public.categories_faune for insert with check (true);
create policy "categories_faune_update_all"
  on public.categories_faune for update using (true) with check (true);
create policy "categories_faune_delete_all"
  on public.categories_faune for delete using (true);

grant select, insert, update, delete on public.categories_faune to anon, authenticated;

insert into public.categories_faune (nom)
values
  ('Oiseaux'),
  ('Insectes'),
  ('Mammifères'),
  ('Amphibiens & reptiles'),
  ('Autres')
on conflict (nom) do nothing;
