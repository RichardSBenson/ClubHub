/**
 * INFRASTRUCTURE — sending mail over SMTP, with nothing installed
 *
 * The one thing standing between this system and being usable by anybody but
 * its author: sign-in is a link emailed to you, and until email works, nobody
 * can be invited. That is why HONBU_BOOTSTRAP exists — a door left open in the
 * environment variables because there was no other way in.
 *
 * Every hosted mail provider wants an account, a domain and a verification
 * step. A federation that already has a mailbox should not need any of that
 * to send its own members a link. SMTP is a mailbox's own protocol, Node has
 * sockets and TLS, and that is the entire dependency list.
 *
 * ## Why this contradicts the comment in messengers.mjs
 *
 * That file says SMTP is unsuitable because "a serverless function stops once
 * it responds, and SMTP needs DNS, TCP, TLS, auth and transfer to complete on
 * one socket before that happens."
 *
 * The premise is right and the conclusion was wrong. SendSignInLink AWAITS
 * delivery before the route responds — deliberately, because responding before
 * the message is away is how sign-in links vanish while the logs stay clean.
 * The function cannot stop first. What SMTP costs is latency: several round
 * trips, a second or two, on a route that already waits for the message.
 *
 * ## What this is careful about
 *
 * A mail header is a line. Anything that can put a newline into one can add
 * headers of its own — a Bcc to themselves, a different Reply-To — and the
 * address here comes from whatever somebody typed into the sign-in form. So
 * every header value is checked, and a newline in one is refused rather than
 * escaped. Escaping invites a cleverer newline.
 *
 * Inside DATA, a line consisting of a single dot ends the message. A body line
 * that happens to start with a dot must therefore be doubled, or the message
 * is truncated at that line and the rest is interpreted as SMTP commands. That
 * is dot-stuffing, it is in the RFC, and forgetting it is the classic bug.
 */

import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { MessengerError } from './errors.mjs';

const CRLF = '\r\n';

// ---------------------------------------------------------------------------
// headers
// ---------------------------------------------------------------------------

/**
 * A header value that cannot break out of its line.
 *
 * Refused, not sanitised. A sanitiser is a promise that you thought of every
 * way to write a newline; a refusal only has to notice one.
 */
function safeHeader(value, what) {
  const text = String(value ?? '');
  if (/[\r\n\u2028\u2029\0]/.test(text))
    throw new MessengerError(`${what} contains a line break`, { provider: 'smtp' });
  return text;
}

/**
 * Anything outside ASCII, encoded so it survives the hop.
 *
 * A subject saying "Sign in to Mas Oyama Karate — New Zealand" contains an
 * em dash, and a raw one in a header arrives as mojibake on a sizeable
 * minority of clients. RFC 2047 is how you say "this header is UTF-8".
 */
function encodeHeader(value) {
  if (!/[^\x20-\x7E]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** An address, with any display name kept out of the protocol's way. */
function addressOnly(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : String(value)).trim();
}

// ---------------------------------------------------------------------------
// the conversation
// ---------------------------------------------------------------------------

/**
 * One SMTP session. Plain object rather than a class because it exists for the
 * length of one message and then the socket is gone.
 */
function session(socket, { timeout }) {
  let buffer = '';
  let waiting = null;

  socket.setEncoding('utf8');
  socket.setTimeout(timeout);

  const fail = (message) => {
    const error = new MessengerError(message, { provider: 'smtp' });
    if (waiting) { const w = waiting; waiting = null; w.reject(error); }
    socket.destroy();
  };

  socket.on('timeout', () => fail('The mail server stopped responding'));
  socket.on('error', (e) => fail(`Could not reach the mail server: ${e.message}`));
  socket.on('close', () => { if (waiting) fail('The mail server hung up'); });

  socket.on('data', (chunk) => {
    buffer += chunk;
    // A reply may be several lines: "250-SIZE" then "250 HELP". Only a line
    // with a SPACE after the code is the last one.
    const complete = /^\d{3} [^\r\n]*\r\n$|(?:^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buffer);
    if (!complete || !waiting) return;
    const reply = buffer;
    buffer = '';
    const w = waiting;
    waiting = null;
    const code = Number(reply.slice(0, 3));
    w.resolve({ code, text: reply.trim() });
  });

  const read = () => new Promise((resolve, reject) => { waiting = { resolve, reject }; });

  /** Send a line and check what comes back. */
  const command = async (line, expected, { secret = false } = {}) => {
    if (line !== null) socket.write(line + CRLF);
    const reply = await read();
    if (!expected.includes(reply.code)) {
      throw new MessengerError(
        `The mail server refused ${secret ? 'the credentials' : `"${line}"`}: `
        + reply.text, { status: reply.code, provider: 'smtp' });
    }
    return reply;
  };

  return { socket, read, command };
}

const connect = (options) => new Promise((resolve, reject) => {
  const socket = options.secure
    // rejectUnauthorized passed here too. It was honoured on the STARTTLS
    // upgrade and silently ignored on this path, so the option meant
    // different things depending on the port — which is worse than not
    // having it, because it looks like it applies.
    ? tls.connect({ host: options.host, port: options.port,
                    servername: options.servername ?? options.host,
                    rejectUnauthorized: options.rejectUnauthorized },
                  () => resolve(socket))
    : net.connect({ host: options.host, port: options.port }, () => resolve(socket));
  socket.once('error', reject);
});

// ---------------------------------------------------------------------------

export class SmtpMessenger {
  /**
   * @param host      the mail server, e.g. smtp-mail.outlook.com
   * @param port      587 for STARTTLS, 465 for TLS from the first byte
   * @param user/pass the mailbox. Use an APP PASSWORD, never an account
   *                  password: an app password can be revoked on its own and
   *                  grants nothing but sending.
   * @param from      the address members will see, and reply to
   */
  constructor({ host, port = 587, user = null, pass = null, from,
                name = null, timeout = 12_000, rejectUnauthorized = true,
                secure = null } = {}) {
    if (!host) throw new MessengerError('SMTP needs a host', { provider: 'smtp' });
    if (!from) throw new MessengerError('SMTP needs an address to send from',
      { provider: 'smtp' });

    this.host = host;
    this.port = Number(port);
    this.user = user;
    this.pass = pass;
    this.from = from;
    this.name = name;
    this.timeout = timeout;
    this.rejectUnauthorized = rejectUnauthorized;

    // TLS from the first byte, or start plain and upgrade with STARTTLS.
    // 465 is the convention for the former and 587 for the latter, so the
    // port is the default — but only the default. Deciding it from the port
    // alone is a guess about somebody else's server, and a server listening
    // for implicit TLS on any other port would get a plaintext EHLO and a
    // connection that hangs with no useful error.
    this.secure = secure === null ? Number(port) === 465 : !!secure;
  }

  get implicitTls() { return this.secure; }

  async send({ to, subject, text, kind = 'message', sender = null, headers = null }) {
    const recipient = safeHeader(addressOnly(to), 'The address');
    const line = safeHeader(subject, 'The subject');
    if (!recipient.includes('@'))
      throw new MessengerError(`"${recipient}" is not an address`, { provider: 'smtp' });

    let s = null;
    try {
      let socket = await connect({ host: this.host, port: this.port,
        secure: this.implicitTls,
        rejectUnauthorized: this.rejectUnauthorized,
        // An IP address is not a valid SNI name (RFC 6066), and sending one
        // is deprecated. Only set it for a real hostname.
        servername: net.isIP(this.host) ? undefined : this.host });
      s = session(socket, { timeout: this.timeout });

      await s.command(null, [220]);                       // the greeting
      await s.command(`EHLO ${hostnameFor(this.from)}`, [250]);

      if (!this.implicitTls) {
        // Refused rather than sent in the clear. A mailbox password and a
        // sign-in link are exactly what must not cross a network unencrypted,
        // and a server that cannot do STARTTLS is one to stop talking to.
        await s.command('STARTTLS', [220]);
        socket = await upgrade(socket, this.host, this.rejectUnauthorized);
        s = session(socket, { timeout: this.timeout });
        await s.command(`EHLO ${hostnameFor(this.from)}`, [250]);
      }

      if (this.user) {
        // AUTH LOGIN: the server prompts for each half, base64, in turn. Older
        // and more widely accepted than PLAIN, and the difference costs one
        // round trip on a conversation that already has several.
        await s.command('AUTH LOGIN', [334]);
        await s.command(Buffer.from(this.user).toString('base64'), [334],
          { secret: true });
        await s.command(Buffer.from(this.pass ?? '').toString('base64'), [235],
          { secret: true });
      }

      await s.command(`MAIL FROM:<${addressOnly(this.from)}>`, [250]);
      await s.command(`RCPT TO:<${recipient}>`, [250, 251]);
      await s.command('DATA', [354]);

      const id = `${crypto.randomUUID()}@${hostnameFor(this.from)}`;
      // The message already ends with CRLF "." CRLF — that IS the end of
      // DATA. Sending another dot afterwards writes a stray line the server
      // answers separately, and from then on every reply is read against the
      // wrong command: the 250 for the message gets matched to the dot, and
      // QUIT reads the error for the dot. So: write, then only listen.
      s.socket.write(this.#message({ id, recipient, subject: line, text, sender, extra: headers }));
      const accepted = await s.command(null, [250]);

      // QUIT is courtesy. The message is accepted by the time 250 comes back,
      // so a server that hangs up here has still taken it, and treating that
      // as a failure would send somebody a second copy.
      try { await s.command('QUIT', [221]); } catch { /* already delivered */ }
      s.socket.end();

      return { delivered: true, id, detail: accepted.text };
    } catch (error) {
      s?.socket?.destroy();
      if (error instanceof MessengerError) throw error;
      throw new MessengerError(
        `Could not send the ${kind}: ${error.message}`, { provider: 'smtp' });
    }
  }

  /** The message itself, CRLF throughout and dot-stuffed. */
  #message({ id, recipient, subject, text, sender = null, extra = null }) {
    // A mailbox sends as itself — the server will not let it be anybody else —
    // so a club can lend its NAME to the message but not its address. A reply
    // still goes to the club.
    const name = sender?.name ?? this.name;
    const from = name
      ? `${encodeHeader(safeHeader(name, 'The sender name'))} `
        + `<${addressOnly(this.from)}>`
      : addressOnly(this.from);

    const headers = [
      `From: ${from}`,
      `To: <${recipient}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${id}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      // A sign-in link is not a newsletter. Saying so keeps it out of
      // automatic replies and stops a mailing-list unsubscribe being offered
      // for a message nobody subscribed to.
      ...(extra ? [] : ['Auto-Submitted: auto-generated']),
      ...(sender?.replyTo ? [`Reply-To: <${safeHeader(addressOnly(sender.replyTo), 'The reply address')}>`] : []),
      ...Object.entries(extra ?? {}).map(([k, v]) =>
        `${safeHeader(k, 'A header name')}: ${safeHeader(v, 'A header')}`),
    ];

    const body = String(text ?? '')
      .replace(/\r?\n/g, CRLF)
      // A line that is just a dot ends the message. Double it, or everything
      // after is read as commands.
      .replace(/^\./gm, '..');

    return headers.join(CRLF) + CRLF + CRLF + body + CRLF + '.' + CRLF;
  }
}

/** What to call ourselves in EHLO. Cosmetic, but a bare name is rejected. */
const hostnameFor = (from) => {
  const at = addressOnly(from).split('@')[1];
  return at && at.includes('.') ? at : 'localhost';
};

const upgrade = (socket, host, rejectUnauthorized) => new Promise((resolve, reject) => {
  socket.removeAllListeners('data');
  socket.removeAllListeners('error');
  socket.removeAllListeners('close');
  socket.removeAllListeners('timeout');
  const secure = tls.connect(
    { socket, rejectUnauthorized,
      servername: net.isIP(host) ? undefined : host },
    () => resolve(secure));
  secure.once('error', reject);
});
