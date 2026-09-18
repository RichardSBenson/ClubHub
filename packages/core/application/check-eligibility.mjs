/**
 * USE CASE — is this person ready for their next grade?
 *
 * Depends on ports only. It has never heard of Postgres, HTTP or a test runner,
 * which is why the same object runs against a real database and against an
 * in-memory fake with no change.
 */

import { RankHistory } from '../domain/rank.mjs';
import { requirePort, LADDER_REPOSITORY, RANK_REPOSITORY,
         MEMBER_REPOSITORY, CLOCK } from './ports.mjs';

export class CheckEligibility {
  constructor({ ladder, ranks, members, clock }) {
    this.ladder = requirePort(ladder, LADDER_REPOSITORY);
    this.ranks = requirePort(ranks, RANK_REPOSITORY);
    this.members = requirePort(members, MEMBER_REPOSITORY);
    this.clock = requirePort(clock, CLOCK);
  }

  async execute({ personId, federationId, on = null }) {
    const when = on ?? this.clock.today();

    const member = await this.members.byId(personId);
    if (!member)
      return { known: false, eligible: false, reasons: ['No such person'] };

    const grades = await this.ladder.gradesFor(federationId);
    const byId = new Map(grades.map((g) => [g.id, g]));
    const history = new RankHistory(await this.ranks.recordsFor(personId), byId);

    // An ungraded person's next grade is the bottom of the ladder — whatever
    // rank order that is. Assuming it starts at 1 breaks any federation whose
    // ladder is numbered differently, or that shares a ladder across styles.
    const next = history.isEmpty
      ? grades[0] ?? null
      : grades.find((g) => g.rankOrder.value === history.rankOrder.value + 1);

    if (!next) {
      return {
        known: true, eligible: false,
        holds: history.current?.grade.label ?? null,
        next: null, nextGradeId: null, requirements: [],
        reasons: history.isEmpty
          ? ['No ladder defined for this federation']
          : ['Top of the ladder — no higher grade is defined'],
      };
    }

    const heldSince = history.heldSince;
    const sessions = await this.members.sessionsSince(
      personId, heldSince?.value ?? null);

    const requirements = next.requirementsFor({
      heldSince, sessionsSince: sessions,
      dateOfBirth: member.dateOfBirth, on: when,
    });
    const unmet = requirements.filter((r) => !r.met);

    return {
      known: true,
      holds: history.current?.grade.label ?? null,
      next: next.label,
      nextGradeId: next.id,
      eligible: unmet.length === 0,
      requirements,
      // Phrased so a dojo operator can read it straight to a student.
      reasons: unmet.map((r) => r.shortfall == null
        ? `${r.name} unknown`
        : `${r.shortfall} more ${r.unit}`),
    };
  }
}
