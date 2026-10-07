-- 042 — a short write-up each person keeps about themselves (280 characters), used on their instructor card.
-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'person' and column_name = 'about')

alter table person add column if not exists about text check (about is null or char_length(about) <= 280);
