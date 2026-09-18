drop extension if exists "pg_net";

drop policy "email_templates_select_all" on "public"."email_templates";

drop policy "email_templates_write_org" on "public"."email_templates";

drop policy "people_update_owner" on "public"."people";

alter table "public"."applications" drop constraint "applications_check";

drop view if exists "public"."mailing_recipients";


  create table "public"."telegram_login_tokens" (
    "token" text not null,
    "token_status" text not null default 'pending'::text,
    "telegram_id" bigint,
    "telegram_username" text,
    "session_hashed_token" text,
    "created_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone not null default (now() + '00:10:00'::interval)
      );


alter table "public"."telegram_login_tokens" enable row level security;


  create table "public"."whitelisted_usernames" (
    "username" text not null,
    "added_by" uuid,
    "note" text,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "preferred_full_name" text
      );


alter table "public"."whitelisted_usernames" enable row level security;

alter table "public"."applications" add column "abstract_file_has_images" boolean;

alter table "public"."speakers" drop column "course";

alter table "public"."speakers" add column "city" text;

alter table "public"."speakers" add column "course_number" text;

alter table "public"."speakers" add column "education_level" text;

CREATE UNIQUE INDEX telegram_login_tokens_pkey ON public.telegram_login_tokens USING btree (token);

CREATE UNIQUE INDEX whitelisted_usernames_pkey ON public.whitelisted_usernames USING btree (username);

alter table "public"."telegram_login_tokens" add constraint "telegram_login_tokens_pkey" PRIMARY KEY using index "telegram_login_tokens_pkey";

alter table "public"."whitelisted_usernames" add constraint "whitelisted_usernames_pkey" PRIMARY KEY using index "whitelisted_usernames_pkey";

alter table "public"."telegram_login_tokens" add constraint "telegram_login_tokens_token_status_check" CHECK ((token_status = ANY (ARRAY['pending'::text, 'verified'::text, 'denied'::text, 'expired'::text]))) not valid;

alter table "public"."telegram_login_tokens" validate constraint "telegram_login_tokens_token_status_check";

alter table "public"."whitelisted_usernames" add constraint "whitelisted_usernames_added_by_fkey" FOREIGN KEY (added_by) REFERENCES public.people(id) not valid;

alter table "public"."whitelisted_usernames" validate constraint "whitelisted_usernames_added_by_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.check_login_token(p_token text)
 RETURNS TABLE(token_status text, session_hashed_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- Fix: Explicitly qualify the table name in the WHERE clause
  update telegram_login_tokens
  set token_status = 'expired'
  where telegram_login_tokens.token = p_token
    and telegram_login_tokens.token_status = 'pending'
    and telegram_login_tokens.expires_at < now();

  return query
  select t.token_status, t.session_hashed_token
  from telegram_login_tokens t
  where t.token = p_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_login_token_v2(token text)
 RETURNS TABLE(valid boolean, user_id uuid)
 LANGUAGE plpgsql
AS $function$
begin
  update telegram_login_tokens t
  set status = 'expired'
  where t.token = p_token
    and t.status = 'pending'
    and t.expires_at < now();

  return query
  select t.status, t.session_hashed_token
  from telegram_login_tokens t
  where t.token = p_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_login_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_token text;
begin
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into telegram_login_tokens (token) values (v_token);
  return v_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_any_lead(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (
    select 1 from committee_memberships
    where person_id = p_person and level = 'lead'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_committee_lead(p_person uuid, p_committee uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (
    select 1 from committee_memberships
    where person_id = p_person
      and committee_id = p_committee
      and level = 'lead'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_committee_member(p_person uuid, p_committee uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (
    select 1 from committee_memberships
    where person_id = p_person and committee_id = p_committee
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_moderators_committee_member(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (
    select 1
    from committee_memberships cm
    join committees c on c.id = cm.committee_id
    where cm.person_id = p_person
      and c.name = 'Модераторы/лекции/круглые столы'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_owner(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select coalesce((select is_owner from people where id = p_person), false);
$function$
;

CREATE OR REPLACE FUNCTION public.is_schedule_committee_member(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (
    select 1
    from committee_memberships cm
    join committees c on c.id = cm.committee_id
    where cm.person_id = p_person
      and c.name = 'Расписание секций'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_selection_committee_lead(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (
    select 1
    from committee_memberships cm
    join committees c on c.id = cm.committee_id
    where cm.person_id = p_person
      and cm.level = 'lead'
      and c.name = 'Отбор заявок'  -- точное имя комитета в таблице committees
  );
$function$
;

CREATE OR REPLACE FUNCTION public.log_content_post_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

create or replace view "public"."mailing_recipients" as  SELECT a.id AS application_id,
    string_agg(s.full_name, '; '::text ORDER BY s.sort_order) AS full_name,
    a.title AS talk_title,
    a.status AS application_status,
    a.contact_email,
    sec.name AS section_name,
    cd.day_date,
    ts.starts_at AS slot_starts_at,
    ts.ends_at AS slot_ends_at,
    ss.room,
    af.body AS feedback_body
   FROM (((((((public.applications a
     JOIN public.speakers s ON ((s.application_id = a.id)))
     LEFT JOIN public.talk_assignments ta ON ((ta.application_id = a.id)))
     LEFT JOIN public.section_slots ss ON ((ss.id = ta.section_slot_id)))
     LEFT JOIN public.sections sec ON ((sec.id = ss.section_id)))
     LEFT JOIN public.time_slots ts ON ((ts.id = ss.slot_id)))
     LEFT JOIN public.conference_days cd ON ((cd.id = ts.day_id)))
     LEFT JOIN public.application_feedback af ON ((af.application_id = a.id)))
  GROUP BY a.id, a.title, a.status, a.contact_email, sec.name, cd.day_date, ts.starts_at, ts.ends_at, ss.room, af.body;


CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

grant delete on table "public"."telegram_login_tokens" to "anon";

grant insert on table "public"."telegram_login_tokens" to "anon";

grant references on table "public"."telegram_login_tokens" to "anon";

grant select on table "public"."telegram_login_tokens" to "anon";

grant trigger on table "public"."telegram_login_tokens" to "anon";

grant truncate on table "public"."telegram_login_tokens" to "anon";

grant update on table "public"."telegram_login_tokens" to "anon";

grant delete on table "public"."telegram_login_tokens" to "authenticated";

grant insert on table "public"."telegram_login_tokens" to "authenticated";

grant references on table "public"."telegram_login_tokens" to "authenticated";

grant select on table "public"."telegram_login_tokens" to "authenticated";

grant trigger on table "public"."telegram_login_tokens" to "authenticated";

grant truncate on table "public"."telegram_login_tokens" to "authenticated";

grant update on table "public"."telegram_login_tokens" to "authenticated";

grant delete on table "public"."telegram_login_tokens" to "service_role";

grant insert on table "public"."telegram_login_tokens" to "service_role";

grant references on table "public"."telegram_login_tokens" to "service_role";

grant select on table "public"."telegram_login_tokens" to "service_role";

grant trigger on table "public"."telegram_login_tokens" to "service_role";

grant truncate on table "public"."telegram_login_tokens" to "service_role";

grant update on table "public"."telegram_login_tokens" to "service_role";

grant delete on table "public"."whitelisted_usernames" to "anon";

grant insert on table "public"."whitelisted_usernames" to "anon";

grant references on table "public"."whitelisted_usernames" to "anon";

grant select on table "public"."whitelisted_usernames" to "anon";

grant trigger on table "public"."whitelisted_usernames" to "anon";

grant truncate on table "public"."whitelisted_usernames" to "anon";

grant update on table "public"."whitelisted_usernames" to "anon";

grant delete on table "public"."whitelisted_usernames" to "authenticated";

grant insert on table "public"."whitelisted_usernames" to "authenticated";

grant references on table "public"."whitelisted_usernames" to "authenticated";

grant select on table "public"."whitelisted_usernames" to "authenticated";

grant trigger on table "public"."whitelisted_usernames" to "authenticated";

grant truncate on table "public"."whitelisted_usernames" to "authenticated";

grant update on table "public"."whitelisted_usernames" to "authenticated";

grant delete on table "public"."whitelisted_usernames" to "service_role";

grant insert on table "public"."whitelisted_usernames" to "service_role";

grant references on table "public"."whitelisted_usernames" to "service_role";

grant select on table "public"."whitelisted_usernames" to "service_role";

grant trigger on table "public"."whitelisted_usernames" to "service_role";

grant truncate on table "public"."whitelisted_usernames" to "service_role";

grant update on table "public"."whitelisted_usernames" to "service_role";


  create policy "email_templates_delete_org"
  on "public"."email_templates"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid()))));



  create policy "email_templates_insert_org"
  on "public"."email_templates"
  as permissive
  for insert
  to authenticated
with check (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "email_templates_update_org"
  on "public"."email_templates"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid()))))
with check ((EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid()))));



  create policy "whitelisted_usernames_select_all"
  on "public"."whitelisted_usernames"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid()))));



  create policy "whitelisted_usernames_write_owner"
  on "public"."whitelisted_usernames"
  as permissive
  for all
  to authenticated
using (public.is_owner(auth.uid()))
with check (public.is_owner(auth.uid()));



  create policy "people_update_owner"
  on "public"."people"
  as permissive
  for update
  to authenticated
using (public.is_owner(auth.uid()))
with check (public.is_owner(auth.uid()));



  create policy "application_files_delete_org"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'application-files'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "application_files_insert_org"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'application-files'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "application_files_select_all"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'application-files'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "application_files_update_org"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'application-files'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))))
with check (((bucket_id = 'application-files'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "content_media_delete_org"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'content-media'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "content_media_insert_org"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'content-media'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "content_media_select_all"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'content-media'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "content_media_update_org"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'content-media'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))))
with check (((bucket_id = 'content-media'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "generated_documents_files_insert_org"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'generated-documents'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



  create policy "generated_documents_files_select_all"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'generated-documents'::text) AND (EXISTS ( SELECT 1
   FROM public.people
  WHERE (people.id = auth.uid())))));



