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
**Gallery** in a dojo's admin menu: add pictures (new, or from the dojo's own library), caption them, put them in
order, remove them. Up to 24. They show as "In the dojo" on the dojo's page once there is at least one, whatever
layout the federation saved. Sizes are in `website-images.md` (aim for 1200 × 800).

Adding a new picture needs an owner or administrator (uploading is limited to them); choosing one already in the
library does not.

## Not built yet
A written description for an event beyond the one-line summary, an "add to calendar" file, a gallery for the
federation's own pages, and a photo block inside pages.
