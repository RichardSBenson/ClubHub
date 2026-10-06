# Website pictures: sizes and placeholders

The federation owns the look: colours, fonts, layout and calls to action are the same on every dojo
page. A dojo supplies its own words and pictures. With no picture, the page shows a designed
placeholder (the federation's colours), never a gap or a "photo here" note.

The site stores a picture exactly as uploaded and crops it to fit with CSS; it never stretches.
So aim for the sizes below. Bigger is fine (limit 5 MB, JPEG, PNG, GIF or WebP, not SVG).

| Picture | Aim for | At least | Shape | Where |
|---|---|---|---|---|
| Top-of-page | 2400 × 1000 | 1600 wide | 12:5 | Behind the heading on the home page and each dojo page |
| News / event | 1200 × 675 | 800 wide | 16:9 | Article top and lists |
| Gallery | 1200 × 800 | 800 wide | 3:2 | Dojo photo strip (not built yet) |
| Instructor | 600 × 600 | 400 wide | square | Instructors page |
| Link preview | 1200 × 630 | 1200 wide | 1.91:1 | Shared links (not built yet) |

Keep faces and action in the middle 60% of a top-of-page picture: phones show a narrow centre slice.

The sizes live in `packages/content/image-slots.mjs`. The same table is on the Images screen, a hint
sits beside each upload box, and a too-small or oddly shaped picture gets a warning after upload.

## Calls to action
A dojo that offers a free first class gets "Book your free class" in the hero, a closing band, and a
bar that stays at the bottom of a phone screen. It links to that club's trial form. Otherwise the
button is "Come to a class".

## Not built yet
Dojo photo gallery, link-preview pictures, the federation's home-page picture upload screen (the
renderer already shows `homePage.heroAssetId` if set), and an events form for dojo operators.
