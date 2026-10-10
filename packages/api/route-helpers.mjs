/**
 * Small helpers the route modules share: where a request came from, the address mail is sent from, reading a submitted form, making a web address from a title, hashing an address.
 */
import crypto from 'node:crypto';

/** Fields shared by the add and edit forms, read out of a submitted form. */
export const memberFieldsFrom = (form) => ({
  firstName: form.firstName?.trim() ?? '',
  lastName: form.lastName?.trim() ?? '',
  preferredName: form.preferredName?.trim() || null,
  dateOfBirth: form.dateOfBirth?.trim() || null,
  gender: form.gender?.trim() || null,
  email: form.email?.trim() || null,
  phone: form.phone?.trim() || null,
  emergencyName: form.emergencyName?.trim() || null,
  emergencyPhone: form.emergencyPhone?.trim() || null,
  paidUntil: form.paidUntil?.trim() || null,
});

/** A title becomes a web address when nobody typed one. */
export const slugify = (text) => String(text ?? '').toLowerCase().trim()
  .replace(/['']/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120);

export const ipHash = (ip) => crypto.createHmac('sha256', process.env.ENQUIRY_SALT ?? process.env.CRON_SECRET ?? 'honbu')
  .update(String(ip ?? '')).digest('hex').slice(0, 32);

/** The federation's sending address, whose domain every club sends from. */
export const sendingAddress = (env = process.env) =>
  env.MESSENGER_FROM ?? env.SMTP_FROM
  ?? (!env.MESSENGER_PROVIDER || ['log', 'none'].includes(env.MESSENGER_PROVIDER)
      ? 'noreply@log.local' : null);

export const originOf = (ctx) => `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;
