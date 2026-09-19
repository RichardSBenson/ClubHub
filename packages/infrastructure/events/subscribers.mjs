/**
 * INFRASTRUCTURE — event subscribers
 *
 * The domain announces what happened. These decide what to do about it.
 *
 * Nothing here is a business rule. "A moved page leaves a redirect" is a
 * routing concern; the domain's part was knowing the path changed and saying
 * so. That separation is the whole reason events exist — the publishing use
 * case has no idea redirects are a thing.
 *
 * Every subscriber must be:
 *   - idempotent, because events get retried
 *   - unable to throw into the emitter, because a failed listener must never
 *     fail the thing that happened
 */

import { Events } from '../../core/domain/publishing.mjs';

// ---------------------------------------------------------------------------

/**
 * A page that moves leaves a redirect behind. Without this, every link, every
 * bookmark and every search result pointing at the old path breaks silently —
 * and nobody finds out until a visitor does.
 */
export class RedirectWriter {
  constructor(pool) { this.pool = pool; }
  get subscribes() { return [Events.PATH_CHANGED, Events.PUBLICATION_WITHDRAWN]; }

  async handle(event) {
    if (event.name === Events.PATH_CHANGED) {
      const { from, to } = event.payload;
      if (from === to) return { skipped: 'same path' };

      await this.pool.query(`
        insert into redirect (from_path, to_path, permanent, reason)
        values ($1, $2, true, $3)
        on conflict (from_path) do update
          set to_path = excluded.to_path, reason = excluded.reason`,
        [from, to, `page moved ${new Date().toISOString().slice(0, 10)}`]);

      // Anything that pointed at the old path now points at the new one, so
      // chains never form. A → B → C becomes A → C and B → C.
      await this.pool.query(
        `update redirect set to_path = $2 where to_path = $1 and from_path <> $2`,
        [from, to]);

      return { wrote: `${from} → ${to}` };
    }

    if (event.name === Events.PUBLICATION_WITHDRAWN) {
      // A withdrawn page has nowhere to point. Recording the gap is still
      // useful — it turns "why is this 404ing" into an answerable question.
      await this.pool.query(`
        insert into redirect (from_path, to_path, permanent, reason)
        values ($1, '/', false, $2)
        on conflict (from_path) do nothing`,
        [event.payload.path,
         `withdrawn ${new Date().toISOString().slice(0, 10)}`]);
      return { wrote: `${event.payload.path} → / (withdrawn)` };
    }
  }
}

/**
 * Marks which pages need regenerating. The build reads this instead of
 * rebuilding everything — which is what stops a bulk edit becoming a wave of
 * work.
 */
export class RebuildQueue {
  constructor(pool) { this.pool = pool; }
  get subscribes() {
    return [Events.PUBLICATION_CREATED, Events.PUBLICATION_WITHDRAWN];
  }

  async handle(event) {
    const paths = [event.payload.path, event.payload.previousPath]
      .filter(Boolean);
    for (const path of paths) {
      await this.pool.query(`
        insert into rebuild_queue (path, reason) values ($1, $2)
        on conflict (path) do update set queued_at = now(), reason = excluded.reason`,
        [path, event.name]);
    }
    return { queued: paths };
  }
}

// ---------------------------------------------------------------------------

/**
 * Stores every event, then hands it to whoever subscribes.
 *
 * Storing first matters: a subscriber that fails can be retried, and months
 * later "why did that page change" has an answer.
 */
export class DispatchingEventBus {
  constructor(pool, subscribers = []) {
    this.pool = pool;
    this.subscribers = subscribers;
  }

  emit(event) {
    // Fire and forget. The domain must never fail because a listener did.
    this.#run(event).catch((e) =>
      console.error(`event ${event.name} not handled:`, e.message));
  }

  async #run(event) {
    const { rows: [row] } = await this.pool.query(
      `insert into domain_event (name, payload, occurred_at)
       values ($1,$2,$3) returning id`,
      [event.name, JSON.stringify(event.payload), event.at]);

    const listeners = this.subscribers.filter((s) =>
      s.subscribes.includes(event.name));
    if (!listeners.length) {
      await this.pool.query(
        `update domain_event set handled_at = now() where id = $1`, [row.id]);
      return;
    }

    const errors = [];
    for (const s of listeners) {
      try { await s.handle(event); }
      catch (e) { errors.push(`${s.constructor.name}: ${e.message}`); }
    }

    await this.pool.query(`
      update domain_event set handled_at = $2, attempts = attempts + 1,
             last_error = $3 where id = $1`,
      [row.id, errors.length ? null : new Date(), errors.join('; ') || null]);
  }

  /** Retries anything that failed. Run it alongside the scheduler. */
  async retryFailed({ limit = 50 } = {}) {
    const { rows } = await this.pool.query(`
      select id, name, payload from domain_event
      where handled_at is null and attempts < 5
      order by occurred_at limit $1`, [limit]);

    let recovered = 0;
    for (const row of rows) {
      const event = { name: row.name, payload: row.payload };
      const listeners = this.subscribers.filter((s) =>
        s.subscribes.includes(event.name));
      const errors = [];
      for (const s of listeners) {
        try { await s.handle(event); }
        catch (e) { errors.push(`${s.constructor.name}: ${e.message}`); }
      }
      await this.pool.query(`
        update domain_event set handled_at = $2, attempts = attempts + 1,
               last_error = $3 where id = $1`,
        [row.id, errors.length ? null : new Date(), errors.join('; ') || null]);
      if (!errors.length) recovered++;
    }
    return { tried: rows.length, recovered };
  }
}
