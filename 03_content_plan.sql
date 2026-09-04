-- ============================================================
-- СоцПоляна: контент-план
-- MVP-этап 1 (параллельно с тикетами)
-- ============================================================

create type content_status as enum ('idea', 'draft', 'ready', 'scheduled', 'published');
create type content_platform as enum ('telegram', 'vk');

create table content_posts (
  id uuid primary key default gen_random_uuid(),

  status content_status not null default 'idea',
  platform content_platform,  -- nullable: на стадии "идея" площадка может быть ещё не выбрана

  title text,        -- рабочее название/тема поста, для навигации по банку постов
  body text,          -- текущий текст поста

  -- Отложка — гибкая, не жёсткая привязка к расписанию публикаций
  scheduled_at timestamptz,  -- заполняется на стадии "запланирован"; null для idea/draft/ready
  published_at timestamptz, -- фиксируется по факту публикации

  created_by uuid not null references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    -- "запланирован" предполагает наличие даты; "опубликован" — тоже,
    -- но не блокируем жёстко на случай ретроактивной фиксации без даты
    (status != 'scheduled') or (scheduled_at is not null)
  )
);

create index idx_content_posts_status on content_posts(status);
create index idx_content_posts_platform on content_posts(platform);
create index idx_content_posts_scheduled on content_posts(scheduled_at) where status = 'scheduled';

-- "База постов" = view-фильтр статуса idea/draft, без обязательной даты —
-- это просто запрос по content_posts, отдельная таблица не нужна.
create view content_posts_bank as
  select * from content_posts where status in ('idea', 'draft');


-- ---------- МЕДИА-ВЛОЖЕНИЯ ----------
-- Несколько вложений на пост (карусель для тг/вк), порядок имеет значение.
-- Сами файлы — в Supabase Storage; здесь только ссылка + метаданные.
create table content_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references content_posts(id) on delete cascade,
  url text not null,          -- ссылка на файл в Supabase Storage (или внешняя, напр. Google Drive)
  caption text,                -- опционально: подпись/alt
  sort_order int not null default 0,
  uploaded_by uuid references people(id),
  created_at timestamptz not null default now()
);

create index idx_content_post_media_post on content_post_media(post_id);


-- ---------- ИСТОРИЯ РЕДАКТИРОВАНИЯ ----------
-- Снимок текста при каждом сохранении. Правится любым членом оргкомитета,
-- поэтому важно видеть, кто и когда менял текст (в отличие от заявок,
-- где версии — по факту повторной подачи, тут — по факту любого сохранения).
create table content_post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references content_posts(id) on delete cascade,
  body text not null,           -- текст поста на момент этой ревизии
  title text,
  edited_by uuid not null references people(id),
  edited_at timestamptz not null default now()
);

create index idx_content_post_revisions_post on content_post_revisions(post_id, edited_at desc);

-- Автосохранение ревизии при каждом изменении текста поста.
-- На INSERT редактор = автор поста (created_by); на UPDATE — текущий пользователь (auth.uid()).
create or replace function log_content_post_revision()
returns trigger
language plpgsql
security definer
as $$
declare
  v_editor uuid;
begin
  if tg_op = 'INSERT' then
    v_editor := new.created_by;
  else
    v_editor := auth.uid();
  end if;

  if (tg_op = 'INSERT') or (new.body is distinct from old.body) or (new.title is distinct from old.title) then
    insert into content_post_revisions (post_id, body, title, edited_by)
    values (new.id, new.body, new.title, v_editor);
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_content_post_revision
  before insert or update on content_posts
  for each row
  execute function log_content_post_revision();
