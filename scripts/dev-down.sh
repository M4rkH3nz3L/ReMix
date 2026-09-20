#!/usr/bin/env bash
# ⏹️ A dev-up.sh által indított szolgáltatások leállítása (Supabase MARAD — azt a
# `supabase stop` állítja le, hogy a konténer-indítás ne teljen minden alkalommal).
#
# PORT-ALAPÚ leállítás: a Metrót `npx` indítja, így a mentett PID a launcheré, nem a
# valódi node-é — ezért a PORTOT tartó folyamatot (is) kilőjük, hogy ne maradjon árva.
set -u
cd "$(dirname "$0")/.." || exit 1
LOG="$(pwd)/.devlogs"

# 1) pidfile-ok (best-effort — ha a launcher PID még él)
for name in dashboard metro worker; do
  pidf="$LOG/$name.pid"
  if [ -f "$pidf" ]; then
    pid="$(cat "$pidf" 2>/dev/null || echo '')"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    rm -f "$pidf"
  fi
done

# 2) port-alapú kilövés (a valódi, esetleg árva folyamatok)
kill_port() { # name port
  local pids
  pids="$(lsof -ti tcp:"$2" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    echo "⏹️  $1 (:$2) leállítva"
  else
    echo "•  $1 (:$2) nem futott"
  fi
}
kill_port "Dashboard" 8899
kill_port "Metro" 8081
kill_port "Worker" 8787

echo ""
echo "Supabase MARAD (leállítás: supabase stop)."
