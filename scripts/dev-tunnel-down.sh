#!/usr/bin/env bash
# 🌍 A cloudflared tunnelek leállítása (a Metro marad — azt a dev-down.sh viszi).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/.devlogs"
for name in supabase worker metro; do
  if [ -f "$LOG/cf-$name.pid" ]; then
    kill "$(cat "$LOG/cf-$name.pid")" 2>/dev/null || true
    rm -f "$LOG/cf-$name.pid"
    echo "leállítva: cf-$name"
  fi
done
# maradék cloudflared quick-tunnel folyamatok
pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
# a generált tunnel-env eltávolítása → legközelebb újra LAN-env (dev-up.sh)
rm -f "$ROOT/.env.development.local"
echo "✅ tunnelek leállítva + .env.development.local törölve."
echo "   (A Metro tovább fut a régi env-vel; friss LAN-indításhoz: scripts/dev-up.sh, tunnelhez: scripts/dev-tunnel.sh)"
