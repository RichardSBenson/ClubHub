# Event banners, event pages and dojo galleries

## Event types
When someone adds an event they pick what it is from the federation's list:

Training Camp (North Island, South Island), Shinsa (North Island, South Island), Nationals, Kyu Grading,
Seminar, Dojo Operators Meeting. The list lives in `packages/core/domain/event-types.mjs`.

Picking a type sets the event's kind and, if the title is left blank, its title ("North Island Training
Camp"). For a Seminar the title is shown above the word SEMINAR, so say what it is.

## The banner is text
The crest plus up to three lines: the region or qualifier (grey), the event name (accent colour), and the
date (grey). Change the date and the banner is right; there is no picture of words to redo. It is used large
on the event page and small in lists, on the federation's events page and on each dojo page.

The crest is set once, under **Appearance → Crest** (owner or administrator). It also appears in the site header.
A transparent PNG on a dark background works best.

## Beside it: details, map, contacts
Each event can carry a contact name, phone and email, a cost in words, a link for more information (https only),
and an optional map pin (latitude and longitude). The page shows When, Where, Cost, Entries close, Contact and
More information, then a map. With a pin the map is an OpenStreetMap embed; without one there are
"Open in Google Maps" and "OpenStreetMap" links built from the venue and address. Entering is offered while
entries are open.

## Local events
A dojo's own events have a page under the dojo (`/<dojo>/events/<event>`) and appear on its page without anyone
at the federation approving them. To also appear on the federation's calendar the dojo asks, and the federation
decides, as before.

## Dojo galleries
**Gallery** in a dojo's admin menu: add many pictures at once, file them by **year** and by **event** (one of the
dojo's own events), caption them, put them in order, remove them. Up to 300 per dojo.

- *Adding.* Pick several files, choose a year and/or an event, press Add. With an event and no year, the pictures take
  the event's year. A file that is not a picture is skipped and named; the rest go in.
- *Big photos.* A small script (`/vendor/gallery-upload.js`, same-origin so the CSP is unchanged) shrinks each picture
  in the browser to 2000 px and sends them one at a time, with a progress list. Without scripts the plain form still
  works, but the host's request-size limit applies (about 4.5 MB on Vercel), so shrink first.
- *Tidying.* Filter by year or event, tick pictures and file them under a year/event, or remove them together. Each
  picture also has its own caption, year and event form. Moving earlier/later works inside its year and event.
- *Public.* The dojo page shows the first 8 as "In the dojo" with a link to the dojo's own gallery page
  (`/<dojo>/gallery`), where clicking a photo opens it full-screen (arrows, swipe, Esc; without scripts it opens the full file). It has a button per year (newest first) and each event as a heading linked to its page.
  A dojo with no pictures has no gallery page. Sizes are in `website-images.md` (aim for 1200 × 800).

Adding a new picture needs an owner or administrator (uploading is limited to them); choosing one already in the
library does not.

## Several of the same event
A dojo can run as many events with the same title as it likes (three kyu gradings a year, for juniors and for
seniors). The form has no web address box: one is made from the title and, if that is taken, the date as well
(`kyu-grading-2026-11-14`). The only thing refused is the same kind of event starting at the same moment, which is
almost certainly a double entry; the message names the event already there.

## About this event
The event form has an **About this event** box (up to 4000 characters). A blank line starts a new paragraph and a
single line break is kept. It is plain text: anything that looks like markup is shown as written, never run. It
sits under the one-line summary on the event page and is also put into the calendar entry.

## Add to calendar
Every event page that is not cancelled has an **Add to calendar** button. It downloads a small `.ics` file
(`/events/<event>/event.ics`, or `/<dojo>/events/<event>/event.ics`) that every phone and desktop calendar
opens. Times go out in UTC and the calendar shows them in the visitor's own time zone. An event with no end time is
left without one rather than given an invented length. The entry carries the title, the one-line summary and the
description, the venue and address, and a link back to the page.

## Not built yet
A gallery for the federation's own pages, a photo block inside pages, and recurring events.
