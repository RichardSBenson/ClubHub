# Adult free trials and referrals

For the adult growth loop in the master list (§56, §58): website → trial → classes → join → refer a friend.
What a club offers is its own: nothing here names a price or a reward.

## The trial

A club turns it on at **Trials and referrals** in the side menu (administrators). Then
`/trial/<club>` is a public sign-up page: name, email, mobile, date of birth, an emergency contact,
anything the instructor should know, and the waiver. Link to it from the website, social media, or
print the address on a flyer. The admin screen shows the link.

What a sign-up creates is **a real person**, on a real membership whose status is `trial`:

- no member number (that comes when they join, so a month of curiosity never uses one up);
- a membership that lasts the club's trial days (30 by default);
- an account, and an email with a one-use sign-in link;
- the waiver recorded by name.

While trialling they can sign in, see the timetable, scan the class check-in code, and appear on the
instructor's roll like anyone else. They are **not** counted as members, have no card, and are not
chased for fees. On their home screen a banner counts down the days and links to **Join**.

**Rules**

- Adults only: the club's minimum age, default 18. Younger people go through the existing "try a class"
  enquiry and Newcomers screen.
- **Nobody is recorded twice.** Same email, same mobile (last 8 digits) or same name and birthday as
  anybody on the register — a member, a past entrant, a lapsed trial — and no new person is made. The
  page gives the same answer either way, so it cannot be used to find out who is registered; a sign-in
  link is sent only to an address that matches.
- A honeypot field, a same-site check, three trials an hour per visitor and thirty a day per club.

## Joining

**Join** on the member's home screen lists the club's own prices and asks for the first membership
payment through the existing payments. When it is paid (online or recorded by a registrar), the same
rows become a member: the status becomes `active`, a number is allocated, the paid period starts from
the day the trial ends, and the trial is marked converted. A registrar can equally use *Renewals* — the
trial people are on that list, tagged *Free trial*.

An ended trial can still join: it starts an ordinary membership that becomes active when paid.

## What the daily run does

On the existing `/cron/renewals` run:

| When | What |
|---|---|
| 7 days left | One email with a link to the join page |
| 2 days left | One more |
| After the last day | Trial ended, membership closed, an email saying what happens to their details |
| 180 days after ending | The person is removed if they never joined or paid. Their sign-in row is emptied rather than deleted, because the audit log is append-only and points at it |
| Always | Referrals still working towards the club's conditions are looked at again; reward emails are sent |

## Referrals

Turned on alongside the trial. A current member opens **Refer a friend** (link on their home screen) and
gets a code, a link `/r/<code>` and a QR code. Anyone following it lands on a page naming who invited
them and goes to the trial form with the code filled in. They can also type the code themselves.

The lifecycle is on the admin screen: **on their free month → joined → reward earned** (or **not counted**,
with the reason).

**A signup counts as a referral only if** the referrer is a current member of that club, the new person
does not share the referrer's email or mobile, and the referrer has not brought in a flood of people
today. A signup that does not count is still a trial; it just earns nobody a reward. An unknown code is
ignored without comment.

**The reward is paid when** the referred person has *paid and joined*, has attended the number of classes
the club asks for (default 3), the referrer is still a current member, and the referrer is under the club's
limit of rewards in a year (default 5). If they are still working towards the class count, the daily run
checks again for 60 days.

**Reward types** the club can choose, for each side: free weeks, account credit, event credit, grading
credit, merchandise, something else, or nothing. **Free weeks are added to the membership automatically.**
Everything else is listed under *Rewards to hand over* until somebody marks it given — there is no credit
balance in the system yet, so it is honest about that rather than pretending.

## Reporting

Trials started, trialling now, joined and the conversion rate of finished trials; referrals, how many
became members and earned rewards; money paid by referred members; top referrers.

## Not built

- **Weekly pricing and recurring payment setup** (the "$9.99 a week" example). The price list has
  annual, term and monthly; weekly and automatic recurring payments need the provider side of payments.
- **A trial booking block inside website pages.** The page is a link; a block in the page editor can embed it.
- **Choosing which classes a trial may attend.** Trialists see the same classes as members.
- **A club's own waiver wording.** The sign-up uses one general waiver sentence; the club's text is not yet configurable here.
- **Credit balances.** Account/event/grading credit is recorded as owed, not applied.
- **Texts and push notifications**, for the reminders.
- **Re-checking a referral after 60 days.** Past that, a referral that never reached its class count is left as is.
