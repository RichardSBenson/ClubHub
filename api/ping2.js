/** Probe: can a function import a .mjs module from packages/ ? */
import { OrgType } from '../packages/core/domain/values.mjs';
export default function (request, response) {
  response.statusCode = 200;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end('ping2 ok: ' + Object.keys(OrgType).length + ' org types\n');
}
