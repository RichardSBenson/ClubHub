/**
 * HONBU — data access: messaging
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { region } from '../../infrastructure/region-context.mjs';
import { problemsWithMessage, senderFor, chooseRecipients, renderBody, rolesForAudience } from '../../core/domain/messaging.mjs';
import crypto from 'node:crypto';
import { pushFromEnv } from '../../infrastructure/push/webpush.mjs';
import dns from 'node:dns/promises';
import { SCOPES as API_SCOPES, EVENTS as WEBHOOK_EVENTS, MAX_TOKENS, MAX_WEBHOOKS, retryAt, problemsWithToken, problemsWithWebhook, isPrivateAddress, DISABLE_AFTER_FAILED_DELIVERIES, pageSize } from '../../core/domain/integrations.mjs';
import { MANAGE } from '../../core/domain/access.mjs';
import { events } from './events.mjs';
import { Invalid, NotFound, assertRole, one, q } from './shared.mjs';

// ---------------------------------------------------------------------------
// messages
//
// A club writes to its own people, as the club. Only an administrator of the
// organisation (or of one above it) may. Everything sent is recorded against
// the people it reached, so "did they get it?" has an answer afterwards.
// ---------------------------------------------------------------------------

const peopleIn = async (org, audience, { eventId, personId, personIds }) => {
  if (audience === 'selected') {
    // Only people actually in this organisation: an id from anywhere else is dropped, not trusted.
    const r = await q(`
      select distinct a.person_id as id from affiliation a
      join organisation o on o.id = a.organisation_id
      where a.person_id = any($2::uuid[]) and a.ends is null and o.path <@ $1::ltree`,
      [org.path, personIds]);
    return r.map((x) => x.id);
  }
  if (audience === 'person') {
    const r = await q(`
      select distinct a.person_id as id from affiliation a
      join organisation o on o.id = a.organisation_id
      where a.person_id = $2 and a.ends is null and o.path <@ $1::ltree`,
      [org.path, personId]);
    if (!r.length) throw new NotFound('Person');
    return r.map((x) => x.id);
  }
  if (audience === 'event') {
    const r = await q(`
      select distinct en.person_id as id from event_entry en
      join event e on e.id = en.event_id
      join organisation o on o.id = e.organisation_id
      where e.id = $2 and o.path <@ $1::ltree and en.person_id is not null`,
      [org.path, eventId]);
    return r.map((x) => x.id);
  }
  if (audience === 'udansha') {
    // Black belts: whoever's current grade is a dan grade, anywhere under this organisation.
    const r = await q(`
      select distinct a.person_id as id from affiliation a
      join organisation o on o.id = a.organisation_id
      join person_current_grade cg on cg.person_id = a.person_id and cg.is_dan
      where o.path <@ $1::ltree and a.ends is null and a.status = 'active'`, [org.path]);
    return r.map((x) => x.id);
  }
  const roles = rolesForAudience(audience);
  const r = await q(`
    select distinct a.person_id as id from affiliation a
    join organisation o on o.id = a.organisation_id
    where o.path <@ $1::ltree and a.ends is null and a.status = 'active'
      and a.role = any($2::text[])`, [org.path, roles]);
  return r.map((x) => x.id);
};

export const messages = {
  /** What the compose screen offers, and what a message would be sent as. */
  async options(actor, orgId, { baseFrom, trusted = false }) {
    if (!trusted) await assertRole(actor, orgId, MANAGE);
    const org = await one('select * from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    const events = await q(`
      select e.id, e.title, to_char(e.starts_at at time zone o.timezone,'YYYY-MM-DD') as day
      from event e join organisation o on o.id = e.organisation_id
      where o.path <@ $1::ltree and e.status = 'published'
        and e.starts_at > now() - interval '60 days'
      order by e.starts_at desc limit 40`, [org.path]);
    const people = await q(`
      select p.id, trim(concat_ws(' ', p.first_name, p.last_name)) as name, cg.label as grade,
             (select o2.name from affiliation a2 join organisation o2 on o2.id = a2.organisation_id
               where a2.person_id = p.id and a2.ends is null and o2.path <@ $1::ltree limit 1) as club
      from person p
      left join person_current_grade cg on cg.person_id = p.id
      where exists (select 1 from affiliation a join organisation o on o.id = a.organisation_id
                    where a.person_id = p.id and a.ends is null and a.status = 'active' and o.path <@ $1::ltree)
      order by p.last_name, p.first_name limit 1000`, [org.path]);
    const contact = org.type === 'club'
      ? (await one('select email from club_profile where organisation_id=$1', [orgId]))?.email : null;
    const me = actor ? await one('select email from account where id=$1', [actor]) : null;
    const sender = senderFor({ club: org, baseFrom, contactEmail: contact, actorEmail: me?.email });
    return { org, events, people, sender, contactEmail: contact };
  },

  async history(actor, orgId, { limit = 50 } = {}) {
    await assertRole(actor, orgId, MANAGE);
    return q(`
      select m.id, m.subject, m.audience, m.kind, m.created_at,
        count(r.*)::int as total,
        count(*) filter (where r.status = 'sent')::int as sent,
        count(*) filter (where r.status = 'failed')::int as failed,
        count(*) filter (where r.status in ('queued','sending'))::int as waiting,
        count(*) filter (where r.status in ('opted_out','no_email'))::int as skipped
      from message m left join message_recipient r on r.message_id = m.id
      where m.organisation_id = $1
      group by m.id order by m.created_at desc limit $2`, [orgId, limit]);
  },

  /** One message and who it went to. Scoped to the organisation asked about. */
  async get(actor, orgId, messageId) {
    await assertRole(actor, orgId, MANAGE);
    const message = await one(`select m.*, e.title as event_title from message m
      left join event e on e.id = m.event_id
      where m.id = $1 and m.organisation_id = $2`, [messageId, orgId]);
    if (!message) throw new NotFound('Message');
    const recipients = await q(`
      select r.id, r.email, r.status, r.error, r.sent_at,
        nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '') as about
      from message_recipient r
      left join person p on p.id = r.person_id
      left join person c on c.id = r.about_id
      where r.message_id = $1
      order by r.status, p.last_name, p.first_name`, [messageId]);
    return { message, recipients };
  },

  /**
   * Work out who this reaches and write the message down, every recipient
   * queued. Nothing is sent here.
   */
  async prepare(actor, orgId, input, { baseFrom, trusted = false }) {
    if (!trusted) await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithMessage(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const { org, sender } = await messages.options(actor, orgId, { baseFrom, trusted });
    const appOnly = input.channel === 'app';
    if (!appOnly && !sender)
      throw new Invalid('Email is not set up to send from this system yet — ask whoever installed it to add a sending address.');
    if (!appOnly && !sender.replyTo)
      throw new Invalid('Add a contact email on the club\'s page first, so replies have somewhere to go.');
    if (input.audience === 'selected' && !input.personIds?.length)
      throw new Invalid('Choose who this is for.');

    let personId = null;
    if (input.audience === 'person') {
      personId = (await one('select id from person where upper(display_number) = upper($1)',
        [input.personNumber]))?.id;
      if (!personId) throw new Invalid(`There is no member numbered ${input.personNumber}.`);
    }
    const ids = await peopleIn(org, input.audience, { ...input, personId });
    if (!ids.length && input.audience === 'selected')
      throw new Invalid('None of those people are in this club.');
    const candidates = ids.length ? (await q(`
      select p.id as "personId", p.email,
        (p.date_of_birth is not null and p.date_of_birth > current_date - make_interval(years => $2)) as "isMinor",
        coalesce(ep.opted_out, false) as "optedOut",
        coalesce((select json_agg(json_build_object('personId', g.id, 'email', g.email,
                                                    'optedOut', coalesce(gp.opted_out, false),
                                                    'main', gl.is_main_contact, 'alsoCopy', gl.also_copy, 'pays', gl.pays_fees))
                  from guardian_link gl join person g on g.id = gl.guardian_id
                  left join email_preference gp on gp.person_id = g.id
                  where gl.child_id = p.id and gl.ended_on is null), '[]'::json) as guardians
      from person p left join email_preference ep on ep.person_id = p.id
      where p.id = any($1::uuid[])`, [ids, region().adultAge])) : [];

    const { recipients, skipped } = chooseRecipients(candidates,
      { honourOptOut: input.kind === 'announcement', preferFees: input.kind === 'renewal', appOnly });
    if (!recipients.length)
      throw new Invalid(ids.length
        ? (appOnly ? 'Everyone here has opted out of announcements.'
                   : 'Nobody here can be emailed — they have no address on file, or have opted out.')
        : 'That group has nobody in it.');

    const message = await one(`
      insert into message (organisation_id, sent_by, kind, audience, event_id, subject, body,
                           sender_name, sender_address, reply_to, channel)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [orgId, actor, input.kind, input.audience,
       input.audience === 'event' ? input.eventId : null,
       input.subject, input.body, sender?.name ?? org.name, sender?.address ?? '', sender?.replyTo ?? null,
       appOnly ? 'app' : 'both']);

    const rows = [
      ...recipients.map((r) => ({ ...r, status: 'queued' })),
      ...skipped.map((r) => ({ personId: r.personId, email: r.email ?? null,
                               status: r.reason, via: null })),
    ];
    await pool.query(`
      insert into message_recipient (message_id, person_id, email, about_id, status)
      select $1, x.p, x.e, x.a, x.s
      from unnest($2::uuid[], $3::text[], $4::uuid[], $5::text[]) as x(p, e, a, s)`,
      [message.id, rows.map((r) => r.personId), rows.map((r) => r.email),
       rows.map((r) => r.via ?? null), rows.map((r) => r.status)]);

    // A way out for each person we are about to write to.
    const who = [...new Set(recipients.map((r) => r.personId))];
    await pool.query(`
      insert into email_preference (person_id, token)
      select x.p, x.t from unnest($1::uuid[], $2::text[]) as x(p, t)
      on conflict (person_id) do nothing`,
      [who, who.map(() => crypto.randomBytes(18).toString('base64url'))]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
      values ($1,$2,'message_sent','message',$3,null,$4)`,
      [actor, orgId, message.id, JSON.stringify({
        subject: input.subject, audience: input.audience, kind: input.kind,
        recipients: recipients.length, skipped: skipped.length })]);

    return { message, recipients: recipients.length, skipped: skipped.length };
  },

  /**
   * Send what is still queued, until the time budget runs out. Safe to call
   * again: a recipient is claimed before it is sent, so two presses of the
   * button do not write to anybody twice.
   */
  async sendBatch(actor, orgId, messageId, { messenger, origin, budgetMs = 6000, concurrency = 5, trusted = false }) {
    if (!trusted) await assertRole(actor, orgId, MANAGE);
    const message = await one('select * from message where id=$1 and organisation_id=$2',
      [messageId, orgId]);
    if (!message) throw new NotFound('Message');
    const org = await one('select name from organisation where id=$1', [orgId]);
    const started = Date.now();
    const sender = { name: message.sender_name, address: message.sender_address,
                     replyTo: message.reply_to };
    let sent = 0, failed = 0;

    const claim = () => q(`
      update message_recipient set status = 'sending', sent_at = now()
      where id in (select id from message_recipient
                   where message_id = $1
                     and (status = 'queued'
                          or (status = 'sending' and sent_at < now() - interval '3 minutes'))
                   order by id limit $2 for update skip locked)
      returning id, person_id, email`, [messageId, concurrency]);

    while (Date.now() - started < budgetMs) {
      const batch = await claim();
      if (!batch.length) break;
      const tokens = new Map((await q(
        'select person_id, token from email_preference where person_id = any($1::uuid[])',
        [batch.map((b) => b.person_id)])).map((t) => [t.person_id, t.token]));
      await Promise.all(batch.map(async (r) => {
        if (message.channel === 'app') {
          // No email at all: the notification is the message, and the inbox in the app keeps it.
          const reached = await push.toPerson(r.person_id,
            { title: org.name, body: message.subject, url: '/me/messages' }).catch(() => 0);
          await pool.query(`update message_recipient set status=$2, sent_at=now(), error=null where id=$1`,
            [r.id, reached ? 'sent' : 'no_app']);
          if (reached) sent++;
          return;
        }
        const token = tokens.get(r.person_id);
        const url = token && origin ? `${origin}/unsubscribe/${token}` : null;
        try {
          const res = await messenger.send({
            to: r.email, subject: message.subject, kind: 'message', sender,
            text: renderBody({ text: String(message.body)
                .replaceAll('{club}', org.name).replaceAll('{payLink}', origin ? `${origin}/me/payments` : 'your club'),
              club: org, unsubscribeUrl: url,
                               optOutHonoured: message.kind === 'announcement',
                               serviceNote: message.kind === 'renewal' ? 'This is about your membership fees, so it is sent whatever your email settings.' : undefined }),
            headers: url && message.kind === 'announcement' ? { 'List-Unsubscribe': `<${url}>` } : null,
          });
          await pool.query(`update message_recipient set status='sent', sent_at=now(),
            provider_id=$2, error=null where id=$1`, [r.id, res?.id ?? null]);
          sent++;
          await push.toPerson(r.person_id, { title: org.name, body: message.subject, url: "/me/messages" }).catch(() => {});
        } catch (e) {
          await pool.query(`update message_recipient set status='failed', error=$2 where id=$1`,
            [r.id, String(e.message ?? e).slice(0, 300)]);
          failed++;
        }
      }));
    }
    const left = await one(`select count(*)::int as n from message_recipient
      where message_id=$1 and status in ('queued','sending')`, [messageId]);
    return { sent, failed, waiting: left.n };
  },

  /** Put failed ones back in the queue. */
  async retryFailed(actor, orgId, messageId) {
    await assertRole(actor, orgId, MANAGE);
    const m = await one('select id from message where id=$1 and organisation_id=$2', [messageId, orgId]);
    if (!m) throw new NotFound('Message');
    await pool.query(`update message_recipient set status='queued', error=null
      where message_id=$1 and status='failed'`, [messageId]);
  },
};

/** The way out. The token is the authority, so it is looked up by nothing else. */
export const emailPreferences = {
  async byToken(token) {
    return one(`select ep.opted_out, p.first_name from email_preference ep
      join person p on p.id = ep.person_id where ep.token = $1`, [String(token)]);
  },
  async setOptOut(token, optedOut) {
    const row = await one(`update email_preference set opted_out=$2, updated_at=now()
      where token=$1 returning person_id`, [String(token), !!optedOut]);
    if (row) await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
      select null::uuid, a.organisation_id, 'email_preference', 'person', $1::uuid, null::jsonb, $2::jsonb
      from affiliation a where a.person_id = $1 and a.ends is null limit 1`,
      [row.person_id, JSON.stringify({ optedOut: !!optedOut })]);
    return !!row;
  },
};

const MAX_DEVICES = 10;

const problemsWithSubscription = (s) => {
  const out = [];
  let url; try { url = new URL(String(s?.endpoint ?? '')); } catch { out.push('That device did not give a usable address.'); }
  if (url && url.protocol !== 'https:') out.push('That device did not give a usable address.');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(String(s?.p256dh ?? ''))) out.push('That device did not give a usable key.');
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(String(s?.auth ?? ''))) out.push('That device did not give a usable key.');
  if (String(s?.endpoint ?? '').length > 1000) out.push('That device address is too long.');
  return out;
};

export const push = {
  /** Which provider sends: from the environment unless one is handed in (tests). null means push is off. */
  provider: () => pushFromEnv(),

  async status(actor) {
    const p = this.provider();
    const mine = await q('select id, user_agent, created_at from push_subscription where account_id=$1 order by created_at desc', [actor]);
    return { available: !!p, publicKey: p?.publicKey ?? null, devices: mine };
  },

  async subscribe(actor, sub, userAgent = null) {
    if (!this.provider()) throw new Invalid('Notifications are not switched on for this site yet.');
    const problems = problemsWithSubscription(sub);
    if (problems.length) throw new Invalid([...new Set(problems)].join(' '));
    // The same device signing in as somebody else takes the subscription with it.
    await pool.query(`insert into push_subscription (account_id, endpoint, p256dh, auth, user_agent) values ($1,$2,$3,$4,$5)
      on conflict (endpoint) do update set account_id=$1, p256dh=$3, auth=$4, user_agent=$5, failures=0`,
      [actor, sub.endpoint, sub.p256dh, sub.auth, String(userAgent ?? '').slice(0, 200) || null]);
    await pool.query(`delete from push_subscription where id in (select id from push_subscription where account_id=$1 order by created_at desc offset $2)`, [actor, MAX_DEVICES]);
  },

  async unsubscribe(actor, endpoint) {
    await pool.query('delete from push_subscription where account_id=$1 and endpoint=$2', [actor, String(endpoint ?? '')]);
  },

  async removeDevice(actor, id) {
    const r = await pool.query('delete from push_subscription where account_id=$1 and id=$2', [actor, id]);
    if (!r.rowCount) throw new NotFound('Device');
  },

  /**
   * Tell a person (and, for a child, their parents) something short. Best effort and never an error to the caller:
   * a dead device is forgotten, a slow one is skipped. Returns how many devices were reached.
   */
  async toPerson(personId, message, provider = this.provider()) {
    if (!provider) return 0;
    const subs = await q(`select s.id, s.endpoint, s.p256dh, s.auth from push_subscription s join account a on a.id = s.account_id
      where a.person_id = $1 or a.person_id in (select guardian_id from guardian_link where child_id = $1 and ended_on is null)`, [personId]);
    let reached = 0;
    for (const s of subs) {
      let r; try { r = await provider.send(s, message); } catch { r = 'failed'; }
      if (r === 'sent') { reached++; await pool.query('update push_subscription set last_sent_at=now(), failures=0 where id=$1', [s.id]); }
      else if (r === 'gone') await pool.query('delete from push_subscription where id=$1', [s.id]);
      else await pool.query('update push_subscription set failures = failures + 1 where id=$1', [s.id]);
    }
    return reached;
  },
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export const apiTokens = {
  SCOPES: API_SCOPES,

  async list(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    return q(`select id, name, prefix, scopes, created_at, last_used_at, revoked_at from api_token where organisation_id = $1 order by revoked_at nulls first, created_at desc`, [orgId]);
  },

  /** The token itself is returned once, here, and never stored. */
  async create(actor, orgId, { name, scopes }) {
    await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithToken({ name, scopes });
    if (problems.length) throw new Invalid(problems.join(' '));
    if ((await one(`select count(*)::int n from api_token where organisation_id=$1 and revoked_at is null`, [orgId])).n >= MAX_TOKENS)
      throw new Invalid(`There are already ${MAX_TOKENS} tokens. Revoke one you no longer use.`);
    const token = `hb_${crypto.randomBytes(24).toString('base64url')}`;
    const row = await one(`insert into api_token (organisation_id, name, prefix, token_hash, scopes, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [orgId, String(name).trim().slice(0, 80), token.slice(0, 9), sha256(token), scopes, actor]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'api_token_create','api_token',$3,$4)`,
      [actor, orgId, row.id, JSON.stringify({ name, scopes })]);
    return { id: row.id, token };
  },

  async revoke(actor, orgId, tokenId) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one(`update api_token set revoked_at = now() where id=$1 and organisation_id=$2 and revoked_at is null returning id`, [tokenId, orgId]);
    if (!row) throw new NotFound('Token');
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'api_token_revoke','api_token',$3,'{}')`, [actor, orgId, tokenId]);
  },

  /** A bearer string → who it speaks for, or null. */
  async authenticate(bearer) {
    const t = String(bearer ?? '').trim();
    if (!/^hb_[A-Za-z0-9_-]{32}$/.test(t)) return null;
    const row = await one(`select id, organisation_id, scopes, last_used_at from api_token where token_hash = $1 and revoked_at is null`, [sha256(t)]);
    if (!row) return null;
    if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) await pool.query('update api_token set last_used_at = now() where id=$1', [row.id]);
    return { tokenId: row.id, orgId: row.organisation_id, scopes: row.scopes };
  },
};

/** What the API shows. Deliberately small: no dates of birth, contact details, medical or payment information. */
export const api = {
  async organisations(auth) {
    return q(`select o.id, o.slug, o.name, o.type, p.slug as parent_slug from organisation o join organisation me on me.id = $1 and o.path <@ me.path
      left join organisation p on p.id = o.parent_id where o.status = 'active' order by o.path`, [auth.orgId]);
  },
  async members(auth, { limit, after }) {
    const n = pageSize(limit);
    const rows = await q(`select p.id, p.display_number as number, p.first_name, p.last_name, o.slug as club, a.role, a.status, a.paid_until::text as paid_until,
        a.starts::text as joined, g.label as grade
      from affiliation a join organisation o on o.id = a.organisation_id join organisation me on me.id = $1 and o.path <@ me.path
      join person p on p.id = a.person_id left join person_current_grade g on g.person_id = p.id
      where a.ends is null and a.role in ('member','instructor','assistant') and ($3::uuid is null or p.id > $3::uuid)
      order by p.id limit $2`, [auth.orgId, n + 1, UUID_OK.test(String(after ?? '')) ? after : null]);
    return { data: rows.slice(0, n), next: rows.length > n ? rows[n - 1].id : null };
  },
  async events(auth, { limit, after }) {
    const n = pageSize(limit);
    const rows = await q(`select e.id, e.slug, e.title, e.kind, e.starts_at, e.ends_at, e.status, e.venue_name, o.slug as organisation
      from event e join organisation o on o.id = e.organisation_id join organisation me on me.id = $1 and o.path <@ me.path
      where ($3::uuid is null or e.id > $3::uuid) order by e.id limit $2`, [auth.orgId, n + 1, UUID_OK.test(String(after ?? '')) ? after : null]);
    return { data: rows.slice(0, n), next: rows.length > n ? rows[n - 1].id : null };
  },
};

const UUID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const webhooks = {
  EVENTS: WEBHOOK_EVENTS,

  async list(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const endpoints = await q(`select id, url, events, active, disabled_at, disabled_reason, consecutive_failures, created_at from webhook_endpoint where organisation_id=$1 order by created_at desc`, [orgId]);
    const recent = await q(`select d.id, d.endpoint_id, d.event, d.status, d.attempts, d.last_status, d.last_error, d.created_at, d.delivered_at, d.next_attempt_at
      from webhook_delivery d join webhook_endpoint e on e.id = d.endpoint_id where e.organisation_id=$1 order by d.created_at desc limit 20`, [orgId]);
    return { endpoints, recent };
  },

  /** The secret is returned once, here. */
  async create(actor, orgId, { url, events }) {
    await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithWebhook({ url, events });
    if (problems.length) throw new Invalid(problems.join(' '));
    if ((await one('select count(*)::int n from webhook_endpoint where organisation_id=$1', [orgId])).n >= MAX_WEBHOOKS)
      throw new Invalid(`There are already ${MAX_WEBHOOKS} webhooks. Remove one you no longer use.`);
    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
    const row = await one(`insert into webhook_endpoint (organisation_id, url, secret, events, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [orgId, String(url).trim(), secret, events, actor]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'webhook_create','webhook_endpoint',$3,$4)`,
      [actor, orgId, row.id, JSON.stringify({ url, events })]);
    return { id: row.id, secret };
  },

  async setActive(actor, orgId, id, active) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one(`update webhook_endpoint set active=$3, disabled_at = null, disabled_reason = null, consecutive_failures = 0 where id=$1 and organisation_id=$2 returning id`, [id, orgId, !!active]);
    if (!row) throw new NotFound('Webhook');
  },

  async remove(actor, orgId, id) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one('delete from webhook_endpoint where id=$1 and organisation_id=$2 returning id', [id, orgId]);
    if (!row) throw new NotFound('Webhook');
  },

  /**
   * Something happened at `orgId`. Every endpoint at that organisation or above it that asked for this event gets a
   * delivery queued. Never throws: whatever happened has happened, and telling others is best effort.
   */
  async emit(orgId, event, data, { only = null } = {}) {
    try {
      const org = await one('select id, slug, name from organisation where id=$1', [orgId]);
      if (!org) return [];
      const endpoints = await q(`select e.id from webhook_endpoint e join organisation o on o.id = e.organisation_id
        join organisation at on at.id = $1 and at.path <@ o.path
        where e.active and e.disabled_at is null and $2 = any(e.events) and ($3::uuid is null or e.id = $3::uuid)`, [orgId, event, only]);
      const ids = [];
      for (const e of endpoints) {
        const id = crypto.randomUUID();
        const payload = { id, event, created: new Date().toISOString(), organisation: { id: org.id, slug: org.slug, name: org.name }, data };
        await pool.query(`insert into webhook_delivery (id, endpoint_id, event, payload) values ($1,$2,$3,$4::jsonb)`, [id, e.id, event, JSON.stringify(payload)]);
        ids.push(id);
      }
      return ids;
    } catch { return []; }
  },

  /** Emit, and try to deliver straight away (briefly). Anything that does not go through is retried by the daily run. */
  async emitNow(orgId, event, data) {
    const ids = await this.emit(orgId, event, data);
    if (ids.length) await this.run({ ids, budgetMs: 3000 }).catch(() => {});
    return ids.length;
  },

  async sendTest(actor, orgId, id, deps = {}) {
    await assertRole(actor, orgId, MANAGE);
    const e = await one('select id from webhook_endpoint where id=$1 and organisation_id=$2', [id, orgId]);
    if (!e) throw new NotFound('Webhook');
    const ids = await this.emit(orgId, 'ping', { message: 'This is a test from Honbu.' }, { only: id });
    // A test is sent even if the endpoint did not ask for "ping".
    if (!ids.length) {
      const org = await one('select id, slug, name from organisation where id=$1', [orgId]);
      const did = crypto.randomUUID();
      await pool.query(`insert into webhook_delivery (id, endpoint_id, event, payload) values ($1,$2,'ping',$3::jsonb)`,
        [did, id, JSON.stringify({ id: did, event: 'ping', created: new Date().toISOString(), organisation: org, data: { message: 'This is a test from Honbu.' } })]);
      ids.push(did);
    }
    await this.run({ ids, budgetMs: 8000, ...deps });
    return one('select status, last_status, last_error from webhook_delivery where id=$1', [ids[0]]);
  },

  /** Deliver what is due (or just these). Each delivery is claimed first so two runs never send the same one twice. */
  async run({ ids = null, budgetMs = 9000, fetchFn = fetch, lookup = (h) => dns.lookup(h, { all: true }) } = {}) {
    const started = Date.now();
    const report = { delivered: 0, retrying: 0, failed: 0 };
    while (Date.now() - started < budgetMs) {
      const due = await q(`update webhook_delivery set next_attempt_at = now() + interval '2 minutes'
        where id in (select id from webhook_delivery where status='pending' and next_attempt_at <= now() and ($1::uuid[] is null or id = any($1::uuid[]))
          order by next_attempt_at limit 10 for update skip locked) returning id, endpoint_id, event, payload, attempts`, [ids]);
      if (!due.length) break;
      for (const d of due) {
        const e = await one('select id, url, secret, active, disabled_at from webhook_endpoint where id=$1', [d.endpoint_id]);
        const attempts = d.attempts + 1;
        let status = null, error = null, ok = false, permanent = false;
        if (!e || !e.active || e.disabled_at) { error = 'The webhook is switched off.'; permanent = true; }
        else {
          try {
            const host = new URL(e.url).hostname.replace(/^\[|\]$/g, '');
            const addrs = /^[\d.]+$|:/.test(host) ? [{ address: host }] : await lookup(host);
            if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) { error = 'The address is not on the public internet.'; permanent = true; }
            else {
              const body = JSON.stringify(d.payload), t = Math.floor(Date.now() / 1000);
              const sig = crypto.createHmac('sha256', e.secret).update(`${t}.${body}`).digest('hex');
              const res = await fetchFn(e.url, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(8000), headers: {
                'content-type': 'application/json', 'user-agent': 'Honbu-Webhooks/1', 'x-honbu-event': d.event, 'x-honbu-delivery': d.payload.id,
                'x-honbu-signature': `t=${t},v1=${sig}` } });
              status = res.status; ok = res.status >= 200 && res.status < 300;
              if (!ok) error = `The receiver answered ${res.status}.`;
            }
          } catch (err) { error = `Could not reach the receiver (${String(err.cause?.code ?? err.name ?? 'error').slice(0, 40)}).`; }
        }
        if (ok) {
          await pool.query(`update webhook_delivery set status='delivered', attempts=$2, last_status=$3, last_error=null, delivered_at=now(), next_attempt_at=null where id=$1`, [d.id, attempts, status]);
          await pool.query('update webhook_endpoint set consecutive_failures = 0 where id=$1', [d.endpoint_id]);
          report.delivered++;
        } else {
          const next = permanent ? null : retryAt(attempts);
          await pool.query(`update webhook_delivery set status=$2, attempts=$3, last_status=$4, last_error=$5, next_attempt_at=$6 where id=$1`,
            [d.id, next ? 'pending' : 'failed', attempts, status, error, next]);
          if (next) report.retrying++; else report.failed++;
          if (e) {
            const f = await one('update webhook_endpoint set consecutive_failures = consecutive_failures + 1 where id=$1 returning consecutive_failures', [e.id]);
            if (f.consecutive_failures >= DISABLE_AFTER_FAILED_DELIVERIES)
              await pool.query(`update webhook_endpoint set active=false, disabled_at=now(), disabled_reason='Switched off after too many failed deliveries.' where id=$1`, [e.id]);
          }
        }
      }
      if (ids) break;
    }
    // Keep the log short: delivered or failed history is kept for 30 days.
    if (!ids) await pool.query(`delete from webhook_delivery where status <> 'pending' and created_at < now() - interval '30 days'`);
    return report;
  },
};
