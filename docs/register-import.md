# Loading the dojo register

The federation's dojo (venue, address, contact, class times) and their instructors are loaded from three CSV
files, the same ones in `import/`: `clubs.csv`, `sessions.csv`, `instructors.csv`.

**In the app (the way to do it on the live site):** Clubs → *Import dojo, class times and instructors from CSV
files* (`/o/<federation>/register-import`). Paste the contents of each file, press **Preview**, read what would
happen, then **Save these changes**. The preview is the real import followed by a rollback, so what it shows is
what saving does. Owners and administrators of the federation only; a club cannot use it.

**On the command line:** `node import/import.mjs clubs.csv sessions.csv instructors.csv` against whatever
`DATABASE_URL` points at. Same code, saved straight away.

Rules, both ways:
- Blank means unknown and stays NULL. Nothing is invented to make a page look finished.
- A dojo is published only if `publish` is `yes` **and** it has an address (or at least a suburb), class times, and a
  phone or email. Otherwise it is held back and the screen names what is missing.
- A dojo the register does not know is added beneath the federation. `country` and `timezone` columns are for dojo
  outside the federation's own country (Japan: `JP`, `Asia/Tokyo`).
- Class times for a dojo are replaced by the file's. Instructors are found by name, never duplicated, and the same
  name at two dojo is one person (set `distinct` to `yes` when it is not). Grades are recorded as held on joining,
  not awarded.
- Instructors are members of their dojo who also instruct: a membership (at their home dojo; a person is a member of one dojo only) and the instructor role (at every dojo they teach at). They go on the roll only. Showing them on the website still needs their consent, a write-up and current checks.
- Saving is written to the audit log.
