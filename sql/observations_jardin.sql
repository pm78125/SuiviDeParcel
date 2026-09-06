-- À exécuter une fois dans Supabase → SQL Editor
-- Liste Faune & Flore (indépendante des arbres / inventaire)

create table if not exists public.observations_jardin (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('faune', 'flore')),
  espece text not null,
  notes text,
  date_observation date default current_date,
  created_at timestamptz not null default now()
);

create index if not exists observations_jardin_type_idx
  on public.observations_jardin (type);

create index if not exists observations_jardin_espece_idx
  on public.observations_jardin (espece);

alter table public.observations_jardin enable row level security;

drop policy if exists "observations_jardin_select_all" on public.observations_jardin;
drop policy if exists "observations_jardin_insert_all" on public.observations_jardin;
drop policy if exists "observations_jardin_update_all" on public.observations_jardin;
drop policy if exists "observations_jardin_delete_all" on public.observations_jardin;

-- Même modèle ouvert que le reste de l’app jardin (clé anon / publishable)
create policy "observations_jardin_select_all"
  on public.observations_jardin for select using (true);
create policy "observations_jardin_insert_all"
  on public.observations_jardin for insert with check (true);
create policy "observations_jardin_update_all"
  on public.observations_jardin for update using (true) with check (true);
create policy "observations_jardin_delete_all"
  on public.observations_jardin for delete using (true);

grant select, insert, update, delete on public.observations_jardin to anon, authenticated;
