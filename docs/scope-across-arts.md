# What this serves, and what it does not

Checked against Wikipedia's list of martial arts, which runs to hundreds of
styles across every region. The useful question is not "how many can we
support" but "which ones does this shape fit".

## The shape that fits

**Graded, syllabus-based arts governed by a federation.** Karate, judo, aikido,
kendo, iaido, taekwondo, tang soo do, hapkido, jujutsu, kuk sool won, Brazilian
jiu-jitsu, kung fu with sashes, capoeira with cordas.

They share the five things the product is built on:

1. A tree of affiliated schools under a governing body.
2. An ordered ladder of ranks with a published syllabus.
3. Grading as a controlled event, with authority rules about who may award what.
4. Time, age and attendance requirements between grades.
5. Certificates that people keep for life.

Nothing about the model is karate-specific. The ladder is per-organisation rows.
Taekwondo types geup instead of kyu. BJJ types its four stripes per belt as
separate rank orders with IBJJF minimum times. Capoeira types corda colours.

## The shape that does not fit

**Arts with no rank at all.** Boxing, Muay Thai in most lineages, MMA, wrestling,
sanda, luta livre. Progression there is a **fight record** — wins, losses, draws,
weight class, a sanctioning body licence — not a ladder.

Nothing in the schema holds that. `person_current_grade` is a left join, so
these degrade gracefully rather than breaking, but there is no substitute
offered.

**Deliberate decision: do not chase them.** A fight-record product is a different
product with different customers, and building for both is how the scope becomes
unbuildable. Revisit only if a kickboxing federation asks twice.

## Two gaps the list exposed — both now closed

### Titles are not grades — and how they are obtained differs too

Kendo, iaido, kyudo and most Japanese arts award **shogo** — Renshi, Kyoshi,
Hanshi — separately from dan grade. You can hold 7th dan without being Kyoshi.

**The schema could not represent that at all.** Now `title` and `title_award`
sit alongside grade, with `person_current_title` derived the same way
`person_current_grade` is, so a 7th dan who is not Kyoshi is representable.

MOKNZ turned out **not** to work that way, which is the more useful lesson.
There, Shihan, Renshi, Kyoshi and Hanshi are the names of the 5th to 8th dan
grades themselves — the ladder runs Shodan, Nidan, Sandan, Yondan, Shihan,
Renshi, Kyoshi, Hanshi. So "a Shihan must see this grading" is a rank rule,
not a title rule, and encoding it as a title would have been worse than
useless: seniority is cumulative and a title band is not, so the rule would
have turned a Hanshi away from a 1st kyu grading.

Both shapes are now supported and neither is assumed. Which one a federation
uses is its own data.

And the mechanism is configuration, not an assumption. I had modelled every
title as awarded, which is true of shogo and wrong of most others: Senpai,
Sensei and Shihan are **conferred by reaching a grade** — nobody awards them.
`conferred_by_rank` decides which, per title, per federation.

The vocabulary is not in the code either. Korean arts use Sabeom, Kyosa,
Kwanjang. Chinese arts Sifu and Sigung. BJJ uses Professor and Coach. Capoeira
uses Mestre and Contramestre. A federation types its own, chooses which are
conferred and which awarded, and nothing is compiled in.

### Qualifications expire; rank does not

A dan grade is permanent. A referee licence, a first aid certificate, a police
vet and child protection training all lapse — and a federation's real question
is *whose has*.

`qualification` carries a validity period; `qualification_award` fills its own
expiry from it; `qualification_status` classifies every one as permanent,
current, expiring within sixty days, or expired.

Which makes this a one-line query:

```
who may not instruct right now
  Tane Walker | Police vetting | expired
```

That is the safeguarding question every governing body is supposed to be able to
answer and most answer from memory. `required_for` tags each qualification with
what it gates — instruct, judge, panel — so the system can refuse rather than
remind.

## Nothing is called a dojo

Dojo is karate's and judo's word. A taekwondo school is a dojang, a kung fu
school a kwoon, a BJJ school an academy, a Muay Thai gym a gym.

The leaf organisation type is therefore `club` — a neutral token — and what a
federation *calls* its clubs is a label it configures. The website, the admin
and the membership card all read the same setting, so a Korean federation's
register says Dojang throughout and never once says dojo.

The same applies to the other words a system like this puts in front of people:
what a grading is called, what a grade is called. Any of them can be typed by
the federation, and anything left blank falls back to a neutral word rather
than to one art's vocabulary.

This was not true until it was checked. `rank_order >= 11` decided whether a
roster row was a black belt — eleven being where MOKNZ's dan grades start and
nobody else's. A link was external if its URL did not contain
"kyokushinkarate". The hero copy said Kyokushin in the shared renderer while
the settings file offered heading fields nothing read. Those are fixed; the
club and find-a-club page copy is not yet.

## The market, briefly

Kyokushin alone fragmented into a dozen world organisations after Sosai died,
each with national bodies beneath. Add Shotokan, Goju-ryu, Wado-ryu, Shito-ryu,
ITF and WT taekwondo, aikido's several streams, kendo federations, and BJJ's
affiliation networks.

Hundreds of style bodies worldwide, all with the same five needs and none of them
served. That is the addressable market — not "martial arts", which is far too
broad to build for.
