/**
 * USE CASE — record a grading.
 *
 * The rules live here and in the domain, so the same guarantees apply whether
 * this is called from a web form, a CLI, a bulk import after a national shinsa,
 * or the tournament system. There is no second path by which a grading reaches
 * the register unchecked.
 */

import { GradingRecord } from '../domain/rank.mjs';
import { CheckEligibility } from './check-eligibility.mjs';
import { requirePort, Refused, NotPermitted,
         LADDER_REPOSITORY, RANK_REPOSITORY, MEMBER_REPOSITORY,
         ORGANISATION_REPOSITORY, AUTHORISATION, CLOCK } from './ports.mjs';

const MAY_RECORD = ['owner', 'administrator', 'registrar'];

export class AwardGrade {
  constructor({ ladder, ranks, members, organisations, auth, clock }) {
    this.ladder = requirePort(ladder, LADDER_REPOSITORY);
    this.ranks = requirePort(ranks, RANK_REPOSITORY);
    this.members = requirePort(members, MEMBER_REPOSITORY);
    this.organisations = requirePort(organisations, ORGANISATION_REPOSITORY);
    this.auth = requirePort(auth, AUTHORISATION);
    this.clock = requirePort(clock, CLOCK);
  }

  async execute({ actorId, personId, gradeId, awardingOrgId, awardedOn = null,
                  panel = [], result = 'pass', overrideEligibility = false }) {
    const when = awardedOn ?? this.clock.today();

    if (!await this.auth.hasRoleAt(actorId, awardingOrgId, MAY_RECORD))
      throw new NotPermitted('You may not record gradings for that organisation');

    const org = await this.organisations.byId(awardingOrgId);
    if (!org) throw new Refused('No such organisation');

    const grades = await this.ladder.gradesFor(org.federationId);
    const grade = grades.find((g) => g.id === gradeId);
    if (!grade) throw new Refused("That grade is not on this federation's ladder");

    const authority = await this.ladder.authorityFor(
      org.federationId, grade.rankOrder.value);
    if (!authority) throw new Refused(`No authority rule covers ${grade.label}`);

    // Panel ranks come from the register, never from the caller.
    const panelIds = panel.map((p) => (typeof p === 'string' ? p : p.personId));
    const ranks = await this.ranks.rankOrdersFor(panelIds);
    const panelWithRanks = panelIds.map((id) => ({
      personId: id, rankOrder: ranks.get(id) ?? null,
    }));

    const objections = authority.objectionsTo({
      grade, awardingOrgType: org.type, panel: panelWithRanks,
    });
    if (objections.length) throw new Refused(objections);

    // Eligibility can be overridden — deliberately, and never silently.
    let waived = [];
    if (result === 'pass') {
      const check = new CheckEligibility({
        ladder: this.ladder, ranks: this.ranks,
        members: this.members, clock: this.clock,
      });
      const verdict = await check.execute({
        personId, federationId: org.federationId, on: when,
      });

      if (verdict.nextGradeId !== gradeId)
        throw new Refused('That is not this person\'s next grade — they are due '
          + (verdict.next ?? 'nothing'));

      if (!verdict.eligible) {
        if (!overrideEligibility) throw new Refused(verdict.reasons);
        waived = verdict.reasons;
      }
    }

    const record = new GradingRecord({
      personId, gradeId, awardedOn: when, awardedByOrgId: awardingOrgId,
      result, panel: panelWithRanks,
    });

    return {
      record: await this.ranks.save(record),
      grade: grade.label,
      needsRatification: authority.needsRatification,
      ratifiedBy: authority.ratifiedByType,
      waived,
    };
  }
}
