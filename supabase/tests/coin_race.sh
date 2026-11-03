#!/usr/bin/env bash
# 🏁 PRO-CASH C0.3: párhuzamos költés nem megy mínuszba. 20 külön kapcsolat terhel egyszerre
# 1 Coin-t egy 10 Coin-os egyenlegből → pontosan 10 sikerül, a maradék 0, a napló egyezik.
# Valódi, véglegesített tranzakciók egy eldobható tesztfiókon; a végén a fiók törlődik.
set -euo pipefail
DB=(docker exec -i supabase_db_ReMix psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1)
UID_T='f1000000-0000-0000-0000-0000000000ff'
cleanup() { "${DB[@]}" -c "delete from auth.users where id = '$UID_T'" >/dev/null; }
trap cleanup EXIT
cleanup
"${DB[@]}" >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email) values
  ('$UID_T', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race@t.test');
select public.grant_coins('$UID_T', 1000, 'purchased', 'topup', 'race');
SQL
OUT=$(mktemp -d)
for i in $(seq 1 20); do
  ( "${DB[@]}" -c "select public.coin_debit('$UID_T', 100, 'purchase', 'race $i')" >/dev/null 2>"$OUT/$i.err" && touch "$OUT/$i.ok" ) &
done
wait
OK=$(ls "$OUT" | grep -c '\.ok$' || true)
INSUF=$(grep -l insufficient_credits "$OUT"/*.err 2>/dev/null | wc -l | tr -d ' ')
read -r BAL PURCH TXSUM <<<"$("${DB[@]}" -F' ' -c "select u.balance, u.purchased_cents, (select sum(delta_cents) from public.credit_transactions where user_id = u.user_id) from public.user_credits u where user_id = '$UID_T'")"
rm -rf "$OUT"
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 — várt $3, kapott $2"; fail=1; fi; }
check 'C0.3 párhuzamos költés: pontosan 10 terhelés sikerül' "$OK" 10
check 'C0.3 párhuzamos költés: a többi 10 insufficient_credits' "$INSUF" 10
check 'C0.3 párhuzamos költés: az egyenleg 0, nem negatív' "$BAL" 0
check 'C0.3 párhuzamos költés: a vásárolt alegyenleg 0' "$PURCH" 0
check 'C0.3 párhuzamos költés: a napló összege = az egyenleg' "$TXSUM" 0
[ $fail = 0 ] && echo "5 / 5 rendben" || { echo "coin_race: hibás"; exit 1; }
