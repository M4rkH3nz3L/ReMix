#!/usr/bin/env bash
#
# ReMix — Hetzner szerver első beállítása (Ubuntu 24.04, rootként futtatva).
# Egyszer kell lefuttatni a REBUILD UTÁN, a kiírt root-jelszóval belépve.
#
#   ssh root@195.201.16.57          # (rebuild utáni root jelszóval)
#   # töltsd fel ezt a fájlt VAGY másold be a tartalmát, majd:
#   bash server-setup.sh
#
# Mit csinál: rendszerfrissítés → Docker → `deploy` user (SSH-kulcsos, docker+sudo) →
# SSH-hardening (jelszavas login + root-login tiltva) → ufw + fail2ban + auto-security-update
# → swap + docker-logrotáció → /var/www/app könyvtár a deploynak.
#
# ⚠️ Ne zárd be ezt a root-sessiont, amíg egy MÁSIK terminálból kulccsal be nem léptél:
#      ssh -i ~/.ssh/remix deploy@195.201.16.57
set -euo pipefail

# A CI/CD deploy-kulcs PUBLIKUS fele (a ~/.ssh/remix_deploy.pub). Publikus kulcs → verziózható.
# Felülírható futásidőben:  DEPLOY_PUB='ssh-ed25519 AAAA... deploy@remix' bash server-setup.sh
DEPLOY_PUB="${DEPLOY_PUB:-ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL881YqDaOOLHaU4Ih4zwLX628w/GrwF8JOEIBNtG9M/ deploy@remix}"

export DEBIAN_FRONTEND=noninteractive

echo "==> rendszerfrissítés + alapcsomagok"
apt-get update && apt-get -y upgrade
apt-get install -y git curl ca-certificates ufw fail2ban unattended-upgrades
hostnamectl set-hostname remix || true
timedatectl set-timezone Europe/Budapest || true

echo "==> swap (2 GB — a 4K-render memóriacsúcsaihoz)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -qxF '/swapfile none swap sw 0 0' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Docker (hivatalos install-script)"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo "==> Docker log-rotáció (ne egye meg a lemezt)"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
JSON
systemctl restart docker

echo "==> deploy user (SSH-kulcsos, docker + sudo NOPASSWD)"
id deploy &>/dev/null || adduser --disabled-password --gecos "" deploy
usermod -aG docker,sudo deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy && chmod 440 /etc/sudoers.d/deploy

install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# a root-ra ssh-copy-id-val felvitt SAJÁT kulcs → deploy is kapja; + a CI deploy-kulcs
touch /home/deploy/.ssh/authorized_keys
cat /root/.ssh/authorized_keys >> /home/deploy/.ssh/authorized_keys 2>/dev/null || true
grep -qxF "$DEPLOY_PUB" /home/deploy/.ssh/authorized_keys || echo "$DEPLOY_PUB" >> /home/deploy/.ssh/authorized_keys
# duplikátumok kiszűrése
sort -u /home/deploy/.ssh/authorized_keys -o /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

echo "==> app-könyvtár: /var/www/app (git root; a compose a server/ almappából fut)"
install -d -o deploy -g deploy /var/www/app

echo "==> tűzfal (SSH + HTTP + HTTPS, + 443/udp a Caddy HTTP/3-hoz)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> SSH-hardening: csak kulccsal, root-login tiltva"
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
EOF
systemctl restart ssh || systemctl restart sshd

echo "==> fail2ban + automatikus security-frissítések"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo
echo "KÉSZ ✅  Mielőtt kilépsz, MÁSIK terminálból ellenőrizd a kulcsos belépést:"
echo "    ssh -i ~/.ssh/remix        deploy@195.201.16.57"
echo "    ssh -i ~/.ssh/remix_deploy deploy@195.201.16.57   # CI-kulccsal is"
