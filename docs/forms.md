# Forms and consent

A dojo or federation builds its own forms (waiver, photo consent, medical) from six plain question types: a statement to agree to, short answer, long answer, pick one, pick any, date. Three starters (waiver, photos, medical) are offered. Forms are ticked off on **Forms and consent** in the admin rail.

- **Who builds**: owner/administrator create, edit and publish; registrars can see who has signed. Forms of the organisation above (the federation's) are listed for information.
- **Who is asked**: published forms apply to everyone with a current membership at or below the form's organisation, narrowed by audience (everyone, juniors, seniors).
- **Who signs**: the person; for anyone under 18 a parent or guardian signs (a child cannot sign for themselves). The typed name, who signed, the form version, the time and IP are kept.
- **Renewal**: forms can be asked again every N months, or once. Editing wording does **not** ask anyone again; "Ask everyone to sign again" raises the version deliberately. Old answers are kept as history.
- **Chasing**: *Who has signed* lists signed / not signed / run out, filterable to those to chase, with a CSV download.
- **Medical answers** are readable only by those who run or teach at the person's dojo.
- Outstanding forms appear under "Action required" on the member home page.

Tables: `club_form`, `form_response` (migration 043). Code: `packages/core/domain/forms.mjs` (rules), `forms` in `packages/api/data.mjs`, routes `/o/:slug/forms…` and `/me/forms…`.
