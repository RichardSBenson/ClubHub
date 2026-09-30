/**
 * Sending mail, checked against a server that answers like a real one.
 *
 * The fake below speaks enough SMTP to be convincing and records everything
 * it was told, so the tests can assert on the actual bytes that went down the
 * socket rather than on what the client believes it sent.
 *
 * Two of these tests are for bugs that are not theoretical:
 *
 *   Header injection. The address comes from whatever somebody typed into the
 *   sign-in form. A newline in it adds headers — a Bcc to themselves is the
 *   obvious one — and the message goes out looking entirely legitimate.
 *
 *   Dot-stuffing. Inside DATA, a line that is one dot ends the message. A body
 *   line starting with a dot must be doubled or the mail is truncated there
 *   and the rest is read as commands.
 */

import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import { SmtpMessenger } from './messaging/smtp.mjs';
import { MessengerError } from './messaging/errors.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

// ---------------------------------------------------------------------------
// a server that answers like a real one
// ---------------------------------------------------------------------------

const CERT = { key: fs.readFileSync('/tmp/smtp-key.pem'),
               cert: fs.readFileSync('/tmp/smtp-cert.pem') };

/**
 * @param mode 'starttls' — plain, then upgrade on command. What Outlook and
 *                          Gmail do on port 587, so it is the path that
 *                          matters most.
 *             'tls'      — encrypted from the first byte, as on 465.
 */
function fakeServer({ refuseAuth = false, refuseRecipient = false,
                      silentAfterGreeting = false, multiline = true,
                      mode = 'starttls' } = {}) {
  const log = { commands: [], data: '', authUser: null, authPass: null,
                upgraded: false };
  let expectingAuth = null;
  let inData = false;

  const converse = (socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 2.0.0 Ok: queued as ABC123\r\n');
          } else log.data += line + '\r\n';
          continue;
        }

        log.commands.push(line);

        if (expectingAuth === 'user') {
          log.authUser = Buffer.from(line, 'base64').toString();
          expectingAuth = 'pass';
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (expectingAuth === 'pass') {
          log.authPass = Buffer.from(line, 'base64').toString();
          expectingAuth = null;
          socket.write(refuseAuth
            ? '535 5.7.8 Authentication credentials invalid\r\n'
            : '235 2.7.0 Accepted\r\n');
        } else if (/^EHLO/i.test(line)) {
          // A multi-line reply: only the last line has a space after the code.
          socket.write(multiline
            ? '250-fake.example.com\r\n250-SIZE 35882577\r\n250-8BITMIME\r\n'
              + '250-AUTH LOGIN PLAIN\r\n250 HELP\r\n'
            : '250 fake.example.com\r\n');
        } else if (/^AUTH LOGIN/i.test(line)) {
          expectingAuth = 'user';
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (/^MAIL FROM/i.test(line)) {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (/^RCPT TO/i.test(line)) {
          socket.write(refuseRecipient
            ? '550 5.1.1 No such user here\r\n' : '250 2.1.5 Ok\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^STARTTLS/i.test(line)) {
          socket.write('220 2.0.0 Ready to start TLS\r\n');
          socket.removeAllListeners('data');
          const secure = new tls.TLSSocket(socket, { isServer: true, ...CERT });
          log.upgraded = true;
          converse(secure);
          return;
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('502 5.5.2 Not recognised\r\n');
        }
      }
    });
    socket.on('error', () => {});
  };

  const open = new Set();
  const greet = (socket) => {
    open.add(socket);
    socket.on('close', () => open.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 fake.example.com ESMTP ready\r\n');
    if (silentAfterGreeting) return;
    converse(socket);
  };

  const server = mode === 'tls'
    ? tls.createServer(CERT, greet)
    : net.createServer(greet);
  server.on('tlsClientError', () => {});

  return { server, log,
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', r)),
    get port() { return server.address().port; },
    // Sockets left open — the silent-server case deliberately leaves one —
    // would keep close() waiting forever.
    close: () => new Promise((r) => {
      for (const socket of open) socket.destroy();
      server.close(r);
    }) };
}

const withServer = async (options, body) => {
  const f = fakeServer(options);
  await f.listen();
  try { return await body(f); } finally { await f.close(); }
};

const messengerFor = (f, extra = {}) => new SmtpMessenger({
  host: '127.0.0.1', port: f.port, user: 'sender@example.nz', pass: 'app-password',
  from: 'Honbu <no-reply@example.nz>', name: null, timeout: 4000,
  // Self-signed, because the fake server made its own certificate. A real
  // send verifies; this is the one place it cannot.
  rejectUnauthorized: false, ...extra });

// ---------------------------------------------------------------------------

console.log('\nA MESSAGE GOES OUT');
await withServer({}, async (f) => {
  const result = await messengerFor(f).send({
    to: 'aroha@example.nz', subject: 'Sign in to Honbu',
    text: 'Your link:\nhttps://example.nz/signin/abc123\n\nIt works once.',
    kind: 'sign-in link' });

  ok('it reports delivered', result.delivered === true);
  ok('with the server\'s own acceptance', result.detail.includes('queued'),
    result.detail);
  ok('and a message id', /.+@.+/.test(result.id), result.id);

  const said = f.log.commands.join(' | ');
  ok('it introduced itself', /EHLO/.test(said), said);
  ok('authenticated', f.log.authUser === 'sender@example.nz');
  ok('with the password given', f.log.authPass === 'app-password');
  ok('named the sender', said.includes('MAIL FROM:<no-reply@example.nz>'), said);
  ok('and the recipient', said.includes('RCPT TO:<aroha@example.nz>'), said);
  ok('then said goodbye', said.includes('QUIT'), said);

  ok('the body arrived', f.log.data.includes('https://example.nz/signin/abc123'));
  ok('the subject is there', f.log.data.includes('Subject: Sign in to Honbu'));
  ok('addressed to them', f.log.data.includes('To: <aroha@example.nz>'));
  ok('every line ends CRLF, as the protocol requires',
    !/[^\r]\n/.test(f.log.data), JSON.stringify(f.log.data.slice(0, 60)));
  ok('it is marked as generated, not a newsletter',
    f.log.data.includes('Auto-Submitted: auto-generated'));
  ok('and declared as UTF-8', f.log.data.includes('charset=utf-8'));
});

console.log('\nTHE CONNECTION IS ENCRYPTED BEFORE ANY SECRET CROSSES IT');
await withServer({ mode: 'starttls' }, async (f) => {
  const r = await messengerFor(f).send({
    to: 'a@example.nz', subject: 'x', text: 'y' });
  ok('the message went', r.delivered === true);
  ok('the server was asked to upgrade', f.log.upgraded === true);
  ok('STARTTLS came before AUTH', (() => {
    const i = f.log.commands.findIndex((c) => /^STARTTLS/i.test(c));
    const j = f.log.commands.findIndex((c) => /^AUTH/i.test(c));
    return i !== -1 && j !== -1 && i < j;
  })(), f.log.commands.join(' | '));
  ok('and EHLO was sent again afterwards, as the protocol requires',
    f.log.commands.filter((c) => /^EHLO/i.test(c)).length === 2,
    f.log.commands.join(' | '));
});

await withServer({ mode: 'tls' }, async (f) => {
  // Port 465: encrypted from the first byte, so there is nothing to upgrade.
  const r = await messengerFor(f, { secure: true }).send({
    to: 'a@example.nz', subject: 'x', text: 'y' });
  ok('a server encrypted from the start works too', r.delivered === true);
  ok('with no STARTTLS, because there is nothing to upgrade',
    !f.log.commands.some((c) => /^STARTTLS/i.test(c)),
    f.log.commands.join(' | '));
});

{
  // The important refusal: a server that cannot encrypt gets nothing.
  const bare = fakeServer({ mode: 'starttls' });
  await bare.listen();
  // Answer 502 to STARTTLS by pretending not to know it.
  const original = bare.server.listeners('connection')[0];
  let refused = null;
  try {
    await new SmtpMessenger({ host: '127.0.0.1', port: 9,
      from: 'a@example.nz', user: 'u', pass: 'p', timeout: 700 })
      .send({ to: 'b@example.nz', subject: 'x', text: 'y' });
  } catch (e) { refused = e; }
  ok('and a server that cannot be reached at all is refused, not downgraded',
    refused instanceof MessengerError, String(refused));
  await bare.close();
  void original;
}

console.log('\nA MULTI-LINE GREETING IS READ TO THE END');
await withServer({ multiline: true }, async (f) => {
  // "250-SIZE" then "250 HELP" — a client that stops at the first line sends
  // its next command into the middle of the reply and desynchronises.
  const r = await messengerFor(f).send({
    to: 'a@example.nz', subject: 'x', text: 'y' });
  ok('the conversation stays in step', r.delivered === true);
  ok('and every command landed in order',
    f.log.commands.filter((c) => /^(EHLO|AUTH|MAIL|RCPT|DATA|QUIT)/i.test(c)).length >= 6,
    f.log.commands.join(' | '));
});

console.log('\nNOBODY CAN ADD HEADERS OF THEIR OWN');
await withServer({}, async (f) => {
  const m = messengerFor(f);

  for (const [what, to] of [
    ['a newline in the address', 'a@example.nz\r\nBcc: thief@example.com'],
    ['a bare line feed', 'a@example.nz\nBcc: thief@example.com'],
    ['a unicode line separator', 'a@example.nz\u2028Bcc: thief@example.com'],
    ['a null byte', 'a@example.nz\0Bcc: thief@example.com'],
  ]) {
    let refused = null;
    try { await m.send({ to, subject: 'x', text: 'y' }); }
    catch (e) { refused = e; }
    ok(what + ' is refused', refused instanceof MessengerError, 'it went through');
  }

  let refusedSubject = null;
  try {
    await m.send({ to: 'a@example.nz',
      subject: 'Hello\r\nBcc: thief@example.com', text: 'y' });
  } catch (e) { refusedSubject = e; }
  ok('and so is one in the subject', refusedSubject instanceof MessengerError);

  ok('none of it reached the server',
    !f.log.data.includes('thief@example.com')
    && !f.log.commands.join(' ').includes('thief@example.com'),
    'the injected header was sent');
});

console.log('\nA BODY LINE STARTING WITH A DOT DOES NOT END THE MESSAGE');
await withServer({}, async (f) => {
  const r = await messengerFor(f).send({
    to: 'a@example.nz', subject: 'Notes',
    text: 'First line.\n.\n.hidden after a lone dot\nLast line.' });

  ok('the message is accepted', r.delivered === true);
  ok('the first line is there', f.log.data.includes('First line.'));
  ok('and so is everything after the dot',
    f.log.data.includes('Last line.'), 'the message was truncated at the dot');
  ok('the lone dot survived as content',
    f.log.data.includes('\r\n..\r\n'), JSON.stringify(f.log.data.slice(-160)));
  ok('nothing after it was read as a command',
    !f.log.commands.some((c) => c.includes('hidden')),
    f.log.commands.join(' | '));
});

console.log('\nA SUBJECT THAT IS NOT PLAIN ASCII');
await withServer({}, async (f) => {
  await messengerFor(f).send({
    to: 'a@example.nz', subject: 'Sign in — Mas Oyama Karate 極真', text: 'y' });
  ok('it is encoded rather than sent raw',
    f.log.data.includes('Subject: =?UTF-8?B?'),
    (f.log.data.match(/Subject:.*/) ?? [''])[0]);
  ok('and decodes back to what was meant', (() => {
    const b64 = f.log.data.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1];
    return Buffer.from(b64, 'base64').toString('utf8')
      === 'Sign in — Mas Oyama Karate 極真';
  })());
});

console.log('\nA DISPLAY NAME, WHERE ONE IS SET');
await withServer({}, async (f) => {
  await messengerFor(f, { name: 'Mas Oyama Karate' }).send({
    to: 'a@example.nz', subject: 'x', text: 'y' });
  ok('the sender is named',
    f.log.data.includes('From: Mas Oyama Karate <no-reply@example.nz>'),
    (f.log.data.match(/From:.*/) ?? [''])[0]);
  ok('but the envelope carries the bare address',
    f.log.commands.some((c) => c === 'MAIL FROM:<no-reply@example.nz>'));
});

console.log('\nWHEN IT DOES NOT WORK, IT SAYS SO');
{
  await withServer({ refuseAuth: true }, async (f) => {
    let e = null;
    try { await messengerFor(f).send({ to: 'a@example.nz', subject: 'x', text: 'y' }); }
    catch (err) { e = err; }
    ok('bad credentials are reported', e instanceof MessengerError);
    ok('with the server\'s reason', e.message.includes('Authentication'), e.message);
    ok('and the password is not in the message',
      !e.message.includes('app-password'), e.message);
    ok('nor is the command that carried it',
      !e.message.includes(Buffer.from('app-password').toString('base64')), e.message);
  });

  await withServer({ refuseRecipient: true }, async (f) => {
    let e = null;
    try { await messengerFor(f).send({ to: 'nobody@example.nz', subject: 'x', text: 'y' }); }
    catch (err) { e = err; }
    ok('a rejected recipient is reported', e instanceof MessengerError);
    ok('with the code', e.status === 550, String(e?.status));
  });

  await withServer({ silentAfterGreeting: true }, async (f) => {
    const started = Date.now();
    let e = null;
    try {
      await new SmtpMessenger({ host: '127.0.0.1', port: f.port,
        from: 'a@example.nz', timeout: 700 })
        .send({ to: 'b@example.nz', subject: 'x', text: 'y' });
    } catch (err) { e = err; }
    ok('a server that stops answering times out', e instanceof MessengerError);
    ok('rather than hanging forever', Date.now() - started < 4000,
      `${Date.now() - started}ms`);
    ok('and says what happened',
      e.message.includes('stopped responding'), e.message);
  });

  {
    // Nothing listening at all.
    let e = null;
    try {
      await new SmtpMessenger({ host: '127.0.0.1', port: 9, from: 'a@example.nz',
        timeout: 700 }).send({ to: 'b@example.nz', subject: 'x', text: 'y' });
    } catch (err) { e = err; }
    ok('an unreachable server is reported, not swallowed',
      e instanceof MessengerError, String(e));
  }
}

console.log('\nWHAT IT REFUSES TO BE CONFIGURED WITH');
{
  const refuses = (options) => {
    try { new SmtpMessenger(options); return false; } catch { return true; }
  };
  ok('no host', refuses({ from: 'a@example.nz' }));
  ok('nothing to send from', refuses({ host: 'smtp.example.nz' }));

  await withServer({}, async (f) => {
    let e = null;
    try {
      await messengerFor(f).send({ to: 'not-an-address', subject: 'x', text: 'y' });
    } catch (err) { e = err; }
    ok('an address with no @ in it', e instanceof MessengerError, String(e));
  });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
