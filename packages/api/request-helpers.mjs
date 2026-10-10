/**
 * Small helpers the route modules share: where a request came from, and the address the federation sends mail from.
 */

/** The federation's sending address, whose domain every club sends from. */
export const sendingAddress = (env = process.env) =>
  env.MESSENGER_FROM ?? env.SMTP_FROM
  ?? (!env.MESSENGER_PROVIDER || ['log', 'none'].includes(env.MESSENGER_PROVIDER)
      ? 'noreply@log.local' : null);

export const originOf = (ctx) => `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;
