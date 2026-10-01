/**
 * INFRASTRUCTURE — payment providers
 *
 * One port, so Stripe, Debitsuccess, POLi and VostroPay can each be added as a
 * file here without anything above changing:
 *
 *   start({ amountCents, currency, method, reference, card? })
 *       → { ref, status: 'succeeded' | 'awaiting' | 'failed', detail }
 *   check(ref) → 'succeeded' | 'awaiting' | 'failed'     (ask the provider)
 *
 * TestProvider moves no money. It behaves like the real ones do, so what is
 * built against it is built against the right shape:
 *
 *   card          settles at once. 4000 0000 0000 0002 is declined.
 *   bank          comes back "awaiting" — the payer is away at their bank
 *   direct_debit  comes back "awaiting" — it settles overnight
 *
 * An awaiting payment becomes real only when the provider says so (a webhook,
 * or `check`). TestProvider's `complete(ref)` is that message.
 */
import crypto from 'node:crypto';

export class TestProvider {
  constructor() { this.name = 'test'; this.known = new Map(); }

  async start({ amountCents, method, card }) {
    const ref = `test_${crypto.randomBytes(8).toString('hex')}`;
    if (method === 'card') {
      const declined = String(card ?? '').replace(/\D/g, '') === '4000000000000002';
      const status = declined ? 'failed' : 'succeeded';
      this.known.set(ref, status);
      return { ref, status, detail: declined ? 'The card was declined.' : 'Paid by test card.' };
    }
    this.known.set(ref, 'awaiting');
    return { ref, status: 'awaiting',
      detail: method === 'bank' ? 'Waiting for the bank to confirm.'
                                : 'The debit will settle overnight.' };
  }

  async check(ref) { return this.known.get(ref) ?? 'awaiting'; }
  complete(ref, ok = true) { this.known.set(ref, ok ? 'succeeded' : 'failed'); }
}

/** For tests: answers however it is told to. */
export class ScriptedProvider {
  constructor(answer) { this.name = 'scripted'; this.answer = answer; this.calls = []; }
  async start(input) { this.calls.push(input); return this.answer(input); }
  async check() { return 'awaiting'; }
}

export function paymentProviderFrom(env = process.env) {
  const which = env.PAYMENTS_PROVIDER ?? 'test';
  if (which === 'test') return new TestProvider();
  throw new Error(`Payment provider "${which}" is not available yet — only "test" is.`);
}

export const isTestProvider = (p) => p?.name === 'test';
