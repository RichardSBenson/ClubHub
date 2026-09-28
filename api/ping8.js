/**
 * Probe: byte-for-byte what api/index.js does, under a name that is not
 * "index". If this answers and index.js does not, the filename is the fault.
 */
import handler from '../packages/api/server.mjs';
export default function (request, response) {
  return handler(request, response);
}
