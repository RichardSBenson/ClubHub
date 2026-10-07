# Instructors

## One profile, one card
Every person has the same profile page and the same digital membership card: photograph, name, and the same
details. "Instructor" is not a different page. It is a tick on the person that adds an **Instructor** badge to
the same header on the profile, the card and the card-check screen.

## Who can tick it
An owner or administrator at the person's dojo, or anyone above them in the tree (a region or the federation).
Not a registrar, and not the person themselves. Ticking is recorded with a date; unticking ends the role today
(the history stays) and takes them off the website.

## Three separate facts
- **Instructor**: the tick above (who they are).
- **Cleared to teach**: worked out from first aid, police vetting and similar dates under Compliance. It warns; it never blocks.
- **Shown on the website**: a separate consent tick on the Instructors screen. Giving somebody the job is not
  agreement to a public page. Under-18s cannot be listed.

## Choosing instructors: from the roll
There is no separate instructors list to keep. Instructors are chosen on the **roll** itself (`/o/:slug/roster`), at any level:

- **Filter** by grade (every grade, all black belts, or one grade), age (juniors under 18 / seniors) and *Instructors only*.
  Highest grade first. At a region or the federation the roll covers every dojo beneath it and shows the dojo.
- **Tick** people (or *Select everyone shown*, which works without scripts), then press one of:
  **Make instructors and show on the website**, **Make instructors only**, or **Take off as instructors**.
  Each person is dealt with at their own dojo, so a region or the federation can do it for several dojos at once.
- The **Instructor** column says who holds the role, who is on the website, and what is holding the others back.
- The old `/instructors` address redirects to the roll filtered to instructors.

**Who is actually shown.** "Show on the website" only shows people who are ready: 18 or over, every check the federation
requires of instructors current (for MOKNZ: first aid, police vetting, child protection; set under Compliance), and a
write-up (below). Everyone else still becomes an instructor, but is held back, and the screen names each person and
exactly what is missing ("Still needs First aid certificate, a write-up about themselves"). Once they have it, tick them
and press the button again. Their current checks are listed on the card automatically. People on another dojo's roll are
refused by name. Who can do it: an owner or administrator of the dojo, or anyone above (region, federation). A registrar
or the instructor themselves cannot.

There is no per-person form: the card is built from the person's own profile (photograph, grade, write-up,
checks). The older single-person tick on a profile still works.

## The 280-character write-up
Every person has a **few words about yourself** box on their own *My details* page, up to 280 characters. It is the
text on their instructor card (it replaces the longer "About them" box if both exist). Nothing else uses it. The picker
shows "no write-up yet" beside instructors who have not written one.

## The photograph
One photograph on the person's record, used on their card and on the website. The person, a parent or guardian, or
an official who keeps the register can add it, and must confirm the person (or their guardian) agrees. The
agreement is noted against the picture. Aim for a 600 × 600 square, face in the upper half.

## The instructor card (same everywhere)
On the dojo's page ("Your instructors") and the Instructors page: photograph, name, title and grade, what they
teach, "Training since", a short piece about them (about 280 characters on a dojo page, in full on the
Instructors page), and the checks they chose to show. Checks are the current first aid, police vetting and
similar qualifications; they show only if the instructor's profile says so.

## Not built yet
Qualifications held outside the federation's list, languages spoken, and a "meet your instructor" page per person.
