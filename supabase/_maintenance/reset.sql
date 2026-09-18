-- Полный снос всех таблиц/типов/функций проекта "СоцПоляна" перед повторным накатом.
-- Выполнить одним запросом в SQL Editor.

drop schema if exists supabase_migrations cascade;

-- Документы
drop table if exists generated_documents cascade;
drop type if exists generated_document_type cascade;

-- Коммуникации
drop view if exists mailing_recipients cascade;
drop table if exists email_templates cascade;

-- Расписание/распределение
drop view if exists slot_capacity_warnings cascade;
drop view if exists talk_display_ids cascade;
drop table if exists talk_assignments cascade;
drop table if exists section_slot_moderators cascade;
drop table if exists external_experts cascade;
drop table if exists section_slots cascade;
drop table if exists section_day_numbers cascade;
drop table if exists sections cascade;
drop table if exists time_slots cascade;
drop table if exists conference_days cascade;

-- Заявки
drop table if exists application_feedback_sends cascade;
drop table if exists application_feedback cascade;
drop table if exists application_comments cascade;
drop view if exists application_read_counts cascade;
drop table if exists application_reads cascade;
drop table if exists application_text_revisions cascade;
drop table if exists speakers cascade;
drop table if exists applications cascade;
drop type if exists application_status cascade;
drop table if exists universities cascade;

-- Контент-план
drop table if exists content_post_revisions cascade;
drop table if exists content_post_media cascade;
drop view if exists content_posts_bank cascade;
drop table if exists content_posts cascade;
drop type if exists content_status cascade;
drop type if exists content_platform cascade;

-- Комитеты/тикеты
drop view if exists ticket_actionable_by cascade;
drop table if exists auto_ticket_rules cascade;
drop table if exists ticket_comments cascade;
drop table if exists ticket_recipients cascade;
drop table if exists tickets cascade;
drop type if exists ticket_source cascade;
drop type if exists ticket_status cascade;
drop table if exists committee_memberships cascade;
drop type if exists committee_level cascade;
drop table if exists committees cascade;
drop table if exists people cascade;

-- Общие функции
drop function if exists set_updated_at() cascade;
drop function if exists is_owner(uuid) cascade;
drop function if exists is_committee_lead(uuid, uuid) cascade;
drop function if exists is_any_lead(uuid) cascade;
drop function if exists is_committee_member(uuid, uuid) cascade;
drop function if exists is_selection_committee_lead(uuid) cascade;
drop function if exists is_schedule_committee_member(uuid) cascade;
drop function if exists is_moderators_committee_member(uuid) cascade;
drop function if exists log_content_post_revision() cascade;
