#!/usr/bin/env bash
set -euo pipefail
# Disposable local services only. Pinned versions; Docker verifies layer digests.
command="${1:-start}"
if [[ "$command" == stop ]]; then
  docker rm -f inb-next-rest inb-next-regression >/dev/null 2>&1 || true
  docker network rm inb-next-test-net >/dev/null 2>&1 || true
  exit 0
fi
if [[ "$command" != start ]]; then echo 'Usage: scripts/test-services.sh [start|stop]' >&2; exit 1; fi
if docker container inspect inb-next-regression >/dev/null 2>&1 || docker container inspect inb-next-rest >/dev/null 2>&1; then
  echo 'Owned test containers already exist. Stop them explicitly before starting a fresh test database.' >&2; exit 1
fi
docker network create inb-next-test-net >/dev/null
docker run -d --rm --name inb-next-regression --network inb-next-test-net \
  -e POSTGRES_PASSWORD=local-test-only -p 127.0.0.1:55432:5432 \
  postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3 >/dev/null
ready=false
for _ in {1..30}; do
  if docker exec inb-next-regression pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo 'Test PostgreSQL did not start.' >&2; exit 1; fi
docker exec inb-next-regression psql -U postgres -v ON_ERROR_STOP=1 -c \
  "create role anon; create role authenticated; create role service_role bypassrls; create role authenticator login noinherit password 'local-api-only'; grant anon,authenticated,service_role to authenticator;" >/dev/null
docker run -d --rm --name inb-next-rest --network inb-next-test-net \
  -p 127.0.0.1:55433:3000 \
  -e PGRST_DB_URI=postgres://authenticator:local-api-only@inb-next-regression:5432/postgres \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=inb-next-integration-only-jwt-secret-32chars \
  postgrest/postgrest:v13.0.7@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228 >/dev/null
printf '%s\n' 'Disposable services started. Run npm run test:db, npm run test:http, npm run build, npm run test:e2e in that order.'
