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

### Titles are not grades

Kendo, iaido, kyudo and most Japanese arts award **shogo** — Renshi, Kyoshi,
Hanshi — separately from dan grade. You can hold 7th dan without being Kyoshi.

MOKNZ does this. Hanshi Doug Holloway. Kyoshi Mike Kenworthy. Kyoshi Graeme
Gavegan. Shihan Russell Dilloway.

**The schema could not represent its own customer's leadership.** Now `title`
and `title_award` sit alongside grade, with `person_current_title` derived the
same way `person_current_grade` is. Doug shows as Hanshi and Godan, independently.

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

## The market, briefly

Kyokushin alone fragmented into a dozen world organisations after Sosai died,
each with national bodies beneath. Add Shotokan, Goju-ryu, Wado-ryu, Shito-ryu,
ITF and WT taekwondo, aikido's several streams, kendo federations, and BJJ's
affiliation networks.

Hundreds of style bodies worldwide, all with the same five needs and none of them
served. That is the addressable market — not "martial arts", which is far too
broad to build for.
