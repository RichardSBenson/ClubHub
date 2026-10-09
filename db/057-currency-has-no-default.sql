-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'payment' and column_name = 'currency' and column_default is null)
-- A price belongs to the organisation that set it, so the currency is always named when money is recorded. A silent
-- 'NZD' fallback would mislabel an Australian or British club's money the day somebody forgot to name it.
alter table event_fee alter column currency drop default;
alter table fee_schedule alter column currency drop default;
alter table invoice alter column currency drop default;
alter table payment alter column currency drop default;
alter table entry_price alter column currency drop default;
alter table event_entry alter column currency drop default;
alter table product alter column currency drop default;
alter table shop_order alter column currency drop default;
