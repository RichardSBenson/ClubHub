# Layouts: how a theme chooses a page design

A theme is still **data**: five colours, two fonts, the order of sections, and now one more field, `layout`,
which is a **name** from a list Honbu ships.

| layout     | what it is |
|------------|------------|
| `classic`  | The plain design every federation gets until it chooses another. A theme with no `layout` is classic. |
| `showcase` | The Mas Oyama prototype, built as it was approved: a belt stripe above a dark masthead with the crest, a hero with a "find your nearest dojo" box, a proof strip, the first-night explainer, the pathway, a photo band, the dojo grouped by region, the lineage story, event cards, the spotlight and a members band. A dojo's page has the same parts: facts with a call button, the times, who teaches here, your first night, what's on, photos, finding us, the enquiry form and the federation band. |

A theme **cannot supply** a layout. There is no CSS or HTML field, and an unknown name is refused. The markup
and stylesheet of a layout ship with Honbu (`packages/site/showcase.mjs`), so a theme file from a stranger can
still do nothing worse than look ugly.

## Choosing it

*Appearance* in the admin → **Dojo Showcase** → Use this theme. Or download `themes/showcase.json`, which any
other federation can import and then colour as its own. Without a stored theme, a flat-file install can set
`"layout": "showcase"` in `data/settings.json`.

## The words are the federation's

A layout carries no sentences. Everything a visitor reads comes from `data/settings.json` (or the federation's
stored settings), and **a section with nothing written is left out, never filled in**:

* `organisation`: `logo` (a file under `data/media`), `stripe` (belt colours), `wordmark` {main, sub}, `footerLine`, `eventsIntro`
* `homePage`: `stats`, `firstNight`, `pathway`, `quotes`, `photoBand`, `regions`, `lineage`, `spotlight`, `memberBand`
  (plus the existing `heroHeading`, `heroText`)
* `dojoPage`: `firstNight`, `federationBand` (plus the existing `startAnyWeekText`)

`{clubs}` in a line is the number of dojo with a published page.

## What it will not say for you

* **Quotes** are drawn only when real ones are written down, with a name. There are no bracketed placeholders.
* **"Your first class is free, at every dojo"** appears only when every published dojo has said its first class
  is free. A promise on fourteen businesses' behalf is somebody turning up expecting not to pay.
* **A link to a page that does not exist is not drawn.** Links are checked against the pages the site will have,
  and only paths on this site or `https://` addresses are accepted.
* **Pictures** are files under `data/media`, written `/media/name.jpg`. Nothing from another website is drawn.

## Not in the layout

* The prototype's newsletter sign-up: Honbu has no mailing list to post to, so a form would go nowhere.
* Fees on a dojo's page: there is no fee data to show.
* The prototype's content pages (Karate for kids, Learn, Dojo Kun, Child safety, Affiliate, the 50 Man Kumite,
  Start training, Members) are **pages a federation writes in the page editor**, and appear in the footer and the
  menu once written. They wear this masthead and footer.

## The prototype's content pages

`import/content-pages.json` holds the MOKNZ prototype's content pages as editable block documents (karate-for-kids, learn,
learn-belts, dojo-kun, safeguarding, affiliate, 50-man-kumite, start-training). They are stored as **drafts**: open
Pages in the admin, check the words, and publish. Placeholder notes from the prototype (`[EXEC ...]`) were left out
rather than published, and pictures are added in the editor.
