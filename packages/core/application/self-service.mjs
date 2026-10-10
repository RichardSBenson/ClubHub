/**
 * USE CASES — what the signed-in account may do for whom.
 *
 * "self" for their own record; "guardian" for a child under the age of majority they hold a live link to; nothing for
 * anybody else. This is the one door every self-service screen goes through.
 */

import { requirePort, NotPermitted, SELF_SERVICE_READS } from './ports.mjs';

export class SelfService {
  constructor({ reads, adultAge }) {
    this.reads = requirePort(reads, SELF_SERVICE_READS);
    this.adultAge = adultAge;
  }

  /** The signed-in person and the children they act for. */
  async mine(accountId) {
    const self = await this.reads.selfOf(accountId);
    if (!self) return { self: null, dependants: [] };
    return { self, dependants: await this.reads.dependantsOf(self.id, this.adultAge()) };
  }

  /** 'self', 'guardian', or null. */
  async mayActFor(accountId, personId) {
    const { self, dependants } = await this.mine(accountId);
    if (!self) return null;
    if (self.id === personId) return 'self';
    return dependants.some((d) => d.id === personId) ? 'guardian' : null;
  }

  async assertMayActFor(accountId, personId) {
    const how = await this.mayActFor(accountId, personId);
    if (!how) throw new NotPermitted('Not permitted');
    return how;
  }

  /**
   * Whether this account may see and pay what the child owes. Yourself, always. A linked adult, unless the child has
   * somebody marked as looking after the fees and it is not them.
   */
  async mayPayFor(accountId, personId) {
    const how = await this.mayActFor(accountId, personId);
    if (how !== 'guardian') return how === 'self';
    const mine = await this.reads.personIdOf(accountId);
    const { anySet, guardianIds } = await this.reads.feePayersOf(personId);
    return !anySet || guardianIds.includes(mine);
  }
}
