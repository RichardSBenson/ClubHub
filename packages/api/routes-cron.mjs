/**
 * Routes: the scheduled jobs the host calls — publishing, renewal reminders, and the rest. Each checks the shared secret.
 */
import crypto from 'node:crypto';
import { reminders, newcomers, qualifications, autoRenew, enquiries, scheduledPublishing, growth, terms, Forbidden } from './data.mjs';
import { messengerFrom } from '../infrastructure/messaging/messengers.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { sendingAddress, originOf } from './route-helpers.mjs';

export function registerCronRoutes({ get, signInLinkFor, providerNow }) {
  get('/cron/publish', async (ctx) => {
    const secret = process.env.CRON_SECRET;
    const given = String(ctx.req.headers.authorization ?? '').replace(/^Bearer /, '');
    const a = Buffer.from(given), b = Buffer.from(secret ?? '');
    if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b))
      throw new Forbidden('Not permitted');
    const made = await scheduledPublishing.run();
    const rebuild = made.length ? await requestRebuild({ reason: `scheduled: ${made.length} item(s)` }) : null;
    return ctx.send(200, `<pre>${JSON.stringify({ published: made, rebuild: rebuild?.detail ?? null }, null, 1).replace(/</g, '&lt;')}</pre>`);
  });

  // The scheduler's door. Open to nobody without the shared secret, and shut
  // entirely when none is configured — "no secret set" must never mean "no lock".
  get('/cron/renewals', async (ctx) => {
    const secret = process.env.CRON_SECRET;
    const given = String(ctx.req.headers.authorization ?? '').replace(/^Bearer /, '');
    const a = Buffer.from(given), b = Buffer.from(secret ?? '');
    if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b))
      throw new Forbidden('Not permitted');
    const autoReport = await autoRenew.run({ provider: providerNow(), messenger: messengerFrom(), baseFrom: sendingAddress(),
      origin: process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : originOf(ctx) });
    const forgotten = await newcomers.purgeStale();
    const enquiriesDeleted = await enquiries.tidy();
    const qualReport = await qualifications.remind({ messenger: messengerFrom(), baseFrom: sendingAddress(),
      origin: process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : originOf(ctx) });
    const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : originOf(ctx);
    const report = await reminders.run({ messenger: messengerFrom(), baseFrom: sendingAddress(), origin });
    const termsReport = await terms.run({ messenger: messengerFrom(), baseFrom: sendingAddress(), origin });
    const growthReport = await growth.run({ messenger: messengerFrom(), baseFrom: sendingAddress(), origin, signInLink: signInLinkFor(origin) });
    return ctx.send(200, `<pre>${JSON.stringify({ report, autoRenew: autoReport, qualifications: qualReport, newcomersForgotten: forgotten, enquiriesDeleted, growth: growthReport, terms: termsReport }, null, 1).replace(/</g, '&lt;')}</pre>`);
  });
}
