# Content types

## The line this draws

```
A federation controls WHAT it records.   configurable
The theme controls HOW it is laid out.   fixed
```

A registrar can add a **Kata** type with the fields they want, and the pages
that display kata are generated from it. Nobody needs a developer.

What nobody can do is drag a carousel into the middle of a dojo page. A canvas
is how volunteer-run organisations end up with broken sites, and it is a
different product.

## Types are inherited

A type defined by a national body is available to every dojo beneath it. Define
**Instructor** once and seventeen dojo have it.

A dojo can override — its own definition wins, and the parent's is untouched.
Whanganui can call theirs *Sensei* and add a field, without anyone else seeing
either change.

## Field types are narrow on purpose

`text · longText · richText · number · date · boolean · choice · image ·
document · link · reference`

Every one has to render sensibly in a form, on a page, in an export and in
structured data. Each addition is a permanent commitment, so the list stays
short.

## Routing is chosen, not invented

```
underType            /kata/pinan-sono-ichi
topLevel             /pinan-sono-ichi
underOrganisation    /whanganui/instructors/jane-smith
none                 no page of its own
```

Four options. A federation inventing its own URL scheme is how a site ends up
with `/Content/Item.aspx?id=47`.

## Breaking changes are named, counted, and refused

Adding a field just works.

Removing one, changing its type, making an optional field required, or dropping
a choice does not — it comes back with what would break and how many entries
are affected:

```
removing "Introduced at" discards data already entered
14 entries use this type
```

It can still be done, with `acceptBreaking: true`, and the consequences are
returned rather than hidden. The point is that nobody does it by accident.

## Two decisions worth keeping

**Slugs do not follow the title.** A slug is derived once and kept. Letting it
track the title means every corrected headline silently moves a page and breaks
every link to it.

**A partial update is judged on the result.** Sending one field merges it and
validates the whole entry, so an update cannot quietly leave a required field
empty.

## The bug Postgres caught

The use case looked up the existing type with `byName`, which resolves
inheritance. So when a dojo overrode a national type, it found the *parent's*
definition and tried to save over its id.

The in-memory adapter allowed it. Postgres rejected it on the primary key.

The fix was a second method, `ownedBy` — the type this organisation owns, never
an inherited one. Overriding creates a new type; it does not edit the parent's,
and breaking changes are judged against what this organisation had before.
