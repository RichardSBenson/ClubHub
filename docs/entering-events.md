# Entering events

One idea: **enter personal information once, and only confirm what may have changed.**

## Members and parents (`/me/events`)
* A grading, seminar or camp has nothing to choose, so the offer in the list is itself the button.
* A tournament repeats last time's disciplines, weight and height in one press when the last weight is
  60 days old or less (`WEIGHT_VALID_DAYS`, `packages/core/domain/repeat-entry.mjs`) and the division
  worked out today is the same as last time.
* Anything different is shown, not carried over: a weight older than the limit, a different division
  ("Open 60-80 → Heavy 70-90"), something not offered this time, a first entry. The person gets the
  form with last time's answers filled in and the reason above it.
* A declaration is always shown. The one-click screen has one button, "I agree — enter", and the
  agreement is recorded in the name of the signed-in person.
* **Never reused, always worked out:** age on the day, current grade, and experience (past tournaments
  counted from entries, years from the roll).

## People on no roll (`/enter/<club>/<event>`)
For events the organiser has opened to outsiders ("People who are not on any roll may enter").

1. "Have you entered before?" — an email or mobile number. The answer is the same whoever it is, so
   the form cannot be used to find out who is on the register.
2. Known address (or a mobile whose last eight digits match): a sign-in link, landing on their entry.
3. Unknown email: a signed link (60 minutes, needs `ENTRY_SECRET` or `CRON_SECRET`) to a one-time
   registration form: name, date of birth, M/F. The person is created once; an address already known is
   refused a second record.
4. First entry asks club and grade, labelled as their own word (unverified), and charges the
   non-member price. After that it is one click, with club and grade remembered.
5. A child is entered with the parent's email; the declaration is agreed as a "declared guardian".

Not yet: SMS links (needs an SMS provider), verifying a claimed grade, a separate guardian record for
outsiders' children.
