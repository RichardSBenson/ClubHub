import { SendSignInLink } from '../core/application/send-sign-in-link.mjs';
import { LogMessenger, MemoryMessenger, FailingMessenger, HttpMessenger,
         MessengerError, messengerFrom } from './messaging/messengers.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n,fn,m) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch (e) { (!m || e.message.includes(m))
    ? (pass++, console.log(`  ✓ ${n} — ${e.message}`))
    : (fail++, console.log(`  ✗ ${n} — ${e.message}`)); }
};

const clock = { today: () => '2026-09-25' };
const ISSUE = { token: 'abc123', expiresInMinutes: 15 };

console.log('\nTHE USE CASE KNOWS NOTHING ABOUT EMAIL');
{
  const src = await import('node:fs').then(fs => fs.readFileSync(
    new URL('../core/application/send-sign-in-link.mjs', import.meta.url), 'utf8'));
  ok('no provider named in the use case',
    !/resend|postmark|smtp|nodemailer/i.test(src));
  ok('no fetch, no network', !/fetch\(/.test(src));
  ok('and no environment variables read', !/process\.env/.test(src));
}

console.log('\nIT WORKS WITH NO PROVIDER AT ALL');
{
  const lines = [];
  const messenger = new LogMessenger({ logger: { warn: (m) => lines.push(m) } });
  const send = new SendSignInLink({ messenger, clock });

  const out = await send.execute({ email:'doug@example.nz', issue: ISSUE,
    origin:'https://clubhub.example.nz', federation:'MOKNZ' });

  ok('it reports sent', out.sent);
  ok('the link is built from the origin',
    out.link === 'https://clubhub.example.nz/signin/abc123');
  ok('and the message reached the log', lines.length === 1);
  ok('carrying the link a developer can copy', lines[0].includes(out.link));
  ok('and saying plainly that nothing was sent',
    lines[0].includes('no messenger configured'));
}

console.log('\nAN UNKNOWN ADDRESS SENDS NOTHING');
{
  const messenger = new MemoryMessenger();
  const send = new SendSignInLink({ messenger, clock });
  const out = await send.execute({ email:'nobody@example.nz',
    issue: { token: null }, origin:'https://x.nz', federation:'MOKNZ' });

  ok('nothing is sent', messenger.sent.length === 0);
  ok('and the caller is told why, privately', out.reason === 'unknown address');
}

console.log('\nTHE MESSAGE ITSELF');
{
  const messenger = new MemoryMessenger();
  await new SendSignInLink({ messenger, clock }).execute({
    email:'doug@example.nz', name:'Doug', issue: ISSUE,
    origin:'https://clubhub.example.nz/', federation:'Mas Oyama Karate New Zealand' });

  const m = messenger.last;
  ok('addressed to the right person', m.to === 'doug@example.nz');
  ok('subject names the federation', m.subject === 'Sign in to Mas Oyama Karate New Zealand');
  ok('greets them by name', m.text.startsWith('Kia ora Doug,'));
  ok('says it expires', m.text.includes('expires in 15 minutes'));
  ok('and reassures anyone who did not ask', m.text.includes('did not ask'));
  ok('a trailing slash on the origin does not double up',
    messenger.lastLink === 'https://clubhub.example.nz/signin/abc123');
}

console.log('\nA BROKEN MESSENGER FAILS LOUDLY');
{
  const send = new SendSignInLink({ messenger: new FailingMessenger(), clock });
  await throws('the error reaches the caller', () =>
    send.execute({ email:'a@b.nz', issue: ISSUE, origin:'https://x.nz',
      federation:'MOKNZ' }), 'deliberately broken');
}

console.log('\nTHE HTTP MESSENGER REFUSES TO BE MISCONFIGURED');
{
  ok('an unknown provider is caught at construction',
    (() => { try { new HttpMessenger({ provider:'mailchimp' }); return false; }
      catch (e) { return e.message.includes('postmark or resend'); } })());
  ok('a missing key is caught',
    (() => { try { new HttpMessenger({ provider:'postmark' }); return false; }
      catch (e) { return e.message.includes('needs an API key'); } })());
  ok('a missing from address is caught',
    (() => { try { new HttpMessenger({ provider:'resend', apiKey:'k' }); return false; }
      catch (e) { return e.message.includes('needs a from address'); } })());
}

console.log('\nACCEPTED WITHOUT AN ID IS TREATED AS NOT SENT');
{
  const real = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });
  const m = new HttpMessenger({ provider:'postmark', apiKey:'k', from:'a@b.nz' });
  await throws('a 200 with no message id still fails', () =>
    m.send({ to:'x@y.nz', subject:'s', text:'t' }), 'no message id');

  globalThis.fetch = async () => new Response(
    JSON.stringify({ Message: 'Sender signature not confirmed' }), { status: 422 });
  await throws('a refusal carries the provider reason', () =>
    m.send({ to:'x@y.nz', subject:'s', text:'t' }), 'Sender signature');

  globalThis.fetch = async () => new Response(
    JSON.stringify({ MessageID: 'pm-42' }), { status: 200 });
  const out = await m.send({ to:'x@y.nz', subject:'s', text:'t' });
  ok('a real send returns the provider id', out.delivered && out.id === 'pm-42');

  globalThis.fetch = real;
}

console.log('\nCHOSEN BY ENVIRONMENT, READ AT CALL TIME');
{
  ok('nothing set means the log messenger',
    messengerFrom({}) instanceof LogMessenger);
  ok('explicitly "log" too',
    messengerFrom({ MESSENGER_PROVIDER:'log' }) instanceof LogMessenger);
  const http = messengerFrom({ MESSENGER_PROVIDER:'resend',
    MESSENGER_API_KEY:'k', MESSENGER_FROM:'a@b.nz' });
  ok('a provider plus credentials gives the http messenger',
    http instanceof HttpMessenger && http.provider === 'resend');

  // An operator who configured SMTP and then moved to an HTTP provider keeps
  // their own address without renaming a variable. The from address belongs to
  // the federation; the transport is an implementation detail underneath it.
  const kept = messengerFrom({ MESSENGER_PROVIDER:'resend',
    MESSENGER_API_KEY:'k', SMTP_FROM:'karate@moknz.nz' });
  ok('an http provider accepts SMTP_FROM as the sender',
    kept.from === 'karate@moknz.nz');

  const both = messengerFrom({ MESSENGER_PROVIDER:'resend',
    MESSENGER_API_KEY:'k', MESSENGER_FROM:'new@moknz.nz',
    SMTP_FROM:'old@moknz.nz' });
  ok('the messenger name wins when both are set',
    both.from === 'new@moknz.nz');

  const smtp = messengerFrom({ MESSENGER_PROVIDER:'smtp',
    SMTP_HOST:'mail.example.nz', MESSENGER_FROM:'karate@moknz.nz' });
  ok('and smtp accepts MESSENGER_FROM, the other way round',
    smtp.from === 'karate@moknz.nz');

  // The same courtesy for the secret: an operator moving from SMTP to an HTTP
  // provider changes the value in place rather than learning a second name.
  const reused = messengerFrom({ MESSENGER_PROVIDER:'resend',
    SMTP_PASS:'re_abc', SMTP_FROM:'karate@moknz.nz' });
  ok('an http provider accepts SMTP_PASS as the api key',
    reused.apiKey === 're_abc');

  const preferred = messengerFrom({ MESSENGER_PROVIDER:'resend',
    MESSENGER_API_KEY:'re_new', SMTP_PASS:'old', SMTP_FROM:'k@moknz.nz' });
  ok('and the messenger name wins there too',
    preferred.apiKey === 're_new');
}

console.log('\nA CLUB SENDS AS ITSELF');
{
  const real = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_u, init) => { body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'abc', MessageID: 'abc' }), { status: 200 }); };
  const sender = { name: 'Whanganui', address: 'whanganui@mail.moknz.nz', replyTo: 'club@w.nz' };
  const r = new HttpMessenger({ provider: 'resend', apiKey: 'k', from: 'noreply@mail.moknz.nz' });
  await r.send({ to: 'a@b.nz', subject: 's', text: 't', sender, headers: { 'List-Unsubscribe': '<https://x>' } });
  ok('resend: from is the club', body.from === 'Whanganui <whanganui@mail.moknz.nz>', body.from);
  ok('resend: replies go to the club', body.reply_to === 'club@w.nz');
  ok('resend: the unsubscribe header is sent', body.headers['List-Unsubscribe'] === '<https://x>');
  await r.send({ to: 'a@b.nz', subject: 's', text: 't' });
  ok('with no sender it is the federation as before', body.from === 'noreply@mail.moknz.nz' && !body.reply_to);
  const p = new HttpMessenger({ provider: 'postmark', apiKey: 'k', from: 'noreply@mail.moknz.nz' });
  await p.send({ to: 'a@b.nz', subject: 's', text: 't', sender, headers: { 'List-Unsubscribe': '<https://x>' } });
  ok('postmark: reply-to and headers', body.ReplyTo === 'club@w.nz' && body.Headers[0].Name === 'List-Unsubscribe');
  globalThis.fetch = real;
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
