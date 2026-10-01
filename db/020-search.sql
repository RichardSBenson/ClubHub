-- applied-when: select exists (select 1 from pg_proc where proname = 'fold')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Finding things, and finding them when the macrons are missing
--
--  A register in New Zealand holds Tāmati, Ngāti, Whanganui, Māori. People
--  type Tamati. A search that misses somebody because the person typing it
--  has no macron key is not a search, and telling a club secretary to type
--  ā is not an answer.
--
--  The same applies the other way: the roll may hold "Tamati" because
--  whoever imported the spreadsheet had no macrons either, and somebody
--  careful typing "Tāmati" should still find them.
--
--  So both sides are folded to plain letters before comparing.
--
--  This uses translate() rather than the unaccent extension on purpose. The
--  characters that matter here are a known, short list — the five Māori
--  vowels, plus the common European ones and the long vowels that turn up in
--  romanised Japanese: dōjō, Kyokushin, bushidō. translate() needs no
--  extension, which means no migration that can fail on a hosted database
--  that does not have one installed. A deployment broke this morning over a
--  missing table; it is not going to break again over a missing extension.
--
--  Marked immutable so it can be used in an index later. It genuinely is:
--  the same input always gives the same output, and the mapping is written
--  here rather than read from a collation that could change under it.
--
--  No index yet, deliberately. A federation with a few hundred people is
--  scanned in under a millisecond, and an index on an expression is a thing
--  somebody has to maintain. Worth adding around ten thousand people, which
--  is roughly where a sequential scan starts to be felt — and at that point
--  pg_trgm is the right tool rather than more of this.
-- ===========================================================================

create or replace function fold(value text) returns text
language sql immutable strict parallel safe as $$
  select translate(
    lower(value),
    'āēīōūãáàâäåéèêëíìîïóòôöõúùûüñçýÿšžœæ',
    'aeiouaaaaaaeeeeiiiiooooouuuuncyyszoa')
$$;

comment on function fold(text) is
  'Lowercased and stripped of the diacritics a New Zealand martial arts '
  'register actually contains, so that "Tamati" finds "Tāmati" and the '
  'reverse. translate rather than unaccent so no extension is required.';
