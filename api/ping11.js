/** Probe: the messenger. */
import { messengerFrom } from '../packages/infrastructure/messaging/messengers.mjs';
export default function (q, s) {
  s.statusCode = 200; s.setHeader('content-type', 'text/plain; charset=utf-8');
  s.end('ping11 ok: ' + messengerFrom().constructor.name + '\n');
}
