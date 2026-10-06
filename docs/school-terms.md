# School terms

Many clubs run children's classes by school term. Honbu keeps the term calendar for you, works out
the dates from where your organisation is, and lets families enrol children term by term.

## Where the dates come from

Terms belong to an organisation, normally the top one (the federation), and every club under it
inherits them. A club can set its own terms for a year, which replace the inherited ones for that
year only.

- **New Zealand** has a built-in calendar (state school terms, 2026 and 2027). The federation's
  country decides which calendar applies.
- **Other countries** have no built-in calendar. Honbu does not invent dates: a federation in
  Australia, the UK or the US adds its terms by hand (state and region differ too much to guess).
- Built-in dates follow the Ministry's published terms. Individual schools vary slightly, so the
  screen says so.
- **Automatic**: every day the cron loads this year's calendar into a federation that has one, and
  from September also next year's. A federation can turn this off (`settings.terms.auto = false`).

## Joining part-way through a term

Each club chooses how a child who starts mid-term is charged (Terms screen, "Joining part-way"):

| Mode | Price |
|---|---|
| Not allowed | Closed once the term has started |
| Full price | The whole term fee |
| By weeks left | Pro-rata on the weeks remaining |
| By classes left | Pro-rata on the training days remaining |
| Fixed | A set reduced price |

Pro-rata prices are rounded to the nearest 5 cents. The full-term price is the club's junior
"term" fee. With no term fee set, enrolment is free and simply recorded.

## Enrolment

- Separate from membership: a child is a member of the club, and enrolled in a term.
- A parent enrols from **School terms** in the family area; the home screen says when enrolment is
  open. Only a child's own family can enrol or withdraw them.
- Enrolling creates a bill; paying it (online or cash recorded by the club) marks the enrolment paid.
- Before the term starts, withdrawing cancels an unpaid bill; a paid one is left for the club to
  refund. Once it has started, the family asks the club.
- The club sees who is in each term, what they pay and whether they have paid.

## Offers

When a term is about to open, families whose children were in the previous term but are not yet in
the next get one email per club and term, linking to the enrolment page.

## Not built

- Term-specific class timetables.
- Holiday handling in rolls and attendance reports.
- Automatic re-enrolment or offers beyond the email.
- Calendars for countries other than New Zealand.
