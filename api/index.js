/**
 * Vercel entry point. One function, every admin route.
 *
 * Deliberately thin: everything real is in packages/, so this file never needs
 * editing from a phone.
 *
 * Two details here are load-bearing and easy to undo by accident:
 *
 *  - The extension is .js, not .mjs. package.json sets "type": "module", so
 *    this is still an ES module — but .js is the extension Vercel's function
 *    detection is reliably documented for, and a function that is not detected
 *    does not fail the build. It just quietly 404s.
 *  - The handler is declared here rather than re-exported straight through.
 *    Detection reads the shape of this file, so give it a function to see.
 */

import handler from '../packages/api/server.mjs';

export default function (request, response) {
  return handler(request, response);
}
