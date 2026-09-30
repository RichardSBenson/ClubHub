/**
 * HONBU — MULTIPART FORM POSTS
 *
 * The admin works with scripts turned off, so a file arrives the way a browser
 * has always sent one: a multipart/form-data POST from a plain <form>. Nothing
 * here needs a library; the format is a boundary string, some headers and the
 * bytes between them.
 *
 * The one rule that matters:
 *
 *   THE BODY IS NEVER TURNED INTO A STRING.
 *
 * Everything works on Buffers, start to finish. `body.toString()` on a JPEG
 * replaces every byte that is not valid UTF-8 with U+FFFD, which is most of
 * them — and the damage is invisible until somebody opens the image months
 * later and finds grey mush. Splitting on the boundary as text and converting
 * back is the same bug wearing a hat. Only a part's *headers* are text, and
 * only after they have been cut out at a byte offset.
 *
 * What this deliberately does not do: streaming. Every part is held in memory,
 * bounded by the caller's limit. A federation uploading a crest is not a file
 * server, and a parser that streams to a temporary file has to clean that file
 * up on every path out, including the ones that throw.
 */

/** A submission we will not parse, and why. */
export class BadUpload extends Error {
  constructor(message) { super(message); this.name = 'BadUpload'; }
}

const CRLF = Buffer.from('\r\n');
const DASH = Buffer.from('--');

/**
 * A size a person can read. Rounding a limit of 100KB to whole megabytes
 * produced "That upload is over 0MB", which tells somebody their file is too
 * big and that the limit is nothing.
 */
const readableSize = (bytes) => bytes >= 1024 * 1024
  ? `${Math.round(bytes / 1024 / 1024 * 10) / 10}MB`
  : `${Math.round(bytes / 1024)}KB`;

/**
 * The boundary from a Content-Type header.
 *
 * RFC 2046 allows it to be quoted, and browsers differ on whether they bother.
 * A boundary may contain characters — notably '=' — that a naive split on '='
 * would cut in half, so this reads to the end of the parameter rather than
 * splitting the header up.
 */
export function boundaryOf(contentType = '') {
  if (!/^multipart\/form-data/i.test(contentType.trim()))
    return null;
  const m = contentType.match(/;\s*boundary\s*=\s*("([^"]+)"|([^;]+))/i);
  const raw = (m?.[2] ?? m?.[3] ?? '').trim();
  return raw.length ? raw : null;
}

/** Every index at which `needle` occurs in `hay`, from `from` onwards. */
function indexOfFrom(hay, needle, from) {
  return hay.indexOf(needle, from);
}

/**
 * The headers of one part, parsed from its bytes.
 *
 * Part headers are ASCII by the specification. A filename that is not — which
 * is most of them, once a phone names a photo — arrives percent-encoded or in
 * whatever the browser felt like, so the name is decoded as UTF-8 and then
 * stripped of anything that could escape a directory.
 */
function headersOf(buf) {
  const out = {};
  for (const line of buf.toString('utf8').split('\r\n')) {
    if (!line) continue;
    const at = line.indexOf(':');
    if (at < 0) continue;
    out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return out;
}

/** A filename that cannot climb out of wherever it is written. */
export function safeFilename(name = '') {
  const base = String(name)
    .replace(/\\/g, '/')            // Windows browsers send full paths
    .split('/').pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001F\u007F]/g, '')   // control characters
    .replace(/^\.+/, '')                     // no leading dots: no . or ..
    .trim()
    .slice(0, 120);
  return cleaned.length ? cleaned : 'upload';
}

/**
 * Read a multipart body into fields and files.
 *
 * Returns { fields, files } where fields are strings — so a caller that wants
 * the CSRF token or a caption reads them exactly as it would from a normal
 * form — and files carry their bytes untouched.
 */
export async function readMultipart(req, {
  maxBytes = 6 * 1024 * 1024,
  maxFiles = 8,
} = {}) {
  const boundary = boundaryOf(req.headers['content-type']);
  if (!boundary)
    throw new BadUpload('That submission was not a file upload.');

  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    // Refused as it arrives, not after. A limit checked once the whole body is
    // in memory is not a limit on memory.
    if (size > maxBytes)
      throw new BadUpload(`That upload is over ${readableSize(maxBytes)}.`);
    chunks.push(c);
  }
  const body = Buffer.concat(chunks);

  // --boundary ... --boundary ... --boundary--
  const sep = Buffer.concat([DASH, Buffer.from(boundary)]);
  const delim = Buffer.concat([CRLF, sep]);

  let at = body.indexOf(sep);
  if (at < 0) throw new BadUpload('That upload was malformed.');

  const fields = {};
  const files = [];

  while (at >= 0) {
    let cursor = at + sep.length;

    // The final boundary is followed by '--'. Anything after it is epilogue.
    if (body.length >= cursor + 2
        && body[cursor] === 0x2D && body[cursor + 1] === 0x2D) break;

    // Skip the CRLF that closes the boundary line.
    if (body[cursor] === 0x0D && body[cursor + 1] === 0x0A) cursor += 2;
    else if (body[cursor] === 0x0A) cursor += 1;   // tolerate a bare LF

    const blank = indexOfFrom(body, Buffer.from('\r\n\r\n'), cursor);
    if (blank < 0) break;

    const headers = headersOf(body.subarray(cursor, blank));
    const start = blank + 4;

    // A boundary is only a boundary at the start of a line, so the delimiter
    // searched for is CRLF + '--' + boundary, not the boundary alone. The CRLF
    // belongs to the delimiter rather than to the content: getting that wrong
    // leaves every file two bytes longer than it should be, which some JPEG
    // viewers forgive and others do not. Searching for the bare boundary would
    // also cut a file short if those bytes happened to occur inside it.
    const next = indexOfFrom(body, delim, start);
    if (next < 0) throw new BadUpload('That upload ended unexpectedly.');
    const end = next;

    const disposition = headers['content-disposition'] ?? '';
    const nameMatch = disposition.match(/;\s*name\s*=\s*("([^"]*)"|([^;]*))/i);
    const name = (nameMatch?.[2] ?? nameMatch?.[3] ?? '').trim();

    // A part with a filename is a file, even an empty one — that is how a
    // browser reports "the person submitted the form without choosing a file",
    // and the caller needs to tell that apart from no field at all.
    const fileMatch = disposition.match(/;\s*filename\s*=\s*("([^"]*)"|([^;]*))/i);
    const isFile = fileMatch != null;

    if (name) {
      if (isFile) {
        if (files.length >= maxFiles)
          throw new BadUpload(`More than ${maxFiles} files in one submission.`);
        const raw = (fileMatch[2] ?? fileMatch[3] ?? '').trim();
        files.push({
          field: name,
          filename: safeFilename(decodeURIComponent(raw.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'))),
          declaredType: headers['content-type'] ?? null,
          bytes: body.subarray(start, end),
        });
      } else {
        fields[name] = body.subarray(start, end).toString('utf8');
      }
    }

    at = next + CRLF.length;   // point at the boundary, past its CRLF
  }

  return { fields, files };
}
