/**
 * HONBU — member cards as wallet passes
 *
 * Not an app screen. A pass in Apple Wallet or Google Wallet, because:
 *
 *  - A parent can hold three children's cards at once. The one-card-per-phone
 *    limit that makes app-based cards unusable for families does not exist here.
 *  - It works with no signal, at the door of a hall with bad reception.
 *  - It expires by itself when affiliation lapses. Nobody has to collect it.
 *  - There is nothing to install.
 *
 * The card carries the member number, current grade and dojo. The barcode
 * carries a signed token, so a card can be verified at an event without a
 * database lookup — which matters when the venue has no wifi.
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// the verification token
// ---------------------------------------------------------------------------

const b64u = (b) => Buffer.from(b).toString('base64url');

/**
 * Postgres returns dates as JS Date objects. String(date).slice(0,10) gives
 * "Thu Dec 31", which then fails to parse and quietly expires every card ever
 * issued. Always format explicitly.
 */
export const isoDate = (d) => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

/**
 * A compact signed token: member, grade, expiry. Verifiable offline with the
 * federation's public key, so a door scanner needs no connection.
 *
 * Deliberately short — it has to survive being printed as a QR code and
 * scanned from a cracked phone screen in a badly lit hall.
 */
export function signToken({ memberNumber, rankOrder, expires, orgSlug }, secret) {
  const payload = `${memberNumber}|${rankOrder ?? ''}|${expires}|${orgSlug}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest();
  return `${b64u(payload)}.${b64u(sig.subarray(0, 12))}`;   // 12 bytes is plenty
}

export function verifyToken(token, secret, now = new Date()) {
  const [p, s] = String(token).split('.');
  if (!p || !s) return { valid: false, reason: 'Malformed' };

  const payload = Buffer.from(p, 'base64url').toString();
  const expect = b64u(crypto.createHmac('sha256', secret).update(payload)
    .digest().subarray(0, 12));

  // Constant-time compare — a scanner at a public event is an oracle otherwise.
  const a = Buffer.from(s), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return { valid: false, reason: 'Signature does not match' };

  const [memberNumber, rankOrder, expires, orgSlug] = payload.split('|');
  if (new Date(expires) < now)
    return { valid: false, reason: `Expired ${expires}`, memberNumber, expires };

  return {
    valid: true, memberNumber, orgSlug, expires,
    rankOrder: rankOrder === '' ? null : Number(rankOrder),
  };
}

// ---------------------------------------------------------------------------
// Apple Wallet
// ---------------------------------------------------------------------------

/**
 * Builds pass.json and the manifest. Signing needs an Apple Developer pass-type
 * certificate, which is a $99/year account and a one-off setup — see
 * docs/wallet.md. Everything up to the signature is here and testable.
 */
export function applePass(member, federation, config) {
  const {
    passTypeIdentifier, teamIdentifier, organizationName, webServiceURL,
  } = config;

  const pass = {
    formatVersion: 1,
    passTypeIdentifier,
    teamIdentifier,
    organizationName: organizationName ?? federation.name,
    serialNumber: member.memberNumber,
    description: `${federation.name} membership`,

    foregroundColor: rgb(config.tokens?.canvas ?? '#FFFFFF'),
    backgroundColor: rgb(config.tokens?.ink ?? '#1C1C1E'),
    labelColor: rgb(config.tokens?.accent ?? '#F0CE41'),

    // Dies on its own when affiliation lapses.
    expirationDate: new Date(member.expires).toISOString(),
    voided: new Date(member.expires) < new Date(),

    barcodes: [{
      format: 'PKBarcodeFormatQR',
      message: member.token,
      messageEncoding: 'iso-8859-1',
      altText: member.memberNumber,
    }],

    generic: {
      primaryFields: [
        { key: 'name', label: 'MEMBER', value: member.name },
      ],
      secondaryFields: [
        { key: 'grade', label: 'GRADE', value: member.grade ?? 'Ungraded' },
        { key: 'dojo', label: 'DOJO', value: member.dojo },
      ],
      auxiliaryFields: [
        { key: 'number', label: 'NUMBER', value: member.memberNumber },
        { key: 'expires', label: 'PAID UNTIL',
          value: new Date(member.expires).toISOString(),
          dateStyle: 'PKDateStyleMedium' },
      ],
      backFields: [
        { key: 'federation', label: 'Organisation', value: federation.name },
        { key: 'since', label: 'Member since',
          value: new Date(member.since).toISOString(),
          dateStyle: 'PKDateStyleMedium' },
        ...(member.history?.length ? [{
          key: 'history', label: 'Grading history',
          value: member.history
            .map((h) => `${h.label} — ${isoDate(h.awarded_on)}`)
            .join('\n'),
        }] : []),
      ],
    },
  };

  if (webServiceURL) {
    pass.webServiceURL = webServiceURL;
    pass.authenticationToken = member.updateToken;
  }

  return pass;
}

/** SHA-1 manifest of every file in the pass bundle. Apple's format, not ours. */
export function appleManifest(files) {
  const manifest = {};
  for (const [name, buf] of Object.entries(files)) {
    manifest[name] = crypto.createHash('sha1').update(buf).digest('hex');
  }
  return manifest;
}

const rgb = (hex) => {
  const h = hex.replace('#', '');
  const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${n.join(',')})`;
};

// ---------------------------------------------------------------------------
// Google Wallet
// ---------------------------------------------------------------------------

/**
 * A generic pass class — created once per federation — and one object per
 * member. Google takes these as a signed JWT.
 */
export function googleClass(federation, config) {
  return {
    id: `${config.issuerId}.${federation.slug}`,
    issuerName: federation.name,
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: config.tokens?.ink ?? '#1C1C1E',
    ...(config.logoUrl && {
      logo: { sourceUri: { uri: config.logoUrl },
              contentDescription: { defaultValue: {
                language: 'en-NZ', value: `${federation.name} crest` } } },
    }),
  };
}

export function googleObject(member, federation, config) {
  return {
    id: `${config.issuerId}.${member.memberNumber.replace(/[^\w.-]/g, '')}`,
    classId: `${config.issuerId}.${federation.slug}`,
    state: new Date(member.expires) < new Date() ? 'EXPIRED' : 'ACTIVE',
    cardTitle: text(federation.name),
    header: text(member.name),
    validTimeInterval: { end: { date: new Date(member.expires).toISOString() } },
    barcode: { type: 'QR_CODE', value: member.token,
               alternateText: member.memberNumber },
    textModulesData: [
      { id: 'grade', header: 'Grade', body: member.grade ?? 'Ungraded' },
      { id: 'dojo', header: 'Dojo', body: member.dojo },
      { id: 'number', header: 'Member number', body: member.memberNumber },
    ],
  };
}

const text = (v) => ({ defaultValue: { language: 'en-NZ', value: v } });

/** The JWT Google Wallet expects. Signed with the issuer service account key. */
export function googleJwt(objects, config, signer) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: config.serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: config.origins ?? [],
    payload: { genericObjects: objects },
  };
  const unsigned = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  return signer ? `${unsigned}.${signer(unsigned)}` : { unsigned, claims };
}

// ---------------------------------------------------------------------------
// assembling a member's card from the register
// ---------------------------------------------------------------------------

/**
 * Pulls everything a card needs in one query, and refuses to issue one for a
 * lapsed member. A card that outlives affiliation is worse than no card.
 */
export async function cardFor(pool, personId, { secret, includeHistory = false } = {}) {
  const { rows: [m] } = await pool.query(`
    select p.id, p.display_number, p.first_name, p.last_name,
           coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as name,
           cg.label as grade, cg.rank_order,
           o.name as dojo, o.slug as dojo_slug,
           a.paid_until, a.starts as since, a.status,
           root.name as federation_name, root.slug as federation_slug
    from person p
    join affiliation a on a.person_id = p.id and a.ends is null and a.role = 'member'
    join organisation o on o.id = a.organisation_id
    join organisation root on o.path <@ root.path and root.parent_id is null
    left join person_current_grade cg on cg.person_id = p.id
    where p.id = $1`, [personId]);

  if (!m) return { issued: false, reason: 'No current membership' };
  if (m.status !== 'active') return { issued: false, reason: `Membership is ${m.status}` };
  if (!m.paid_until) return { issued: false, reason: 'No paid-until date on file' };
  if (!m.display_number) return { issued: false, reason: 'No member number assigned' };

  let history = [];
  if (includeHistory) {
    ({ rows: history } = await pool.query(`
      select g.label, gr.awarded_on from grading_record gr
      join grade g on g.id = gr.grade_id
      where gr.person_id = $1 and gr.result = 'pass'
      order by g.rank_order`, [personId]));
  }

  const member = {
    memberNumber: m.display_number,
    name: m.name,
    grade: m.grade,
    rankOrder: m.rank_order,
    dojo: m.dojo,
    expires: m.paid_until,
    since: m.since,
    history,
  };

  const expires = isoDate(m.paid_until);
  if (!expires) return { issued: false, reason: 'Paid-until date is not a valid date' };
  member.expires = expires;

  member.token = signToken({
    memberNumber: member.memberNumber,
    rankOrder: member.rankOrder,
    expires,
    orgSlug: m.federation_slug,
  }, secret);

  return { issued: true, member,
    federation: { name: m.federation_name, slug: m.federation_slug } };
}
