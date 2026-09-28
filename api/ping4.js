/** Probe: the factory, with its dynamic imports and the JSON adapters. */
import { repositories, currentStore } from '../packages/infrastructure/factory.mjs';
export default async function (request, response) {
  const built = await repositories();
  response.statusCode = 200;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end('ping4 ok: store ' + currentStore() + ' / ' + built.store + '\n');
}
