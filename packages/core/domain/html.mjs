/**
 * The one way to make text safe to place in HTML. Every screen, the public site and the content blocks use this
 * rather than their own copy, so a fix to it is a fix everywhere.
 */
export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
