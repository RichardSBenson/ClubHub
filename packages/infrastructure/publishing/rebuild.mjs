/**
 * INFRASTRUCTURE — getting a published change onto the live site
 *
 * The public site is static. It is built once, at deploy, and served as files:
 * fast, free, perfect for search engines, and completely unaware that anybody
 * edited anything. So `publish` setting a column to 'published' changes what
 * the database says and nothing a visitor can see.
 *
 * This closes that gap. Publishing asks the host to rebuild, and about a
 * minute later the page is live. Editors do not wait on that — they have a
 * preview that renders the draft through the same code the site uses — so the
 * minute is spent where nobody is watching.
 *
 * Why a rebuild rather than serving pages from the database on request: a
 * federation's site is read by the public and by search engines far more often
 * than it is edited, and a static file beats a function call and a query on
 * every one of those reads. The trade is a delay on publish, which is the
 * cheap side.
 *
 * ## What this must never do
 *
 * Say it worked when it did not. A CMS that reports "published" while the
 * site is unchanged is worse than one that cannot publish at all, because
 * somebody will tell their club the newsletter is up. Every failure — no hook
 * configured, a refused request, a network that is not there — comes back as
 * itself and is shown to the person who pressed the button.
 */

/**
 * Where to ask for a rebuild.
 *
 * A Vercel deploy hook is a URL that starts a build when something POSTs to
 * it. It carries its own secret in the path, so it is a credential and lives
 * in an environment variable like any other.
 */
const hookUrl = () => process.env.REBUILD_HOOK_URL?.trim() || null;

export const isConfigured = () => !!hookUrl();

/**
 * How long a publish is allowed to wait on the host.
 *
 * Short on purpose. The hook only needs to ACCEPT the request; the build takes
 * a minute afterwards and nothing here waits for it. If the host has not
 * answered in a few seconds it is not going to, and the editor should be told
 * rather than left looking at a spinner.
 */
const TIMEOUT_MS = Number(process.env.REBUILD_TIMEOUT_MS ?? 6000);

/**
 * Ask for a rebuild.
 *
 * Returns { started, detail } and never throws. Publishing has already
 * succeeded by the time this runs — the row is written — so a failure here
 * must not undo it or look like it did. What it must do is say so.
 */
export async function requestRebuild({ reason = null } = {}) {
  const url = hookUrl();
  if (!url) {
    return { started: false, configured: false,
      detail: 'No rebuild hook is configured, so the change is saved but the '
        + 'public site will not show it until the next deploy. Set '
        + 'REBUILD_HOOK_URL to a Vercel deploy hook to publish directly.' };
  }

  const stop = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: stop,
      headers: { 'content-type': 'application/json' },
      // Vercel ignores the body; it is here so the build's own logs say what
      // asked for it, which is the difference between a mystery deploy and a
      // traceable one.
      body: JSON.stringify({ reason: reason ?? 'content published' }),
    });

    if (!response.ok) {
      return { started: false, configured: true,
        detail: `The host refused the rebuild (${response.status}). The change `
          + 'is saved; the site will show it at the next deploy.' };
    }

    return { started: true, configured: true,
      detail: 'The site is rebuilding. It usually takes about a minute.' };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { started: false, configured: true,
      detail: timedOut
        ? 'The host did not answer the rebuild request in time. The change is '
          + 'saved; the site will show it at the next deploy.'
        : `The rebuild could not be requested (${error?.message ?? error}). `
          + 'The change is saved.' };
  }
}
