/**
 * Who may do what, and which organisation a request is about. Every route module asks these before it reads or writes anything.
 */
import { lookups, orgs, rank, Forbidden, NotFound } from './data.mjs';
import { ScheduleEvent, ReviseEvent, CancelEvent, MAY_SCHEDULE } from '../core/application/schedule-event.mjs';
import { repositories } from '../infrastructure/factory.mjs';
import { MANAGE, REGISTER, TEACH, WRITE } from '../core/domain/access.mjs';

/**
 * Who may write to the register.
 *
 * Teaching and registering are different jobs. An instructor sees the roll
 * because they need to know who is in the hall; adding somebody to it, or
 * changing what it says, is the registrar's.
 */
const MAY_REGISTER = REGISTER;

export async function mayRegisterAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_REGISTER);
}

/**
 * Who may put a page in front of the public.
 *
 * Writing and publishing are separate on purpose. A contributor is somebody
 * trusted to write and correct; deciding what the organisation says publicly
 * is the organisation's.
 */
const MAY_PUBLISH = MANAGE;

export const mayPublishAt = async (ctx, orgId) => {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_PUBLISH);
};

/**
 * The calendar use cases, built once.
 *
 * Assembled from the factory rather than reached for directly, so this route
 * file does not name a database. `repositories()` caches its imports, and the
 * use cases hold no request state, so one set serves every request in this
 * instance.
 */
let _calendar = null;
export async function calendar() {
  if (_calendar) return _calendar;
  const r = await repositories();
  const deps = { events: r.events, organisations: r.organisations,
                 auth: r.auth, clock: r.clock };
  _calendar = {
    repo: r.events,
    authz: r.auth,
    schedule: new ScheduleEvent(deps),
    revise: new ReviseEvent(deps),
    cancel: new CancelEvent({ events: r.events, auth: r.auth }),
  };
  return _calendar;
}

/**
 * The organisation named in the path — after checking the person may be there.
 *
 * Reading is checked as well as writing. The use cases stop unauthorised
 * WRITES, which is the part that matters most, but without this a signed-in
 * member of one club could fetch any other club's calendar by typing its slug,
 * including its unpublished drafts. `me.scope` is the subtree their grants
 * reach and is already computed on every request.
 *
 * `toSchedule` additionally asks whether they may change it, so a form is never
 * rendered for somebody whose submission will be refused. The answer comes from
 * the same list the use case uses, not a copy of it.
 */
export async function organisationFor(ctx, { toSchedule = false,
                                      toRegister = false,
                                      toWrite = false } = {}) {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');

  if (!ctx.me.scope?.some((o) => o.id === org.id))
    throw new Forbidden(`You do not have access to ${org.name}.`);
  await orgs.enter(org.id);

  if (toSchedule && !await mayScheduleAt(ctx, org.id)) {
    throw new Forbidden(
      `You can see ${org.name}'s calendar but not change it. `
      + 'Adding and editing events needs an owner, administrator or '
      + 'registrar role there.');
  }

  if (toWrite && !await mayWriteAt(ctx, org.id)) {
    throw new Forbidden(
      `You do not have permission to write ${org.name}'s website. `
      + 'That needs an owner, administrator or contributor role there.');
  }

  if (toRegister && !await mayRegisterAt(ctx, org.id)) {
    throw new Forbidden(
      `You can see ${org.name}'s roll but not change it. `
      + 'Adding and editing members needs an owner, administrator or '
      + 'registrar role there.');
  }

  // What the side rail shows: this organisation, in its own words, and only
  // the parts this person may use.
  const [vocabulary, register, write, manage, teach] = await Promise.all([
    orgs.vocabulary(org.id),
    mayRegisterAt(ctx, org.id),
    mayWriteAt(ctx, org.id),
    mayPublishAt(ctx, org.id),
    lookups.hasRole(ctx.me.accountId, org.id, TEACH),
  ]);
  ctx.rail = { org, vocabulary, path: ctx.url.pathname,
               can: { register, write, manage, teach } };
  return org;
}

/**
 * Whether this actor may put something on that calendar.
 *
 * Takes an organisation ID, exactly as mayRegisterAt does. It used to take an
 * organisation OBJECT, and its sibling took an id — so a call that passed an
 * id read `org.id` off a string, got undefined, and quietly answered "no".
 * That is how the entry list stopped offering the organiser any way to place
 * an unplaced competitor, with no error anywhere. Two helpers this alike need
 * the same signature.
 */
/** Who may write the website. Publishing is a separate question. */
const MAY_WRITE = WRITE;

async function mayWriteAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_WRITE);
}

export async function mayManageAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MANAGE);
}

export async function mayScheduleAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_SCHEDULE);
}

/**
 * The grade dropdowns, from whoever above this club keeps the ladder.
 *
 * Not a fixed list. A karate federation's 10th kyu to 8th dan and a taekwondo
 * federation's gup-and-dan are different ladders with different names, and the
 * form must offer the one the person filling it in actually uses.
 */
export async function gradesFor(org) {
  const owner = await orgs.ladderOwnerOf(org.id);
  if (!owner) return [];
  const rows = await rank.ladder(owner.id);
  return rows.map((g) => ({ rankOrder: g.rank_order, label: g.label }));
}
