/**
 * The one error every messenger raises.
 *
 * In its own file so that a messenger can import it without importing the
 * factory that builds messengers — which would be a cycle, and cycles are
 * the sort of thing that works until somebody adds a line at module scope.
 */
export class MessengerError extends Error {
  constructor(message, { status = null, provider = null } = {}) {
    super(message);
    this.name = 'MessengerError';
    this.status = status;
    this.provider = provider;
  }
}
