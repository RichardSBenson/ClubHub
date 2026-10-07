# The app on a phone, and notifications

## Installing

Every signed-in page links a web app manifest, so a phone offers **Add to Home Screen** and it opens like an app, starting at My details (`/me`). The manifest, three icons (drawn at build time: a white H on the app colour) and an offline page are written into the static site by the build. A federation can overwrite the icons with its own after the build.

The service worker (`/sw.js`) does two things and nothing else: shows the offline page when there is no connection, and shows notifications. **It caches no pages.** Signed-in pages hold personal details and are never stored on the device by the app.

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
