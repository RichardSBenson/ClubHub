/** INFRASTRUCTURE — run `work(client)` as one Postgres transaction: committed if it returns, rolled back if it throws. */
export async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}
