# The app on a phone, and notifications

## Installing

Every signed-in page links a web app manifest, so a phone offers **Add to Home Screen** (and a small **Install the app** button appears in the footer where the browser supports it; on an iPhone the footer says to use Share, then Add to Home Screen). It opens like an app, starting at My details (`/me`), and long-pressing the icon offers shortcuts to My details, Events, Classes and the Shop.

The build writes the manifest, four icons (the federation's own crest on its dark colour, with extra margin on the maskable pair so a phone can crop them round; a plain H if the crest cannot be read), an offline page and the service worker into the static site. A federation can overwrite the icons with its own after the build.

## What works with no signal

The service worker (`/sw.js`) keeps three things, and says why in its own header:

1. **The shell**: the offline page, icons and the two small scripts.
2. **Public pages** (anything the server did not mark private): a club or event page opens again with no signal. Each visit refreshes it.
3. **Three signed-in pages, on purpose**: a member's own **membership card**, their **list of upcoming events** (the list only, never an entry form), and a club's **class roll** (the attendance list and each class's roll). Those are what must work in a hall or car park with no reception. They sit in their own cache on that device, are refreshed on every visit, and are **emptied when somebody signs out**.

Every other signed-in page goes straight to the network and, with no signal, shows the offline page. Signed-in pages are sent `Cache-Control: private, no-store`, which is also how the worker knows not to keep them.

**Taking the roll offline.** Open the attendance page while there is a signal (the day's class rolls are fetched in the background). In the hall, tick who came and press Save. If the server cannot be reached the roll is saved on the device, a bar says how many are waiting, and they are sent by themselves when the signal returns (or by pressing **Send now**). Saving a roll sets it to exactly who is ticked, so sending the same roll twice does no harm. A roll the server refuses stays on the device and is never discarded silently; signing out with an unsent roll asks first.

What still needs a connection: the rotating check-in code (it is signed by the server), and anything that changes money or membership.

Proven in a real browser: `packages/site/test-pwa-browser.mjs` turns the network off in Chromium and checks all of the above (it is skipped where no browser is installed).

## Notifications

Members turn them on from **My details → Notifications**, one device at a time, and can turn them off or remove a device there. Nothing is asked until they press the button. On an iPhone or iPad the site must first be added to the Home Screen.

What sends one today: a message from the dojo (the same moment the email goes), a place opening in a class someone is waiting for, and an automatic renewal payment failing. A child's notices go to their parents' devices. A device the push service says is gone is forgotten; a device that merely failed is counted and kept.

Messages are encrypted for the device (RFC 8291) and signed as coming from this site (VAPID, RFC 8292); the push service only carries them. It is plain `node:crypto`: no new packages.

### Switching it on

Push is **off until three settings exist** in the environment:

```
node tools/vapid-keys.mjs      # prints VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
```

Put the three values in the host's environment settings (the private key is a secret) and redeploy. Changing the pair later switches every device off until it is turned on again.

### What is and is not proven

The encryption and signing are tested end to end against our own receiver, and the delivery calls against a stand-in push service. It has not been tried against a real browser's push service from this build environment, so the first real test is to turn it on from a phone after deploying.
