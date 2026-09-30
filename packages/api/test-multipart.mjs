/**
 * The test that matters is the last group: bytes in, identical bytes out.
 *
 * Everything else here is shape. That one is the reason the parser exists,
 * because the failure it guards against — turning the body into a string
 * somewhere along the way — does not throw, does not warn, and produces a
 * file that is exactly as long as it should be and full of replacement
 * characters. It is found months later by somebody opening an old photo.
 */
import { Readable } from 'node:stream';
import { readMultipart, boundaryOf, safeFilename, BadUpload }
  from './multipart.mjs';
import { identify } from '../content/images.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n} ${d}`));
const refuses = async (n, fn, fragment) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — it was accepted`); }
  catch (e) {
    if (!(e instanceof BadUpload)) {
      fail++; console.log(`  ✗ ${n} — wrong error: ${e.name}: ${e.message}`);
    } else if (fragment && !e.message.includes(fragment)) {
      fail++; console.log(`  ✗ ${n} — "${e.message}"`);
    } else { pass++; console.log(`  ✓ ${n} — ${e.message}`); }
  }
};

/** A request object, as node's http would hand one over. */
const request = (body, contentType) => {
  const stream = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]);
  stream.headers = { 'content-type': contentType };
  return stream;
};

/** Build a body the way a browser does — as bytes, never as a string. */
function multipart(boundary, parts) {
  const out = [];
  for (const p of parts) {
    out.push(Buffer.from(`--${boundary}\r\n`));
    const disposition = p.filename !== undefined
      ? `form-data; name="${p.name}"; filename="${p.filename}"`
      : `form-data; name="${p.name}"`;
    out.push(Buffer.from(`Content-Disposition: ${disposition}\r\n`));
    if (p.type) out.push(Buffer.from(`Content-Type: ${p.type}\r\n`));
    out.push(Buffer.from('\r\n'));
    out.push(Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value ?? ''));
    out.push(Buffer.from('\r\n'));
  }
  out.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(out);
}

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  + 'IQAAAABJRU5ErkJggg==', 'base64');

// ---------------------------------------------------------------------------

console.log('\nFINDING THE BOUNDARY');
{
  ok('plain', boundaryOf('multipart/form-data; boundary=abc123') === 'abc123');
  ok('quoted', boundaryOf('multipart/form-data; boundary="abc123"') === 'abc123');
  ok('with spaces around it',
    boundaryOf('multipart/form-data ;  boundary = abc123 ') === 'abc123');
  // Browsers generate these, and a naive split on '=' cuts them in half.
  ok('one containing an equals sign',
    boundaryOf('multipart/form-data; boundary=----WebKitFormBoundary=xY9')
      === '----WebKitFormBoundary=xY9');
  ok('case-insensitive header',
    boundaryOf('MULTIPART/FORM-DATA; BOUNDARY=abc') === 'abc');
  ok('a urlencoded post is not multipart',
    boundaryOf('application/x-www-form-urlencoded') === null);
  ok('and multipart with no boundary is refused',
    boundaryOf('multipart/form-data') === null);
}

console.log('\nFILENAMES CANNOT CLIMB OUT');
{
  ok('a plain name survives', safeFilename('crest.png') === 'crest.png');
  ok('a unix path is reduced to its name',
    safeFilename('/etc/passwd') === 'passwd');
  ok('a windows path too',
    safeFilename('C:\\Users\\doug\\crest.png') === 'crest.png');
  ok('traversal is defeated',
    safeFilename('../../../../etc/shadow') === 'shadow');
  ok('a name that is only dots becomes upload',
    safeFilename('..') === 'upload');
  ok('an empty name becomes upload', safeFilename('') === 'upload');
  ok('control characters are stripped',
    safeFilename('cre\u0000st\u001F.png') === 'crest.png');
  ok('and a very long name is cut', safeFilename('a'.repeat(400)).length === 120);
  ok('unicode is kept — it is a filename, not a slug',
    safeFilename('Aroha Ngata — 黒帯.jpg') === 'Aroha Ngata — 黒帯.jpg');
}

console.log('\nFIELDS AND FILES TOGETHER');
{
  const b = 'X';
  const body = multipart(b, [
    { name: '_csrf', value: 'token-value' },
    { name: 'caption', value: 'Doug at the 1974 nationals' },
    { name: 'file', filename: 'crest.png', type: 'image/png', value: PNG_1x1 },
  ]);
  const { fields, files } = await readMultipart(
    request(body, `multipart/form-data; boundary=${b}`));

  ok('the csrf token reads like any other form', fields._csrf === 'token-value');
  ok('and so does a caption', fields.caption === 'Doug at the 1974 nationals');
  ok('one file', files.length === 1);
  ok('with its field name', files[0].field === 'file');
  ok('and its filename', files[0].filename === 'crest.png');
  ok('the declared type is kept but marked as declared',
    files[0].declaredType === 'image/png');
}

console.log('\nBYTES IN, IDENTICAL BYTES OUT');
{
  const b = '----WebKitFormBoundaryAbC123';
  const body = multipart(b, [
    { name: 'file', filename: 'photo.png', type: 'image/png', value: PNG_1x1 },
  ]);
  const { files } = await readMultipart(
    request(body, `multipart/form-data; boundary=${b}`));

  ok('the length is exactly right, not two bytes over',
    files[0].bytes.length === PNG_1x1.length,
    `${files[0].bytes.length} vs ${PNG_1x1.length}`);
  ok('and every byte is the byte that was sent',
    files[0].bytes.equals(PNG_1x1));
  ok('so the result is still a readable PNG',
    identify(files[0].bytes).width === 1);

  // The failure this whole file exists to catch: every byte 0x80-0xFF, which
  // is invalid UTF-8 on its own and becomes U+FFFD if the body is ever
  // stringified. The length would survive; the content would not.
  const hostile = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const body2 = multipart(b, [
    { name: 'file', filename: 'all-bytes.bin', value: hostile },
  ]);
  const r2 = await readMultipart(request(body2, `multipart/form-data; boundary=${b}`));
  ok('all 256 byte values survive', r2.files[0].bytes.equals(hostile),
    `${r2.files[0].bytes.length} bytes back`);
  ok('including the ones that are not valid UTF-8',
    r2.files[0].bytes[0xFF] === 0xFF && r2.files[0].bytes[0x80] === 0x80);

  // Content that contains CRLF, which a line-based parser would split on.
  const withNewlines = Buffer.from('line one\r\nline two\r\n\r\nline four');
  const body3 = multipart(b, [
    { name: 'file', filename: 'notes.txt', value: withNewlines },
  ]);
  const r3 = await readMultipart(request(body3, `multipart/form-data; boundary=${b}`));
  ok('content containing blank lines is not cut short',
    r3.files[0].bytes.equals(withNewlines));
}

console.log('\nWHAT A BROWSER ACTUALLY SENDS');
{
  const b = 'X';
  // Submitting the form without choosing a file: an empty part that still has
  // a filename. The caller has to tell this apart from no field at all.
  const body = multipart(b, [
    { name: 'file', filename: '', type: 'application/octet-stream', value: '' },
  ]);
  const { files } = await readMultipart(
    request(body, `multipart/form-data; boundary=${b}`));
  ok('an empty file part still arrives', files.length === 1);
  ok('with no bytes', files[0].bytes.length === 0);
  ok('and a placeholder name rather than nothing', files[0].filename === 'upload');
}

console.log('\nSEVERAL FILES');
{
  const b = 'X';
  const body = multipart(b, [
    { name: 'a', filename: 'one.png', value: PNG_1x1 },
    { name: 'b', filename: 'two.png', value: PNG_1x1 },
    { name: 'note', value: 'between them' },
  ]);
  const { fields, files } = await readMultipart(
    request(body, `multipart/form-data; boundary=${b}`));
  ok('both files', files.length === 2);
  ok('in order', files[0].filename === 'one.png' && files[1].filename === 'two.png');
  ok('both intact', files.every((f) => f.bytes.equals(PNG_1x1)));
  ok('and the field between them', fields.note === 'between them');

  await refuses('more files than allowed', () => readMultipart(
    request(multipart(b, Array.from({ length: 9 }, (_, i) =>
      ({ name: `f${i}`, filename: `${i}.png`, value: PNG_1x1 }))),
      `multipart/form-data; boundary=${b}`)), 'More than 8 files');
}

console.log('\nREFUSALS');
{
  await refuses('a body that is not multipart at all',
    () => readMultipart(request('a=1&b=2', 'application/x-www-form-urlencoded')),
    'not a file upload');

  await refuses('multipart with no boundary declared',
    () => readMultipart(request('whatever', 'multipart/form-data')),
    'not a file upload');

  await refuses('a body with no boundary in it',
    () => readMultipart(request('nothing here', 'multipart/form-data; boundary=X')),
    'malformed');

  await refuses('a part that never ends',
    () => readMultipart(request(
      '--X\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue with no closing',
      'multipart/form-data; boundary=X')), 'ended unexpectedly');

  // The limit has to bite as the body arrives, not once it is all in memory.
  const big = multipart('X', [
    { name: 'f', filename: 'big.png', value: Buffer.alloc(200 * 1024) }]);
  await refuses('a body over the limit',
    () => readMultipart(request(big, 'multipart/form-data; boundary=X'),
      { maxBytes: 100 * 1024 }), 'over 100KB');

  // "over 0MB" told somebody their file was too big and the limit was nothing.
  // A body has to actually exceed the limit to trip it, so this one is bigger.
  const bigger = multipart('X', [
    { name: 'f', filename: 'big.png', value: Buffer.alloc(2 * 1024 * 1024) }]);
  await refuses('a limit in megabytes reads in megabytes',
    () => readMultipart(request(bigger, 'multipart/form-data; boundary=X'),
      { maxBytes: 1024 * 1024 }), 'over 1MB');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
