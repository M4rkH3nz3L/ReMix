#!/usr/bin/env bash
# 🌍 Külső elérés Expo Go-val — cloudflared quick-tunnel (fiók nélkül).
#
# Három szolgáltatást tesz publikussá és összeköti őket:
#   • Supabase (54421) → EXPO_PUBLIC_SUPABASE_URL
#   • worker   (8787)  → EXPO_PUBLIC_SERVER_URL
#   • Metro    (8081)  → EXPO_PACKAGER_PROXY_URL (a manifest/bundle a tunnelre mutat)
# A Metrót ezekkel az env-ekkel (újra)indítja, így az app KÍVÜLRŐL is eléri a
# backendet. A tunnel-URL-eket a .devlogs/tunnel-urls.txt-be írja.
#
# FIGYELEM: a quick-tunnel URL-ek indításonként VÁLTOZNAK; az EXPO_PUBLIC_* a
# bundle-be ég → env-változásnál Metro-újraindítás kell (ezt a szkript megteszi).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/.devlogs"; mkdir -p "$LOG"

command -v cloudflared >/dev/null 2>&1 || { echo "❌ cloudflared nincs telepítve (brew install cloudflared)"; exit 1; }

start_tunnel() { # name port
  local name="$1" port="$2"
  # korábbi tunnel leállítása
  [ -f "$LOG/cf-$name.pid" ] && kill "$(cat "$LOG/cf-$name.pid")" 2>/dev/null || true
  : >"$LOG/cf-$name.log"
  nohup cloudflared tunnel --url "http://localhost:$port" >"$LOG/cf-$name.log" 2>&1 &
  echo $! >"$LOG/cf-$name.pid"; disown 2>/dev/null || true
}

url_of() { # name → kiírja a trycloudflare.com URL-t (várakozik)
  local name="$1" u=""
  for _ in $(seq 1 40); do
    u=$(grep -aoE 'https://[a-z0-9.-]+\.trycloudflare\.com' "$LOG/cf-$name.log" 2>/dev/null | head -1)
    [ -n "$u" ] && { echo "$u"; return 0; }
    sleep 1
  done
  return 1
}

echo "🌐 cloudflared tunnelek indítása…"
start_tunnel supabase 54421
start_tunnel worker 8787
start_tunnel metro 8081

SUPA=$(url_of supabase) || { echo "❌ supabase-tunnel nem jött létre"; tail -5 "$LOG/cf-supabase.log"; exit 1; }
WORK=$(url_of worker)   || { echo "❌ worker-tunnel nem jött létre";   tail -5 "$LOG/cf-worker.log";   exit 1; }
METRO=$(url_of metro)   || { echo "❌ metro-tunnel nem jött létre";    tail -5 "$LOG/cf-metro.log";    exit 1; }

echo "  Supabase → $SUPA"
echo "  Worker   → $WORK"
echo "  Metro    → $METRO"

# Metro (újra)indítása a tunnel-env-ekkel
PIDS=$(lsof -tiTCP:8081 -sTCP:LISTEN 2>/dev/null || true)
for p in $PIDS; do
  ppid=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  kill "$p" 2>/dev/null || true
  [ -n "$ppid" ] && kill "$ppid" 2>/dev/null || true
done
sleep 2
lsof -tiTCP:8081 -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true

# A tunnel-URL-eket .env.development.local-ba írjuk (gitignore-olt, MAGASABB
# precedencia, mint a .env.development) → determinisztikus: minden EXPO_PUBLIC_
# olvasó (bundle-inline ÉS app.config extra) a tunnelt kapja, LAN-referencia nélkül.
cat >"$ROOT/.env.development.local" <<ENVEOF
# 🌍 AUTOMATIKUSAN GENERÁLT (scripts/dev-tunnel.sh) — külső elérés cloudflared-del.
# Ne kommitold; a dev-tunnel-down.sh törli. A quick-tunnel URL-ek indításonként mások.
EXPO_PUBLIC_SUPABASE_URL=$SUPA
EXPO_PUBLIC_SERVER_URL=$WORK
EXPO_PUBLIC_SERVER_HOST=${WORK#https://}
ENVEOF

echo "🚇 Metro indítása tunnel-módban…"
# EXPO_PACKAGER_PROXY_URL nem EXPO_PUBLIC_ (nem a bundle-be ég, hanem a manifestet
# irányítja a tunnelre) → parancssorban marad; az EXPO_PUBLIC_* a .local-ból jön.
EXPO_PACKAGER_PROXY_URL="$METRO" \
  nohup npx expo start --port 8081 </dev/null >"$LOG/metro.log" 2>&1 &
echo $! >"$LOG/metro.pid"; disown 2>/dev/null || true

# várunk a Metro felállására
for _ in $(seq 1 60); do
  [ "$(curl -s --max-time 2 http://127.0.0.1:8081/status 2>/dev/null)" = "packager-status:running" ] && break
  sleep 2
done

{
  echo "METRO=$METRO"
  echo "SUPABASE=$SUPA"
  echo "WORKER=$WORK"
} >"$LOG/tunnel-urls.txt"

echo
echo "✅ KÉSZ. Expo Go (bármely hálózaton, akár mobilnet):"
echo "   Enter URL manually →  $METRO"
echo "   (vagy: exp+https://${METRO#https://})"
echo
echo "A cím a .devlogs/tunnel-urls.txt-ben is megvan. Leállítás: scripts/dev-tunnel-down.sh"
