#!/bin/sh
# Bring up a throwaway Postgres for the test suite.
#
# The tests that touch Postgres expect a server on /tmp/pgrun port 5433 (see
# tools/test-found.mjs). In a fresh container there is no cluster at all, so
# this initialises one, starts it, and creates the postgres role. It is
# idempotent: run it as often as you like.
#
#     sh tools/pg-up.sh && npm test
#
# Nothing here is for production. A production install points DATABASE_URL at
# a real server and never runs this.
set -e

BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DATA=${PGDATA:-/tmp/pgdata}
SOCK=/tmp/pgrun
PORT=5433

mkdir -p "$SOCK" "$DATA"

# Postgres refuses to run as root, so when we are root the server runs as the
# postgres system user instead. Everything it touches has to belong to that
# user, including the socket directory.
AS=""
if [ "$(id -u)" = 0 ]; then
  AS="setpriv --reuid=postgres --regid=postgres --clear-groups"
  chown postgres:postgres "$SOCK" "$DATA"
fi

if [ ! -f "$DATA/PG_VERSION" ]; then
  echo "initialising a cluster in $DATA"
  # --auth=trust: a unix socket in a single-tenant container, reachable by
  # nobody else. A password here would be theatre.
  $AS "$BIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
fi

if $AS "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  echo "already running"
else
  $AS "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" \
    -l "$DATA/log" -w start
fi

# Prove it, rather than trusting pg_ctl's word for it.
psql -h "$SOCK" -p "$PORT" -U postgres -c 'select version()' -tA
