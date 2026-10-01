# EasyMDE 2.21.0 — vendored

MIT licensed. The full licence is in `LICENSE` beside this file.

Two files, copied unchanged from the npm package `easymde@2.21.0`:

    easymde.min.js    327 KB   (CodeMirror is bundled inside it)
    easymde.min.css    13 KB

## Why these are in the repository rather than installed

The only runtime dependency this project has is `pg`, and that is worth
keeping. These are browser files, not a Node package: nothing imports them,
the build does not process them, and `npm install` does not fetch them.

They are served from our own origin rather than a CDN. The admin's
Content-Security-Policy is `default-src 'self'`, so a script from this origin
is already allowed and nothing had to be relaxed to let this in. A CDN would
have meant loosening that policy on the screen where the most sensitive
editing happens, and trusting somebody else's uptime for an editor used in
halls with bad reception.

## What it is used for

It enhances the plain `<textarea>` on the page and news editors with a
toolbar and a live preview. With scripts off, the textarea is still there and
still works — which is the point. EasyMDE produces markdown TEXT, never HTML,
and that text is parsed into blocks by `packages/content/document-text.mjs`.
The block document stays the thing that is stored.

The toolbar is configured in the admin with text labels rather than icons,
because the stock configuration expects Font Awesome and vendoring a webfont
to draw a letter B was not a trade worth making.

## Updating

    npm pack easymde
    tar xzf easymde-*.tgz
    cp package/dist/easymde.min.{js,css} vendor/easymde/
    cp package/LICENSE vendor/easymde/LICENSE

Then run the suite: `packages/content/test-document-text.mjs` covers the
conversion, which is the part that can lose somebody's writing.
