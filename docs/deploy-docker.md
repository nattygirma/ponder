# Deploy Ponder with Docker

Ponder uses the same web application, Hono routes, services, authentication,
MCP implementation, and append-only migrations on Cloudflare
and Docker. Only the thin runtime and infrastructure adapters differ: Docker
uses Bun with SQLite and local files (or S3-compatible object storage), while
Cloudflare uses Workers with D1 and R2.

## Requirements

- Docker Engine 24 or later with Docker Compose v2.
- An `amd64` or `arm64` Linux host.
- Linux kernel 5.6 or later. Older kernels are outside the formally supported
  Docker environment because Bun may fail to resolve container dependencies
  there. The installer warns without blocking installation; if startup reports
  `EISDIR reading .../node_modules/...`, upgrade the host OS or kernel before
  changing `/data` permissions or replacing application data.
- A reverse proxy with HTTPS when the instance is reachable outside a trusted
  local network.

## One-command install

With Docker Compose v2 already installed:

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

The installer creates `~/ponder`, generates an administrator password, pulls
`latest`, starts the container, and waits for it to become healthy. Run the same
command again to upgrade without replacing the password or `/data` volume. The
installer and Compose configuration use the official GHCR image.

By default, the installer schedules `~/ponder/update.sh` with the current
user's crontab at 04:17 server time every day. The updater refreshes the Compose
configuration, pulls the configured image tag, restarts the service when needed,
and verifies container health. Output is appended to `~/ponder/update.log`.
The default `latest` tag receives new releases automatically; a version supplied
with `--version` remains pinned. Use `--no-auto-update` or
`PONDER_AUTO_UPDATE=false` to disable the schedule. If `crontab` is unavailable,
the installer keeps `update.sh` and prints instructions for adding it to the NAS
task scheduler.

Use `--version vX.Y.Z`, `--port PORT`, or `--install-dir DIR` when needed. Run
`curl -fsSL https://edgeever.org/install.sh | bash -s -- --help` for all options.

## Manual Compose

Download `compose.yaml`, choose the release you want to run, and provide a
strong instance password:

```sh
export PONDER_VERSION=vX.Y.Z
export PONDER_AUTH_PASSWORD='replace-with-a-long-random-password'
docker compose up -d
docker compose ps
```

Open `http://localhost:8787`. The container reports healthy only after the
shared `/api/health` endpoint confirms that authentication, SQLite, and object
storage are ready.

### Image registry

The official image is `ghcr.io/tianma-if/edgeever` and supports `linux/amd64`
and `linux/arm64`. Pin `PONDER_VERSION` to a release tag in production.

Compose creates one named volume. Everything that must survive a container
replacement is under `/data`:

```text
/data/ponder.sqlite            SQLite database
/data/ponder-secrets.json      credential encryption secret
/data/resources/                 local images and attachments
```

The image runs as the non-root `bun` user (UID/GID `1000`). If a NAS requires
a host bind mount instead of the named volume, create the directory first and
grant UID/GID `1000` read/write access.
When an installation or automatic update fails, the script performs a real
write test against `/data` and reports the mount type, source, container user,
and directory state. If permissions are the cause, it prints a repair command
tailored to a Docker named volume or NAS bind mount; it never changes existing
data permissions automatically.

## Configuration

Common environment variables:

| Variable                               | Default | Purpose                                                     |
| -------------------------------------- | ------- | ----------------------------------------------------------- |
| `PONDER_AUTH_USERNAME`              | `admin` | Initial administrator username                              |
| `PONDER_AUTH_PASSWORD`              | none    | Initial password; required for a new database               |
| `PONDER_AUTH_PASSWORD_HASH`         | none    | PBKDF2 hash alternative to the plaintext bootstrap password |
| `PONDER_SESSION_TTL_DAYS`           | `400`   | Login session lifetime                                      |
| `PONDER_IDLE_TIMEOUT_SECONDS`       | `120`   | Bun streaming idle timeout, from 10 to 255 seconds          |
| `PONDER_CREDENTIALS_ENCRYPTION_KEY` | persisted on `/data` | Optional independent AI credential encryption key. If unset, Docker stores the authentication secret or a generated key in `/data/ponder-secrets.json`. |
| `PONDER_COMMUNITY_REGISTRY_URL` | unset | Optional HTTPS URL of the signed community plugin catalog. Leave it unset to show only the built-in official plugins. |

For secrets, append `_FILE` to a supported variable and point it at a Docker
secret, for example `PONDER_AUTH_PASSWORD_FILE=/run/secrets/auth_password`.
The password/hash and S3 access credentials support this form. Do not set both
the direct variable and its `_FILE` counterpart.

`PONDER_ALLOW_UNAUTHENTICATED=true` is available for isolated development
only. Do not expose an unauthenticated instance to a network.

## S3-compatible attachment storage

SQLite remains in `/data`, while new attachments can be stored in MinIO, AWS
S3, Alibaba Cloud OSS, Tencent COS, R2, or another compatible service:

```yaml
environment:
  PONDER_STORAGE_BACKEND: s3
  PONDER_S3_ENDPOINT: https://s3.example.com
  PONDER_S3_REGION: us-east-1
  PONDER_S3_BUCKET: ponder
  PONDER_S3_ACCESS_KEY_ID_FILE: /run/secrets/s3_access_key
  PONDER_S3_SECRET_ACCESS_KEY_FILE: /run/secrets/s3_secret_key
  PONDER_S3_FORCE_PATH_STYLE: "true"
```

Changing the default backend does not migrate historical attachments. Keep
the old backend available until its resources have been exported or migrated.

## HTTPS and network exposure

The container serves HTTP on port `8787`. Terminate HTTPS in a maintained
reverse proxy such as Caddy, Traefik, or Nginx and forward the original host
and client address headers. Do not publish SQLite, `/data`, or an object-store
administration port.

## Backup and restore

Use Ponder's ZIP export for portable content backups. Also make a cold copy
of the `/data` volume for complete instance recovery:

1. Run `docker compose stop ponder` and wait for the shutdown-complete log.
   Ponder checkpoints SQLite's WAL during graceful shutdown.
2. Copy or snapshot the entire named volume, including the SQLite file,
   `ponder-secrets.json`, and the `resources` directory.
3. Start the service with `docker compose start ponder`.

Docker persists the credential-encryption root in `/data/ponder-secrets.json`,
so a complete `/data` volume backup can decrypt saved AI and object-storage
credentials after a container rebuild. Keep any explicit
`PONDER_CREDENTIALS_ENCRYPTION_KEY` in a separate secret backup if you
manage secrets outside the volume. Cloudflare deployments still require the
Worker authentication secret; they do not use this file. When S3 storage is
enabled, back up the bucket separately.

Restore only while Ponder is stopped, into an empty volume. Test backups
periodically on a separate instance.

## Upgrade and rollback

Use immutable release tags instead of `latest` for production:

```sh
export PONDER_VERSION=vX.Y.Z
docker compose pull
docker compose up -d
docker compose ps
```

The container applies the same append-only `migrations/*.sql` files used by D1
before it starts accepting traffic. Take a backup first. Application rollback
does not reverse a database migration; restore the pre-upgrade volume backup
when a data rollback is required.

The image default command is `bun scripts/self-hosted-server.js`. It also keeps
`scripts/self-hosted-server.mjs` as an alias, because NAS and GUI panels often
reuse the command saved from v1.62 and earlier. If logs show
`Module not found "scripts/self-hosted-server.mjs"`, pull a release that includes
that alias, or clear the custom command so the image default is used.

To move between Cloudflare and Docker, use Ponder's full backup/export and
restore flow. Do not copy a live D1 database file or rewrite migration history.

## Build from source

```sh
docker build --tag ponder:local .
docker run --rm -p 8787:8787 \
  -e PONDER_AUTH_PASSWORD='replace-with-a-long-random-password' \
  -v ponder-data:/data \
  ponder:local
```

### System information metadata

**Settings → System information** separates how the image was built from how
the instance was deployed. Official images fill in the build fields; self-built
images report them as unknown unless you pass the build arguments below.

| Field | Source | Meaning |
| ----- | ------ | ------- |
| Instance build | `--build-arg PONDER_BUILD_ID` | Commit the image was built from |
| Image built at | `--build-arg PONDER_BUILD_CREATED_AT` (ISO 8601) | When the image was built, not when it was deployed or started |
| Image build source | `--build-arg PONDER_BUILD_TRIGGER` / `PONDER_BUILD_METHOD` | How the image was produced, for example `github_release` · `github_actions` for official release images |
| Container image source | runtime `PONDER_CONTAINER_IMAGE` | Registry the image was pulled from; set by the official `compose.yaml` |
| Deployment source | runtime `PONDER_DEPLOYMENT_TRIGGER` / `PONDER_DEPLOYMENT_METHOD` | How you deployed this instance; unknown unless you set it |
| Instance deployment time | Cloudflare only | Docker does not report a deployment time |

Triggers are `github_release`, `main_push` or `manual`. `PONDER_DEPLOYMENT_METHOD=docker`
describes a container deployment, while `github_actions`, `cloudflare_workers_builds`
and `local_cli` describe the mechanism that ran a build or deployment. Ponder
never infers Docker or the registry on its own, because the same server also runs
directly under Bun and images can be copied between registries. Missing or invalid
values are shown as unknown.

For a self-built image:

```sh
docker build \
  --build-arg PONDER_BUILD_ID="$(git rev-parse HEAD)" \
  --build-arg PONDER_BUILD_CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg PONDER_BUILD_TRIGGER=manual \
  --build-arg PONDER_BUILD_METHOD=local_cli \
  --tag ponder:local .
docker run --rm -p 8787:8787 \
  -e PONDER_AUTH_PASSWORD='replace-with-a-long-random-password' \
  -e PONDER_CONTAINER_IMAGE=ponder:local \
  -e PONDER_DEPLOYMENT_TRIGGER=manual \
  -e PONDER_DEPLOYMENT_METHOD=docker \
  -v ponder-data:/data \
  ponder:local
```

PostgreSQL is not supported in the first Docker release. It remains a future
storage adapter and will not introduce a separate business-code branch.
