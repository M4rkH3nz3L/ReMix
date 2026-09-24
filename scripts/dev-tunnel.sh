#!/usr/bin/env bash
# 🌍 Külső elérés Expo Go-val.
#   • Metro   → Expo SAJÁT tunnelje (expo start --tunnel → exp://…exp.direct),
#     mert az Expo Go ezt a formátumot fogadja el megbízhatóan (a nyers cloudflared
#     https-endpontot az exp:// protokoll nem szereti).
#   • Supabase (54421) + worker (8787) → cloudflared quick-tunnel (fiók nélkül),
#     a címek a .env.development.local-ba (gitignore-olt, magasabb precedencia) →
#     az app KÍVÜLRŐL a tunnelt hívja, nem a LAN-t.
#
# FIGYELEM: a tunnel-URL-ek indításonként VÁLTOZNAK; env-változásnál Metro-újraindítás
# kell (ezt a szkript megteszi). Kimenet: .devlogs/tunnel-urls.txt.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/.devlogs"; mkdir -p "$LOG"

command -v cloudflared >/dev/null 2>&1 || { echo "❌ cloudflared nincs (brew install cloudflared)"; exit 1; }
ls "$ROOT/node_modules/@expo/ngrok/package.json" >/dev/null 2>&1 || \
  echo "⚠️  @expo/ngrok nincs telepítve — a --tunnel telepítené (npx expo install @expo/ngrok)."

start_tunnel() { # name port
  local name="$1" port="$2"
  [ -f "$LOG/cf-$name.pid" ] && kill "$(cat "$LOG/cf-$name.pid")" 2>/dev/null || true
  : >"$LOG/cf-$name.log"
  nohup cloudflared tunnel --url "http://localhost:$port" >"$LOG/cf-$name.log" 2>&1 &
  echo $! >"$LOG/cf-$name.pid"; disown 2>/dev/null || true
}
url_of() { # name → a trycloudflare.com URL (várakozik). -a: a színes logot szövegként.
  local name="$1" u=""
  for _ in $(seq 1 40); do
    u=$(grep -aoE 'https://[a-z0-9.-]+\.trycloudflare\.com' "$LOG/cf-$name.log" 2>/dev/null | head -1)
    [ -n "$u" ] && { echo "$u"; return 0; }
    sleep 1
  done
  return 1
}

echo "🌐 cloudflared tunnelek (Supabase + worker)…"
start_tunnel supabase 54421
start_tunnel worker 8787
SUPA=$(url_of supabase) || { echo "❌ supabase-tunnel nem jött létre"; tail -5 "$LOG/cf-supabase.log"; exit 1; }
WORK=$(url_of worker)   || { echo "❌ worker-tunnel nem jött létre";   tail -5 "$LOG/cf-worker.log";   exit 1; }
echo "  Supabase → $SUPA"
echo "  Worker   → $WORK"

# a backend-tunnelek a bundle-be (magasabb precedenciájú, gitignore-olt fájlból)
cat >"$ROOT/.env.development.local" <<ENVEOF
# 🌍 AUTOMATIKUSAN GENERÁLT (scripts/dev-tunnel.sh) — külső elérés. Ne kommitold;
# a dev-tunnel-down.sh törli. A quick-tunnel URL-ek indításonként mások.
EXPO_PUBLIC_SUPABASE_URL=$SUPA
EXPO_PUBLIC_SERVER_URL=$WORK
EXPO_PUBLIC_SERVER_HOST=${WORK#https://}
ENVEOF

# Metro újraindítása --tunnel módban
PIDS=$(lsof -tiTCP:8081 -sTCP:LISTEN 2>/dev/null || true)
for p in $PIDS; do
  ppid=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  kill "$p" 2>/dev/null || true; [ -n "$ppid" ] && kill "$ppid" 2>/dev/null || true
done
sleep 2
lsof -tiTCP:8081 -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true

echo "🚇 Metro indítása --tunnel módban (exp.direct)…"
: >"$LOG/metro.log"
nohup npx expo start --tunnel --port 8081 </dev/null >"$LOG/metro.log" 2>&1 &
echo $! >"$LOG/metro.pid"; disown 2>/dev/null || true

# várunk a Metróra, majd a manifestből kinyerjük az exp.direct hostot
METRO=""
for _ in $(seq 1 60); do
  if [ "$(curl -s --max-time 2 http://127.0.0.1:8081/status 2>/dev/null)" = "packager-status:running" ]; then
    host=$(curl -s --max-time 10 -H 'expo-platform: ios' -H 'accept: application/expo+json' http://127.0.0.1:8081 2>/dev/null \
      | python3 -c "import sys,json,urllib.parse as u; d=json.load(sys.stdin); print(u.urlparse((d.get('launchAsset') or {}).get('url','')).netloc)" 2>/dev/null)
    if echo "$host" | grep -q 'exp.direct'; then METRO="exp://$host"; break; fi
  fi
  sleep 2
done

{ echo "METRO=$METRO"; echo "SUPABASE=$SUPA"; echo "WORKER=$WORK"; } >"$LOG/tunnel-urls.txt"

echo
if [ -n "$METRO" ]; then
  echo "✅ KÉSZ. Expo Go (bármely hálózaton, akár mobilnet) → Enter URL manually:"
  echo "     $METRO"
else
  echo "⚠️ A Metro-tunnel URL nem jött ki automatikusan — nézd: .devlogs/metro.log"
  echo "   (a manifest launchAsset host-ja adja: curl -s -H 'expo-platform: ios' http://127.0.0.1:8081)"
fi
echo
echo "Címek: .devlogs/tunnel-urls.txt · Leállítás: scripts/dev-tunnel-down.sh"
