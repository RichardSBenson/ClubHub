-- 052 — one linked adult can be the one who looks after a child's fees; aunts, uncles and other family can be linked.
-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'guardian_link' and column_name = 'pays_fees')
--
-- With nobody marked, every linked adult can see and pay what the child owes, as before. Once one is marked, payments and
-- renewal reminders go to them, and the other adults no longer see the fees.

alter table guardian_link add column if not exists pays_fees boolean not null default false;
create unique index if not exists one_fees_contact on guardian_link (child_id) where pays_fees and ended_on is null;
alter table guardian_link drop constraint if exists guardian_link_relationship_check;
alter table guardian_link add constraint guardian_link_relationship_check
  check (relationship in ('parent','step_parent','guardian','grandparent','aunt_uncle','other_family','carer'));
