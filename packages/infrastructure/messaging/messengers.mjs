/**
 * INFRASTRUCTURE — messengers
 *
 * Three implementations of one port. The application knows none of them.
 *
 *   LogMessenger      writes the message where a developer can read it
 *   MemoryMessenger   keeps them in an array, for tests
 *   HttpMessenger     posts to a provider's HTTP API
 *
 * The system runs today on the first. Adding a provider later means setting
 * two environment variables — nothing above this file changes.
 *
 * Why HTTP and not SMTP: a serverless function stops once it responds, and
 * SMTP needs DNS, TCP, TLS, auth and transfer to complete on one socket before
 * that happens. An HTTP send is a single awaited request.
 */

export class MessengerError extends Error {
  constructor(message, { status = null, provider = null } = {}) {
    super(message);
    this.name = 'MessengerError';
    this.status = status;
    this.provider = provider;
  }
}

// ---------------------------------------------------------------------------

/**
 * No provider, no account, no DNS. The message goes to the log, where it can be
 * read from the Vercel dashboard.
 *
 * Good enough to test the whole sign-in flow. Not good enough for anyone but
 * the person with access to the logs — which is the point.
 */
export class LogMessenger {
  constructor({ logger = console } = {}) { this.logger = logger; }

  async send({ to, subject, text, kind }) {
    this.logger.warn(
      `\n─── ${kind ?? 'message'} for ${to} ───\n` +
      `${subject}\n\n${text}\n` +
      `─── not sent: no messenger configured ───\n`);
    return { delivered: true, id: null, detail: 'written to the log' };
  }
}

/** For tests. Keeps everything, sends nothing. */
export class MemoryMessenger {
  constructor() { this.sent = []; }

  async send(message) {
    this.sent.push({ ...message, at: new Date().toISOString() });
    return { delivered: true, id: `mem-${this.sent.length}` };
  }

  get last() { return this.sent.at(-1) ?? null; }
  to(address) { return this.sent.filter((m) => m.to === address); }
  /** The link out of the most recent message, for walking a flow in a test. */
  get lastLink() {
    return this.last?.text.match(/https?:\/\/\S+/)?.[0] ?? null;
  }
  clear() { this.sent = []; return this; }
}

/** Refuses everything, loudly. For proving a caller handles failure. */
export class FailingMessenger {
  async send() {
    throw new MessengerError('The messenger is deliberately broken');
  }
}

// ---------------------------------------------------------------------------

/**
 * A real provider, over its HTTP API. One awaited fetch, no client library, no
 * dependency.
 *
 * Postmark and Resend differ only in the URL, the auth header and the field
 * names, so both are described here rather than written twice.
 */
const PROVIDERS = {
  postmark: {
    url: 'https://api.postmarkapp.com/email',
    headers: (key) => ({ 'X-Postmark-Server-Token': key,
                         Accept: 'application/json' }),
    body: ({ from, to, subject, text, stream }) => ({
      From: from, To: to, Subject: subject, TextBody: text,
      MessageStream: stream ?? 'outbound',
    }),
    id: (r) => r.MessageID,
    error: (r) => r.Message,
  },
  resend: {
    url: 'https://api.resend.com/emails',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    body: ({ from, to, subject, text }) => ({ from, to, subject, text }),
    id: (r) => r.id,
    error: (r) => r.message ?? r.name,
  },
};

export class HttpMessenger {
  constructor({ provider, apiKey, from, stream = null, timeoutMs = 10_000 }) {
    this.spec = PROVIDERS[provider];
    if (!this.spec)
      throw new MessengerError(
        `Unknown provider "${provider}" — choose ${Object.keys(PROVIDERS).join(' or ')}`);
    if (!apiKey) throw new MessengerError(`${provider} needs an API key`);
    if (!from) throw new MessengerError(`${provider} needs a from address`);
    this.provider = provider;
    this.apiKey = apiKey;
    this.from = from;
    this.stream = stream;
    this.timeoutMs = timeoutMs;
  }

  async send({ to, subject, text }) {
    const { spec } = this;

    // A hung provider must not hold a serverless function until it times out.
    const abort = AbortSignal.timeout(this.timeoutMs);

    let response;
    try {
      response = await fetch(spec.url, {
        method: 'POST',
        signal: abort,
        headers: { 'content-type': 'application/json',
                   ...spec.headers(this.apiKey) },
        body: JSON.stringify(spec.body({
          from: this.from, to, subject, text, stream: this.stream })),
      });
    } catch (e) {
      throw new MessengerError(
        e.name === 'TimeoutError'
          ? `${this.provider} did not respond within ${this.timeoutMs}ms`
          : `Could not reach ${this.provider}: ${e.message}`,
        { provider: this.provider });
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new MessengerError(
        `${this.provider} refused the message: ${spec.error(payload) ?? response.status}`,
        { status: response.status, provider: this.provider });
    }

    const id = spec.id(payload);
    if (!id) {
      // Accepted with no id means it never reached the provider properly. This
      // is the failure that otherwise looks like success.
      throw new MessengerError(
        `${this.provider} returned no message id — treat as not sent`,
        { provider: this.provider });
    }

    return { delivered: true, id, detail: this.provider };
  }
}

// ---------------------------------------------------------------------------

/**
 * Which messenger is in use. Read at call time, not at import — a constant
 * evaluated when the module loads is read before anything configures it.
 */
export function messengerFrom(env = process.env) {
  const provider = env.MESSENGER_PROVIDER;

  if (!provider || provider === 'log') return new LogMessenger();
  if (provider === 'none') return new MemoryMessenger();

  return new HttpMessenger({
    provider,
    apiKey: env.MESSENGER_API_KEY,
    from: env.MESSENGER_FROM,
    stream: env.MESSENGER_STREAM ?? null,
  });
}
