/**
 * USE CASE — get someone a way in.
 *
 * The use case knows there is a link and who it is for. It does not know
 * whether that link travels by email, by text message, or by being written to
 * a log for a developer to copy — that is the messenger's business.
 *
 * Which is why the system works today with no email provider at all, and will
 * work with one later without this file changing.
 */

import { requirePort, MESSENGER, CLOCK } from './ports.mjs';

export class SendSignInLink {
  constructor({ messenger, clock }) {
    this.messenger = requirePort(messenger, MESSENGER);
    this.clock = requirePort(clock, CLOCK);
  }

  /**
   * `issue` is whatever the auth module returned: { token, expiresInMinutes }.
   * A null token means the address was not recognised — and nothing is sent,
   * because telling someone an address is unknown hands them a membership list.
   */
  async execute({ email, name = null, issue, origin, federation }) {
    if (!issue?.token) return { sent: false, reason: 'unknown address' };

    const link = `${origin.replace(/\/$/, '')}/signin/${issue.token}`;
    const minutes = issue.expiresInMinutes ?? 15;

    const text = [
      name ? `Kia ora ${name},` : 'Kia ora,', '',
      `Here is your sign-in link for ${federation}:`, '',
      link, '',
      `It works once, and expires in ${minutes} minutes.`, '',
      'If you did not ask for this, you can ignore it — nobody can sign in',
      'without the link.',
    ].join('\n');

    // Awaited deliberately. Returning before the provider has accepted is how
    // a send fails with no error and nobody notices for a week.
    const result = await this.messenger.send({
      to: email,
      subject: `Sign in to ${federation}`,
      text,
      kind: 'sign-in',
    });

    return { sent: !!result?.delivered, link, ...result };
  }
}
