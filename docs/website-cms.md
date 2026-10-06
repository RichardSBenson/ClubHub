# Website CMS: forms, FAQs and scheduled publishing

## FAQ and contact-form blocks
Written in the page editor's one box:

    {{faq heading=Questions}}
    ? Do I need to bring anything?
    A gi if you have one; otherwise loose clothing.
    {{/faq}}

    {{contact kind=trial heading="Try a free class" intro="Tell us who it's for."}}

## The free-trial panel
A big "try a free class" panel that can be dropped into any page:

    {{trial club=whanganui heading=Try_a_free_class text=Your_first_class_is_free button=Book_now}}

With `club=` the button goes to that club's trial enquiry form (`/enquire/<club>?kind=trial`); without it, to
Find a dojo so the visitor can pick their nearest. Underscores stand for spaces. Everything is optional.

`kind=trial` adds a "who is it for" field and does not require a message. The FAQ is also published as
schema.org JSON-LD so search engines can show the answers.

## Enquiries
The form posts to `/enquire/<club-slug>`; the same address with GET is a standalone form
(`?kind=trial` for the free-class version) that can be linked from posters and social posts.

* Stored first, emailed second. The email goes to the club's contact address (Club details), or, if there
  is none, to up to three owners/administrators. Replying answers the visitor. If email fails the
  enquiry is still in **Enquiries** in the admin (registrar and above).
* Protection: same-site check (stands in for CSRF, since visitors have no session), a hidden `website`
  box that only robots fill in (they get a normal "thank you" and nothing is stored), at most 5 per
  visitor per hour and 60 per club per day, field length limits, more than two links refused.
  Visitor text only ever goes in the email body.
* Privacy: the visitor's address is stored only as a salted hash (set `ENQUIRY_SALT`; falls back to
  `CRON_SECRET`), cleared after two days. Enquiries are deleted after a year. Both happen in the daily cron.

## Scheduled publishing
Owners and administrators can give a draft page or news article a date (today to a year ahead, in the
club's time zone) from the editor: **Save and schedule**, **Change the date**, **Cancel the schedule**.
Publishing by hand clears the schedule.

`GET /cron/publish` (daily at 17:00 UTC, about 6am NZ) publishes everything due, records "published on
schedule" in the audit log, and asks for one site rebuild. It uses the same `CRON_SECRET` bearer lock as
`/cron/renewals`. Vercel Hobby crons run once a day, so a schedule means "that morning", not a time of day.
