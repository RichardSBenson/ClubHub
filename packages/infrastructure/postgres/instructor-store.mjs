/** INFRASTRUCTURE — the InstructorStore port on Postgres. */

import { PostgresStore } from './store-base.mjs';

export class PostgresInstructorStore extends PostgresStore {
  async isInstructor(personId) {
    return !!await this.one(`select 1 as x from affiliation where person_id = $1 and ends is null and role = 'instructor' and status = 'active'`, [personId]);
  }

  currentGrade(personId) { return this.one('select label, is_dan from person_current_grade where person_id = $1', [personId]); }

  async appoint({ personId, organisationId }) {
    await this.db.query(`insert into affiliation (person_id, organisation_id, role, starts, status) values ($1,$2,'instructor', current_date, 'active')`, [personId, organisationId]);
  }

  async resign(personId) {
    await this.db.query(`update affiliation set ends = current_date, status = 'resigned' where person_id = $1 and role = 'instructor' and ends is null`, [personId]);
    await this.db.query('update instructor_profile set published = false where person_id = $1', [personId]);
  }
}
