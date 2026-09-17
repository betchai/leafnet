#!/usr/bin/env bash
#
# RBAC smoke test for the Leafnet API.
#
# Verifies the role matrix end-to-end against a running API (default :4000):
#   anonymous -> 401 everywhere except unauthenticated flows
#   FARMER    -> analyzer OK, dataset/admin/user tools forbidden
#   RESEARCHER-> acquire/label/bulk/view allowed, expert tools forbidden
#   EXPERT    -> full access
#
# Prerequisite: `npx tsx src/seedUsers.ts` has been run at least once.
#
# Usage:
#   ./rbac-smoke.sh                          # against http://localhost:4000
#   BASE_URL=http://localhost:4000 ./rbac-smoke.sh
#
set -u
BASE_URL="${BASE_URL:-http://localhost:4000}/api"

PASS=0
FAIL=0
step() { printf '%-58s ' "$1"; }
ok()   { echo "OK"; PASS=$((PASS+1)); }
bad()  { echo "FAIL (expected $1, got $2)"; FAIL=$((FAIL+1)); }

check() { # name expected_code method path token
  local name="$1" exp="$2" m="$3" p="$4" tok="$5" code
  step "$name"
  if [ -n "$tok" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" -H "Authorization: Bearer $tok" "$BASE_URL$p")
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" "$BASE_URL$p")
  fi
  [ "$code" = "$exp" ] && ok || bad "$exp" "$code"
}

login() { curl -s -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json;sys.stdout.write(json.load(sys.stdin).get("token",""))'; }

FARMER=""
RESEARCHER=""
EXPERT=""
for _ in 1 2 3 4 5; do
  FARMER=$(login farmer.demo@mulberry.local FarmerDemo2026!)
  RESEARCHER=$(login researcher.demo@mulberry.local ResearcherDemo2026!)
  EXPERT=$(login expert.demo@mulberry.local ExpertDemo2026!)
  [ -n "$FARMER" ] && [ -n "$RESEARCHER" ] && [ -n "$EXPERT" ] && break
  echo "# retrying login (rate-limit window)…"
  sleep 6
done

if [ -z "$FARMER" ] || [ -z "$RESEARCHER" ] || [ -z "$EXPERT" ]; then
  echo "FATAL: could not obtain tokens. Run: cd apps/api && npx tsx src/seedUsers.ts"
  exit 2
fi

echo "== anonymous =="
check "GET /images                           -> 401" 401 GET /images ""
check "POST /images                          -> 401" 401 POST /images ""
check "GET /predictions?limit=5              -> 401" 401 GET "/predictions?limit=5" ""
check "GET /datasets/status                  -> 401" 401 GET /datasets/status ""
check "GET /users                            -> 401" 401 GET /users ""

echo "== farmer =="
check "GET /predictions?limit=5              -> 200" 200 GET "/predictions?limit=5" "$FARMER"
check "POST /images/me/annotations (annotate denied) -> 403" 403 POST "/images/me/annotations" "$FARMER"
check "GET /images (view denied)             -> 403" 403 GET /images "$FARMER"
check "GET /datasets/status                  -> 403" 403 GET /datasets/status "$FARMER"
check "POST /tools/bulk-ingest               -> 403" 403 POST /tools/bulk-ingest "$FARMER"
check "GET /tools/feedback                   -> 403" 403 GET /tools/feedback "$FARMER"
check "GET /users                            -> 403" 403 GET /users "$FARMER"
check "GET /models                           -> 403" 403 GET /models "$FARMER"
check "GET /insights                         -> 403" 403 GET /insights "$FARMER"

echo "== researcher =="
check "GET /images                           -> 200" 200 GET /images "$RESEARCHER"
check "GET /datasets/status                  -> 200" 200 GET /datasets/status "$RESEARCHER"
check "POST /images/me/annotations           -> 400 (authorized, bad body)" 400 POST "/images/me/annotations" "$RESEARCHER"
check "GET /tools/feedback                   -> 403" 403 GET /tools/feedback "$RESEARCHER"
check "GET /tools/monitoring/summary         -> 403" 403 GET "/tools/monitoring/summary" "$RESEARCHER"
check "POST /datasets/cut                    -> 403" 403 POST /datasets/cut "$RESEARCHER"
check "GET /users                            -> 403" 403 GET /users "$RESEARCHER"
check "GET /models (model registry           -> 403" 403 GET /models "$RESEARCHER"
check "GET /insights                         -> 403" 403 GET /insights "$RESEARCHER"

echo "== expert =="
check "GET /images                           -> 200" 200 GET /images "$EXPERT"
check "GET /datasets/status                  -> 200" 200 GET /datasets/status "$EXPERT"
check "GET /tools/feedback                   -> 200" 200 GET /tools/feedback "$EXPERT"
check "GET /tools/monitoring/summary         -> 200" 200 GET "/tools/monitoring/summary" "$EXPERT"
check "GET /users                            -> 200" 200 GET /users "$EXPERT"
check "GET /models                           -> 200" 200 GET /models "$EXPERT"
check "POST /images/me/review                -> 400 (authorized, bad body)" 400 POST "/images/me/review" "$EXPERT"

echo "== session lifecycle =="
step "login: wrong password                  -> 401"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' -d '{"email":"expert.demo@mulberry.local","password":"WRONG"}')
[ "$code" = "401" ] && ok || bad 401 "$code"
step "logout without token                   -> 200 (idempotent)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/auth/logout")
[ "$code" = "200" ] && ok || bad 200 "$code"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1