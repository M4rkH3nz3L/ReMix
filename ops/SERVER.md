# ReMix – üzembe helyezési leírás (Hetzner + GitHub Actions)

## 0. Szerver adatok

| Mező | Érték |
|---|---|
| Név / ID | ReMix / 139673361 |
| Projekt | Default (Hetzner Cloud, projekt ID 12721871) |
| Típus | CPX32 – 4 vCPU, 8 GB RAM, 160 GB lokális disk, 20 TB forgalom |
| OS | Ubuntu 26.04 LTS |
| IPv4 | `195.201.18.57` |
| IPv6 | `2a01:4f8:1c1c:6d73::1` (tartomány: `2a01:4f8:1c1c:6d73::/64`) |
| Lokáció | Nürnberg, Németország (eu-central) |
| Havi díj | €17,77 (+ Backups opció esetén +20%) |
| Root user | `root` |
| Root jelszó | `__________________________` ← a rebuild után a Hetzner egyszer mutatja; ide/jelszókezelőbe írd |
| Deploy user | `deploy` (csak SSH kulccsal) |
| App könyvtár | `/opt/remix` |
| App port (belső) | `3000` (nincs publikálva, csak a Caddy éri el) |
| Publikus portok | 22 (SSH), 80, 443 (HTTP/HTTPS, HTTP/3) |

---

## 1. Deploy SSH kulcs generálása (saját gépen)

```bash
ssh-keygen -t ed25519 -C "github-actions-remix" -f ~/.ssh/remix_deploy -N ""
cat ~/.ssh/remix_deploy.pub   # -> szerverre (PUBKEY)
cat ~/.ssh/remix_deploy       # -> GitHub secret: SSH_PRIVATE_KEY
```

Opcionális `~/.ssh/config` bejegyzés:

```
Host remix
    HostName 195.201.18.57
    User deploy
    IdentityFile ~/.ssh/remix_deploy
```

---

## 2. Első belépés és szerver beállítás

```bash
ssh-keygen -R 195.201.18.57        # régi host key törlése (rebuild miatt)
ssh root@195.201.18.57             # root jelszóval
```

Mentsd `setup.sh` néven a szerveren, töltsd ki a `PUBKEY` és `MY_PUBKEY` értékét, majd `bash setup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PUBKEY="ssh-ed25519 AAAA... github-actions-remix"   # remix_deploy.pub
MY_PUBKEY="ssh-ed25519 AAAA... sajat-gep"          # a saját ~/.ssh/id_ed25519.pub

export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get -y upgrade
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades
hostnamectl set-hostname remix
timedatectl set-timezone Europe/Budapest

# swap (2 GB)
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Docker + Compose plugin
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh || apt-get install -y docker.io docker-compose-v2
fi
systemctl enable --now docker

# Docker log rotáció
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
systemctl restart docker

# root: saját kulcs
install -d -m 700 /root/.ssh
grep -qxF "$MY_PUBKEY" /root/.ssh/authorized_keys 2>/dev/null || echo "$MY_PUBKEY" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# deploy user
id deploy &>/dev/null || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf '%s\n%s\n' "$PUBKEY" "$MY_PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# app könyvtár
install -d -o deploy -g deploy /opt/remix

# tűzfal
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# SSH hardening
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
systemctl restart ssh

systemctl enable --now fail2ban
echo "KÉSZ. Teszt új terminálból: ssh -i ~/.ssh/remix_deploy deploy@195.201.18.57"
```

> Ne zárd be a root sessiont, amíg egy **új** terminálból sikeresen be nem léptél kulccsal.

### Szerver oldali `.env` (`/opt/remix/.env`, deploy userként)

```bash
ssh remix
cat > /opt/remix/.env <<'EOF'
DOMAIN=remix.pelda.hu
NODE_ENV=production
PORT=3000
SESSION_SECRET=CSERÉLD_LE_openssl_rand_hex_32
# DATABASE_URL=postgres://...
EOF
chmod 600 /opt/remix/.env
```

Titok generálás: `openssl rand -hex 32`

---

## 3. DNS

| Típus | Név | Érték |
|---|---|---|
| A | remix.pelda.hu | 195.201.18.57 |
| AAAA | remix.pelda.hu | 2a01:4f8:1c1c:6d73::1 |

A Caddy csak akkor kap Let's Encrypt tanúsítványt, ha a DNS már a szerverre mutat.

---

## 4. GitHub repo beállítások

**Settings → Secrets and variables → Actions → Secrets**

| Secret | Érték |
|---|---|
| `SSH_HOST` | `195.201.18.57` |
| `SSH_USER` | `deploy` |
| `SSH_PORT` | `22` |
| `SSH_PRIVATE_KEY` | `~/.ssh/remix_deploy` teljes tartalma (BEGIN…END sorokkal) |

**Settings → Environments** → hozz létre `production` környezetet (opcionálisan jóváhagyással).

**Settings → Actions → General → Workflow permissions**: *Read and write permissions* (GHCR push miatt).

A GHCR-hez nem kell külön token – a workflow a beépített `GITHUB_TOKEN`-t használja build és pull során is.

---

## 5. Fájlok a repóban

```
.
├── Dockerfile
├── .dockerignore
├── deploy/
│   ├── docker-compose.yml
│   └── Caddyfile
└── .github/workflows/deploy.yml
```

### `Dockerfile`

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
COPY package*.json ./
EXPOSE 3000
USER node
CMD ["npm", "run", "start"]
```

> Feltétel: `npm run build` a `build/` mappába épít, `npm run start` a `PORT` (3000) porton indul
> (Remix v2 Vite: `remix-serve ./build/server/index.js`; React Router v7: `react-router-serve ./build/server/index.js`).

### `.dockerignore`

```
node_modules
build
.git
.github
.env*
deploy
```

### `deploy/docker-compose.yml`

```yaml
services:
  app:
    image: ${APP_IMAGE:-ghcr.io/OWNER/REPO}:${APP_TAG:-latest}
    restart: unless-stopped
    env_file: .env
    expose:
      - "3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/"]
      interval: 30s
      timeout: 5s
      retries: 3

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  caddy_data:
  caddy_config:
```

### `deploy/Caddyfile`

```
{$DOMAIN} {
    encode zstd gzip
    reverse_proxy app:3000
}
```

Domain nélküli teszthez ideiglenesen `{$DOMAIN}` helyett `:80`.

### `.github/workflows/deploy.yml`

```yaml
name: Deploy ReMix

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image: ${{ steps.img.outputs.image }}
    steps:
      - uses: actions/checkout@v4

      - id: img
        run: echo "image=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ steps.img.outputs.image }}:latest
            ${{ steps.img.outputs.image }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Copy compose + Caddyfile
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          port: ${{ secrets.SSH_PORT }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          source: "deploy/docker-compose.yml,deploy/Caddyfile"
          target: /opt/remix
          strip_components: 1

      - name: Pull & restart
        uses: appleboy/ssh-action@v1.2.0
        env:
          GHCR_USER: ${{ github.actor }}
          GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APP_IMAGE: ${{ needs.build.outputs.image }}
          APP_TAG: ${{ github.sha }}
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          port: ${{ secrets.SSH_PORT }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          envs: GHCR_USER,GHCR_TOKEN,APP_IMAGE,APP_TAG
          script: |
            set -e
            cd /opt/remix
            echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
            # a használt image/tag rögzítése, hogy kézi restartnál is ugyanaz induljon
            grep -v '^APP_IMAGE=\|^APP_TAG=' .env > .env.tmp || true
            printf 'APP_IMAGE=%s\nAPP_TAG=%s\n' "$APP_IMAGE" "$APP_TAG" >> .env.tmp
            mv .env.tmp .env && chmod 600 .env
            docker compose --env-file .env pull app
            docker compose --env-file .env up -d --remove-orphans
            docker image prune -f
            docker logout ghcr.io
```

---

## 6. Első deploy és ellenőrzés

1. Push a `main` ágra (vagy Actions → *Deploy ReMix* → *Run workflow*).
2. Szerveren:
   ```bash
   ssh remix
   cd /opt/remix
   docker compose ps
   docker compose logs -f app
   docker compose logs -f caddy
   ```
3. Böngészőben: `https://remix.pelda.hu`

## 7. Hasznos parancsok

| Feladat | Parancs |
|---|---|
| Újraindítás | `cd /opt/remix && docker compose restart app` |
| Rollback adott commitra | `.env`-ben `APP_TAG=<sha>` → `docker compose up -d` |
| Logok | `docker compose logs -f --tail=200 app` |
| Erőforrás | `docker stats`, `htop`, `df -h` |
| Frissítések | `sudo apt update && sudo apt upgrade` (root) |

## 8. Ajánlott Hetzner opciók

- **Backups** bekapcsolása (Overview → Options → Enable) – most nincs mentés.
- **Cloud Firewall** (Firewalls menü): bejövő TCP 22, 80, 443 + UDP 443, a szerverhez rendelve.
- **Reverse DNS** (Networking → IPv4/IPv6 → rDNS): `remix.pelda.hu` (levelezés/reputáció miatt).