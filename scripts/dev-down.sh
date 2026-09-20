#!/usr/bin/env bash
# ⏹️ A dev-up.sh által indított szolgáltatások leállítása (Supabase MARAD — azt a
# `supabase stop` állítja le, hogy a konténer-indítás ne teljen minden alkalommal).
set -u
cd "$(dirname "$0")/.." || exit 1
LOG="$(pwd)/.devlogs"

for name in dashboard metro worker; do
  pidf="$LOG/$name.pid"
  if [ -f "$pidf" ]; then
    pid="$(cat "$pidf" 2>/dev/null || echo '')"
    if [ -n "$pid" ] && kill "$pid" 2>/dev/null; then
      echo "⏹️  $name (pid $pid) leállítva"
    else
      echo "•  $name már nem futott"
    fi
    rm -f "$pidf"
  else
    echo "•  $name: nincs PID-fájl"
  fi
done

echo ""
echo "Supabase MARAD (leállítás: supabase stop)."
