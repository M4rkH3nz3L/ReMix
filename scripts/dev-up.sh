#!/usr/bin/env bash
# 🎬 ReMix dev-környezet felhúzása: Supabase + worker + Metro (Expo) + állapot-dashboard.
#
# A szolgáltatásokat NOHUP-pal indítja (leválik a shellről), ezért a saját
# termináljában futtatva TÚLÉLI, ha az agent-munkamenet váltódik. Logok és PID-ek:
# .devlogs/. Idempotens: ami már fut, azt nem indítja újra. Minden szolgáltatásnál
# INDÍTÁS UTÁN health-ellenőrzés van — a ✅ csak akkor jelenik meg, ha tényleg fut.
#
#   bash scripts/dev-up.sh          # felhúzás
#   bash scripts/dev-down.sh        # leállítás (Supabase marad)
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)}"
LOG="$ROOT/.devlogs"
mkdir -p "$LOG"

up() { curl -s -o /dev/null --max-time 2 "$1"; }
# health-re várás (max ~20s), majd hiteles jelentés (nem feltétel nélküli ✅)
wait_up() { for _ in $(seq 1 20); do up "$1" && return 0; sleep 1; done; return 1; }
report() { # name url logfile
  if wait_up "$2"; then
    echo "✅ $1"
  else
    echo "❌ $1 — NEM jött fel (utolsó sorok: $3):"
    tail -6 "$3" 2>/dev/null | sed 's/^/    /'
  fi
}

echo "LAN IP: $LAN_IP"

# 1) Docker + Supabase (a helyi backend)
if ! docker info >/dev/null 2>&1; then
  echo "Docker indítása…"
  open -a Docker 2>/dev/null || true
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
fi
if ! up "http://127.0.0.1:54421/rest/v1/"; then
  echo "Supabase indítása…"
  supabase start >"$LOG/supabase.log" 2>&1 || true
fi
report "Supabase :54421" "http://127.0.0.1:54421/rest/v1/" "$LOG/supabase.log"

# 2) worker (cwd=server kell a .env + assets miatt; exec → a PID a valódi node)
if ! up "http://127.0.0.1:8787/health"; then
  echo "Worker indítása…"
  ( cd "$ROOT/server" && exec node --env-file-if-exists=.env index.js ) >"$LOG/worker.log" 2>&1 &
  echo $! >"$LOG/worker.pid"; disown 2>/dev/null || true
fi
report "Worker :8787" "http://127.0.0.1:8787/health" "$LOG/worker.log"

# 3) Metro (Expo) — LAN mód. FIGYELEM: a mentett PID az `npx` launcheré, NEM a valódi
# metro node-é; ezért a dev-down.sh a PORTOT tartó folyamatot is kilövi (port-alapú).
if ! up "http://127.0.0.1:8081/status"; then
  echo "Metro indítása…"
  CI=1 nohup npx expo start --lan >"$LOG/metro.log" 2>&1 &
  echo $! >"$LOG/metro.pid"; disown 2>/dev/null || true
fi
report "Metro :8081" "http://127.0.0.1:8081/status" "$LOG/metro.log"

# 4) állapot-dashboard (közös „screen")
if ! up "http://127.0.0.1:8899/status.json"; then
  echo "Dashboard indítása…"
  LAN_IP="$LAN_IP" WORKER_LOG="$LOG/worker.log" METRO_LOG="$LOG/metro.log" \
    nohup node scripts/devstatus.mjs >"$LOG/dashboard.log" 2>&1 &
  echo $! >"$LOG/dashboard.pid"; disown 2>/dev/null || true
fi
report "Dashboard :8899" "http://127.0.0.1:8899/status.json" "$LOG/dashboard.log"

echo ""
echo "📺 Dashboard:      http://$LAN_IP:8899"
echo "📱 App (Expo Go):  exp://$LAN_IP:8081   — azonos Wi-Fi, Expo Go -> Enter URL manually"
