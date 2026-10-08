-- 051 — one parent is the main contact for a child, and the others can be copied in.
-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'guardian_link' and column_name = 'is_main_contact')
--
-- With no main contact set nothing changes: club messages for a child go to every linked parent, as before.
-- Once one parent is the main contact, messages go to them alone, plus any parent marked "also copy".

alter table guardian_link add column if not exists is_main_contact boolean not null default false;
alter table guardian_link add column if not exists also_copy boolean not null default false;
create unique index if not exists one_main_contact on guardian_link (child_id) where is_main_contact and ended_on is null;
