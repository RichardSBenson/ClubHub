/** Probe: every one of server.mjs's imports together, and nothing else. */
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { pool, orgs, people, rank, events, Forbidden, NotFound, Invalid }
  from '../packages/api/data.mjs';
import * as auth from '../packages/api/auth.mjs';
import * as V from '../packages/api/views.mjs';
import { currentStore } from '../packages/infrastructure/factory.mjs';
import { messengerFrom } from '../packages/infrastructure/messaging/messengers.mjs';

export default function (q, s) {
  s.statusCode = 200; s.setHeader('content-type', 'text/plain; charset=utf-8');
  s.end('ping12 ok: ' + [typeof http.createServer, typeof crypto.randomUUID,
    typeof URL, typeof pool, Object.keys(auth).length, Object.keys(V).length,
    currentStore(), typeof messengerFrom].join(' | ') + '\n');
}
