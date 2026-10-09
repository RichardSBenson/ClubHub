/**
 * HONBU — data access: content
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { validate, excerpt, toText } from '../../content/blocks.mjs';
import { problemsWithScheduleDate } from '../../core/domain/scheduling.mjs';
import { MANAGE, TEACH } from '../../core/domain/access.mjs';
import { Invalid, NotFound, WRITE_PAGES, assertRole, insertAsset, one, q } from './shared.mjs';

export const pages = {
  async published(orgId, slug) {
    return one(`select * from page
      where organisation_id=$1 and slug=$2 and status='published'`, [orgId, slug]);
  },

  async listPublished(orgId) {
    return q(`select slug, title, meta_description, published_at from page
      where organisation_id=$1 and status='published' order by title`, [orgId]);
  },

  /** Every page an editor may work on, drafts included. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    return q(`
      select p.id, p.slug, p.title, p.status, p.published_at, p.updated_at,
             per.first_name || ' ' || per.last_name as updated_by,
             (select count(*)::int from page_revision r where r.page_id = p.id)
               as revisions
      from page p
      left join person per on per.id = p.updated_by
      where p.organisation_id = $1
      order by p.status, p.title`, [orgId]);
  },

  async byId(actor, pageId) {
    const page = await one('select * from page where id = $1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, WRITE_PAGES);
    return page;
  },

  /**
   * Save a draft. The document is validated on the way in — anything not in the
   * block whitelist is dropped here, not at render time.
   * Returns what was dropped so the editor can tell the author.
   */
  async save(actor, { pageId, organisationId, slug, title, body,
                      metaTitle, metaDescription, note }) {
    const orgId = organisationId ??
      (await one('select organisation_id from page where id=$1', [pageId]))?.organisation_id;
    if (!orgId) throw new NotFound('Page');
    await assertRole(actor, orgId, WRITE_PAGES);

    const { doc, dropped } = validate(body);
    if (!toText(doc).trim()) throw new Invalid('The page has no content');

    const person = await one('select person_id from account where id=$1', [actor]);
    const client = await pool.connect();
    try {
      await client.query('begin');
      let page;
      if (pageId) {
        // The address can change. A page whose web address is fixed at
        // creation is one somebody has to delete and rewrite to rename, and
        // they will — losing its revisions with it.
        ({ rows: [page] } = await client.query(`
          update page set title=$2, body=$3, meta_title=$4, meta_description=$5,
                          slug=coalesce($7, slug),
                          updated_by=$6, updated_at=now()
          where id=$1 returning *`,
          [pageId, title, doc, metaTitle, metaDescription ?? excerpt(doc),
           person?.person_id, slug || null]));
      } else {
        ({ rows: [page] } = await client.query(`
          insert into page (organisation_id, slug, title, body, meta_title,
                            meta_description, status, updated_by)
          values ($1,$2,$3,$4,$5,$6,'draft',$7) returning *`,
          [orgId, slug, title, doc, metaTitle, metaDescription ?? excerpt(doc),
           person?.person_id]));
      }

      await client.query(`
        insert into page_revision (page_id, title, body, meta_title,
                                   meta_description, saved_by, note)
        values ($1,$2,$3,$4,$5,$6,$7)`,
        [page.id, page.title, page.body, page.meta_title, page.meta_description,
         person?.person_id, note ?? null]);

      await client.query('commit');
      return { page, dropped };
    } catch (e) {
      await client.query('rollback');
      if (e.code === '23505')
        throw new Invalid(`This organisation already has a page at "${slug}".`);
      throw e;
    }
    finally { client.release(); }
  },

  /**
   * Publishing is a separate permission from writing.
   *
   * A contributor can write and correct; putting something in front of the
   * public is the organisation's decision, not the author's. Which is also
   * why unpublishing is here rather than a status field on the form.
   */
  async publish(actor, pageId) {
    const page = await one('select * from page where id=$1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, MANAGE);
    return one(`update page set status='published', published_at=now(), publish_at=null
      where id=$1 returning *`, [pageId]);
  },

  /**
   * Take it down without losing it.
   *
   * Back to a draft, not deleted: the words, the revisions and the address
   * all stay, so a page pulled for a correction can go back up as it was.
   */
  async unpublish(actor, pageId) {
    const page = await one('select * from page where id=$1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, MANAGE);
    return one(`update page set status='draft', updated_at=now()
      where id=$1 returning *`, [pageId]);
  },

  async revisions(actor, pageId) {
    const page = await one('select organisation_id from page where id=$1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, WRITE_PAGES);
    return q(`select r.id, r.title, r.saved_at, r.note,
                     p.first_name || ' ' || p.last_name as saved_by
              from page_revision r
              left join person p on p.id = r.saved_by
              where r.page_id=$1 order by r.saved_at desc`, [pageId]);
  },

  async restore(actor, revisionId) {
    const rev = await one(`select r.*, pg.organisation_id
      from page_revision r join page pg on pg.id = r.page_id
      where r.id=$1`, [revisionId]);
    if (!rev) throw new NotFound('Revision');
    await assertRole(actor, rev.organisation_id, MANAGE);
    return one(`update page set title=$2, body=$3, meta_title=$4,
                                meta_description=$5, updated_at=now()
      where id=$1 returning *`,
      [rev.page_id, rev.title, rev.body, rev.meta_title, rev.meta_description]);
  },
};

export const assets = {
  /** One federation's images, newest first. Never the bytes. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, TEACH);
    const { rows } = await pool.query(`
      select id, filename, mime, width, height, bytes, alt_text, credit,
             created_at
      from asset
      where organisation_id = $1
      order by created_at desc`, [orgId]);
    return rows;
  },

  /**
   * An asset's metadata, with the organisation it belongs to.
   *
   * Deliberately does not check a role: the caller has to, because the check
   * depends on what it is about to do, and a function that both fetches and
   * authorises tempts a caller into thinking the fetch alone was enough.
   */
  async byId(id) {
    return one(`select * from asset where id = $1`, [id]);
  },

  /**
   * An image and its bytes, for somebody allowed to see it.
   *
   * Fetch and permission are one call here, on purpose, and it is the only way
   * to reach the bytes. An asset id is an unguessable uuid, but unguessable is
   * not a permission model — ids end up in drafts, in logs, in a browser
   * history — so the viewer must hold a role at the federation that owns it,
   * exactly as for every other record.
   */
  async forViewing(actor, id) {
    const asset = await this.byId(id);
    if (!asset) throw new NotFound('Image');
    await assertRole(actor, asset.organisation_id, TEACH);
    const row = await one(`select bytes from asset_blob where asset_id = $1`, [id]);
    if (!row?.bytes) throw new NotFound('Image');
    return { asset, bytes: row.bytes };
  },

  /** The bytes alone, for the build. No actor: the build is not a person. */
  async bytesOf(id) {
    const row = await one(`select bytes from asset_blob where asset_id = $1`, [id]);
    return row?.bytes ?? null;
  },

  /**
   * Store an image.
   *
   * `identified` comes from images.mjs, which read it out of the bytes — the
   * mime recorded here is never the one the uploader declared.
   */
  async create(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    return insertAsset(actor, orgId, input);
  },

  /** Change what an image says about itself. Not its bytes — those are fixed. */
  async describe(actor, id, { altText, credit, consentRef }) {
    const asset = await this.byId(id);
    if (!asset) throw new NotFound('Image');
    await assertRole(actor, asset.organisation_id, MANAGE);
    return one(`update asset set alt_text=$2, credit=$3, consent_ref=$4
                where id=$1 returning *`,
      [id, altText?.trim() || null, credit?.trim() || null,
       consentRef?.trim() || null]);
  },

  /**
   * Which published pages use this image.
   *
   * Asked before deleting one. A page's body is a block document, and an image
   * block holds the asset's id as a string, so this looks for that id anywhere
   * in the document rather than trying to walk the block tree in SQL.
   */
  async usedBy(actor, id) {
    const asset = await this.byId(id);
    if (!asset) throw new NotFound('Image');
    await assertRole(actor, asset.organisation_id, TEACH);
    const { rows } = await pool.query(`
      select id, title, slug, status from page
      where organisation_id = $1 and body::text like $2
      order by title`, [asset.organisation_id, `%${id}%`]);
    return rows;
  },

  /**
   * Remove an image, unless a page is still pointing at it.
   *
   * Deleting one that is in use would empty that page's image block silently,
   * which is the exact failure this whole feature exists to end. So the
   * refusal names the pages and lets somebody go and fix them.
   */
  async remove(actor, id) {
    const asset = await this.byId(id);
    if (!asset) throw new NotFound('Image');
    await assertRole(actor, asset.organisation_id, MANAGE);

    const used = await this.usedBy(actor, id);
    if (used.length)
      throw new Invalid(
        `That image is used by ${used.map((p) => `"${p.title}"`).join(', ')}. `
        + 'Remove it from those pages first.');

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before)
      values ($1,$2,'asset_delete','asset',$3,$4)`,
      [actor, asset.organisation_id, id,
       JSON.stringify({ filename: asset.filename, mime: asset.mime })]);

    await pool.query(`delete from asset where id = $1`, [id]);
    return { deleted: true, filename: asset.filename };
  },
};

// ---------------------------------------------------------------------------
// news
//
// Articles are pages with a date, a hero image and somewhere to go. The one
// thing that makes them different is that a dojo's article can ask to appear
// on the federation's site, and the federation decides — see db/017. A
// federation's name on a page reads as an endorsement whether it was meant as
// one or not.
// ---------------------------------------------------------------------------

export const news = {
  /** One organisation's articles, newest first. Drafts included. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    const { rows } = await pool.query(`
      select a.id, a.slug, a.title, a.summary, a.status, a.published_at,
             a.publish_up, a.publish_up_state, a.tags, a.hero_asset_id,
             about.name as about_org
      from article a
      left join organisation about on about.id = a.about_org_id
      where a.organisation_id = $1
      order by coalesce(a.published_at, 'infinity'::timestamptz) desc,
               a.title`, [orgId]);
    return rows;
  },

  /** Articles beneath this organisation that are waiting on its decision. */
  async awaitingDecision(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select a.id, a.slug, a.title, a.summary, a.published_at,
             o.name as from_org, o.slug as from_slug
      from article a
      join organisation o on o.id = a.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      where a.publish_up_state = 'requested' and o.id <> $1
      order by a.published_at desc nulls last`, [orgId]);
    return rows;
  },

  async byId(actor, id) {
    const row = await one(`select * from article where id = $1`, [id]);
    if (!row) throw new NotFound('Article');
    await assertRole(actor, row.organisation_id, WRITE_PAGES);
    return row;
  },

  /**
   * Create or update a draft.
   *
   * The body goes through the same validator pages use, so a block type
   * nobody whitelisted cannot arrive here by being posted at a different URL.
   */
  async save(actor, { articleId, organisationId, slug, title, summary, body,
                      heroAssetId = null, tags = [], aboutOrgId = null }) {
    const orgId = organisationId ?? (await one(
      'select organisation_id from article where id=$1', [articleId]))?.organisation_id;
    if (!orgId) throw new NotFound('Article');
    await assertRole(actor, orgId, WRITE_PAGES);

    const { doc, dropped } = validate(body);
    if (!toText(doc).trim()) throw new Invalid('The article has no content');

    // A hero image has to belong to this federation. Otherwise an article
    // could point at another federation's photograph by id, and the build
    // would dutifully copy it onto this site.
    if (heroAssetId) {
      const owns = await one(`
        select 1 from asset a
        join organisation o on o.id = a.organisation_id
        join organisation mine on mine.id = $2
        where a.id = $1 and (o.path <@ mine.path or mine.path <@ o.path)`,
        [heroAssetId, orgId]);
      if (!owns) throw new Invalid('That image does not belong to this organisation');
    }

    const clean = (tags ?? []).map((t) => String(t).trim().toLowerCase())
      .filter(Boolean).slice(0, 12);

    const row = articleId
      ? await one(`
          update article set slug=$2, title=$3, summary=$4, body=$5,
                             hero_asset_id=$6, tags=$7, about_org_id=$8
          where id=$1 returning *`,
          [articleId, slug, title, summary, doc, heroAssetId, clean, aboutOrgId])
      : await one(`
          insert into article (organisation_id, slug, title, summary, body,
                               hero_asset_id, tags, about_org_id, status,
                               author_id)
          values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) returning *`,
          [orgId, slug, title, summary, doc, heroAssetId, clean, aboutOrgId,
           // Who wrote it. The column has existed since articles did and
           // nothing ever filled it in, so every article in the register was
           // anonymous. Set on creation only: later edits do not make the
           // editor the author.
           (await one('select person_id from account where id=$1', [actor]))
             ?.person_id ?? null]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,$3,'article',$4,$5)`,
      [actor, orgId, articleId ? 'article_update' : 'article_create', row.id,
       JSON.stringify({ slug, title })]);

    return { article: row, dropped };
  },

  async publish(actor, id) {
    const a = await this.byId(actor, id);
    await assertRole(actor, a.organisation_id, MANAGE);
    return one(`update article set status='published', publish_at = null,
                  published_at = coalesce(published_at, now())
                where id=$1 returning *`, [id]);
  },

  async unpublish(actor, id) {
    const a = await this.byId(actor, id);
    await assertRole(actor, a.organisation_id, MANAGE);
    return one(`update article set status='draft' where id=$1 returning *`, [id]);
  },

  /** The author asks for it to appear on the federation's site. */
  async requestPublishUp(actor, id) {
    const a = await this.byId(actor, id);
    await assertRole(actor, a.organisation_id, MANAGE);
    if (a.status !== 'published')
      throw new Invalid('Publish it on your own site before asking for it to '
        + 'appear on the federation\'s.');
    return one(`update article set publish_up=true, publish_up_state='requested'
                where id=$1 returning *`, [id]);
  },

  /**
   * The federation decides.
   *
   * Declining is not deleting: the article stays published on the author's own
   * site. What is refused is the federation's endorsement, and an author told
   * no should be able to see that they were told no.
   */
  async decidePublishUp(actor, id, approve, { decidedBy }) {
    const a = await one(`select * from article where id=$1`, [id]);
    if (!a) throw new NotFound('Article');
    await assertRole(actor, decidedBy, MANAGE);

    // The decision belongs to an organisation this article sits beneath, and
    // not to the article's own, or a dojo would approve itself.
    const beneath = await one(`
      select 1 from organisation mine, organisation theirs
      where mine.id = $1 and theirs.id = $2
        and theirs.path <@ mine.path and theirs.id <> mine.id`,
      [decidedBy, a.organisation_id]);
    if (!beneath)
      throw new Invalid('That article does not sit beneath this organisation.');

    const row = await one(`
      update article set publish_up_state=$2, publish_up=$3
      where id=$1 returning *`,
      [id, approve ? 'approved' : 'declined', approve]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,'article_publish_up','article',$3,$4,$5)`,
      [actor, decidedBy, id,
       JSON.stringify({ publish_up_state: a.publish_up_state }),
       JSON.stringify({ publish_up_state: row.publish_up_state,
                        title: row.title })]);

    return row;
  },
};

const schedulable = (table, label) => ({
  async schedule(actor, id, date) {
    const row = await one(`select t.id, t.organisation_id, t.title, t.status, o.timezone from ${table} t /* security-ok: table is a literal passed by schedulable() for page or article only */
      join organisation o on o.id = t.organisation_id where t.id = $1`, [id]);
    if (!row) throw new NotFound(label);
    await assertRole(actor, row.organisation_id, MANAGE);
    if (row.status === 'published') throw new Invalid('It is already live.');
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [row.timezone])).d;
    const problems = problemsWithScheduleDate(date, today);
    if (problems.length) throw new Invalid(problems.join(' '));
    await q(`update ${table} set publish_at = ($2::date)::timestamp at time zone $3 where id = $1`, [id, date, row.timezone]); /* security-ok: table is a literal passed by schedulable() for page or article only */
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'publish_scheduled',$3,$4,$5)`, [actor, row.organisation_id, table, id, JSON.stringify({ title: row.title, date })]);
    return { date };
  },

  async unschedule(actor, id) {
    const row = await one(`select organisation_id, title from ${table} where id=$1`, [id]); /* security-ok: table is a literal passed by schedulable() for page or article only */
    if (!row) throw new NotFound(label);
    await assertRole(actor, row.organisation_id, MANAGE);
    await q(`update ${table} set publish_at = null where id=$1`, [id]); /* security-ok: table is a literal passed by schedulable() for page or article only */
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'publish_unscheduled',$3,$4,$5)`, [actor, row.organisation_id, table, id, JSON.stringify({ title: row.title })]);
  },

  async scheduledFor(id) {
    return (await one(`select to_char(publish_at at time zone o.timezone,'YYYY-MM-DD') as d from ${table} t /* security-ok: table is a literal passed by schedulable() for page or article only */
      join organisation o on o.id = t.organisation_id where t.id=$1 and t.status='draft' and t.publish_at is not null`, [id]))?.d ?? null;
  },
});

Object.assign(pages, schedulable('page', 'Page'));

Object.assign(news, schedulable('article', 'Article'));

export const scheduledPublishing = {
  /** Bring everything that is due live. Returns what went live, so the caller can rebuild the site once. */
  async run() {
    const made = [];
    for (const [table, label] of [['page', 'page'], ['article', 'article']]) {
      const rows = await q(`update ${table} set status='published', publish_at = null,
          published_at = coalesce(published_at, now())
        where status = 'draft' and publish_at is not null and publish_at <= now()
        returning id, organisation_id, title`);
      for (const r of rows) {
        await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
          values (null,$1,'published_on_schedule',$2,$3,$4)`, [r.organisation_id, table, r.id, JSON.stringify({ title: r.title })]);
        made.push({ kind: label, id: r.id, title: r.title });
      }
    }
    return made;
  },
};

// ---------------------------------------------------------------------------
// A dojo's photo gallery
// ---------------------------------------------------------------------------

export const MAX_GALLERY = 300;

/** The year a picture belongs to when nobody said: this one, in the dojo's own calendar. */
const thisYear = () => new Date().getFullYear();

/** A year somebody typed, checked; blank means "work it out". */
function readYear(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1950 || n > thisYear() + 1) throw new Invalid(`The year must be between 1950 and ${thisYear() + 1}.`);
  return n;
}

export const gallery = {
  /** Newest year first, then by event, then in the order the dojo set. */
  async list(actor, orgId, { year = null, eventId = null } = {}) {
    await assertRole(actor, orgId, TEACH);
    return q(`select g.id, g.asset_id, g.caption, g.position, g.year, g.event_id, g.created_at,
        e.title as event_title, e.starts_at as event_starts,
        a.filename, a.width, a.height, a.alt_text
      from club_gallery g join asset a on a.id = g.asset_id
      left join event e on e.id = g.event_id
      where g.organisation_id = $1
        and ($2::int is null or g.year = $2)
        and ($3::uuid is null or g.event_id = $3)
      order by g.year desc nulls last, e.starts_at desc nulls last, g.event_id nulls last, g.position, g.created_at`,
      [orgId, year, eventId]);
  },

  /** The events a picture can be filed under: this dojo's own, newest first. */
  async events(actor, orgId) {
    await assertRole(actor, orgId, TEACH);
    return q(`select id, title, starts_at from event where organisation_id = $1 and status <> 'cancelled'
      order by starts_at desc limit 300`, [orgId]);
  },

  /** Years that have pictures, newest first, with how many. */
  async years(actor, orgId) {
    await assertRole(actor, orgId, TEACH);
    return q(`select year, count(*)::int as n from club_gallery where organisation_id = $1 and year is not null
      group by year order by year desc`, [orgId]);
  },

  /** Checks an event belongs to this dojo and returns it (or null for "no event"). */
  async _event(orgId, eventId) {
    if (!eventId) return null;
    const e = await one('select id, starts_at from event where id = $1 and organisation_id = $2', [eventId, orgId]);
    if (!e) throw new Invalid('Choose one of this club\'s own events.');
    return e;
  },

  async add(actor, orgId, assetId, caption = null, { year = null, eventId = null } = {}) {
    await assertRole(actor, orgId, TEACH);
    const a = await one('select organisation_id, alt_text from asset where id = $1', [assetId]);
    if (!a || a.organisation_id !== orgId) throw new Invalid('Choose one of this club\'s own pictures.');
    const count = (await one('select count(*)::int as n from club_gallery where organisation_id = $1', [orgId])).n;
    if (count >= MAX_GALLERY) throw new Invalid(`A gallery holds up to ${MAX_GALLERY} pictures. Remove some first.`);
    if (await one('select 1 as x from club_gallery where organisation_id = $1 and asset_id = $2', [orgId, assetId]))
      throw new Invalid('That picture is already in the gallery.');
    const ev = await this._event(orgId, eventId);
    // An event gives a picture its year unless somebody said otherwise.
    const y = readYear(year) ?? (ev ? new Date(ev.starts_at).getFullYear() : thisYear());
    const cap = String(caption ?? '').trim().slice(0, 160) || null;
    await pool.query('insert into club_gallery (organisation_id, asset_id, caption, position, year, event_id) values ($1,$2,$3,$4,$5,$6)',
      [orgId, assetId, cap, count, y, ev?.id ?? null]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id) values ($1,$2,'gallery_added','asset',$3)`, [actor, orgId, assetId]);
  },

  /**
   * Set the year and/or event on several pictures at once. `undefined` leaves a field alone;
   * eventId '' or null takes the picture out of its event.
   */
  async file(actor, orgId, ids, { year, eventId }) {
    await assertRole(actor, orgId, TEACH);
    if (!ids.length) throw new Invalid('Tick at least one picture first.');
    const sets = [], args = [orgId, ids];
    if (year !== undefined) {
      const y = readYear(year);
      if (y != null) { args.push(y); sets.push(`year = $${args.length}`); }
    }
    if (eventId !== undefined) {
      const ev = await this._event(orgId, eventId || null);
      args.push(ev?.id ?? null); sets.push(`event_id = $${args.length}`);
      // Putting pictures into an event with no year chosen files them under the event's year.
      if (ev && (year === undefined || String(year).trim() === '')) {
        args.push(new Date(ev.starts_at).getFullYear()); sets.push(`year = $${args.length}`);
      }
    }
    if (!sets.length) throw new Invalid('Choose a year or an event to file them under.');
    await pool.query(`update club_gallery set ${sets.join(', ')} where organisation_id = $1 and id = any($2::uuid[])`, args); /* security-ok: sets holds only fragments we wrote, values are $n placeholders */
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, after) values ($1,$2,'gallery_filed','club_gallery',$3)`,
      [actor, orgId, JSON.stringify({ count: ids.length, year: year ?? null, eventId: eventId ?? null })]);
  },

  async remove(actor, orgId, id) { return this.removeMany(actor, orgId, [id]); },

  async removeMany(actor, orgId, ids) {
    await assertRole(actor, orgId, TEACH);
    if (!ids.length) throw new Invalid('Tick at least one picture first.');
    await pool.query('delete from club_gallery where organisation_id = $1 and id = any($2::uuid[])', [orgId, ids]);
    await pool.query(`update club_gallery g set position = s.rn from (select id, row_number() over (order by position, created_at) - 1 as rn
      from club_gallery where organisation_id = $1) s where g.id = s.id`, [orgId]);
  },

  async caption(actor, orgId, id, caption) {
    await assertRole(actor, orgId, TEACH);
    await pool.query('update club_gallery set caption = $3 where id = $1 and organisation_id = $2',
      [id, orgId, String(caption ?? '').trim().slice(0, 160) || null]);
  },

  /** direction -1 = earlier, +1 = later. Swaps with its neighbour in the same year and event. */
  async move(actor, orgId, id, direction) {
    await assertRole(actor, orgId, TEACH);
    const me = await one('select year, event_id from club_gallery where id = $1 and organisation_id = $2', [id, orgId]);
    if (!me) return;
    const rows = await q(`select id, position from club_gallery where organisation_id = $1
      and year is not distinct from $2 and event_id is not distinct from $3 order by position, created_at`, [orgId, me.year, me.event_id]);
    const i = rows.findIndex((r) => r.id === id), j = i + (direction < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= rows.length) return;
    // Give the group a clean run of positions, then swap the two.
    const order = rows.map((r) => r.id);
    [order[i], order[j]] = [order[j], order[i]];
    const base = Math.min(...rows.map((r) => r.position));
    for (let k = 0; k < order.length; k++)
      await pool.query('update club_gallery set position = $2 where id = $1', [order[k], base + k]);
  },
};
