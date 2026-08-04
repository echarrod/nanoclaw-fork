# Deployment: this install (VPS, rootless Docker)

Operational reference for **our** NanoClaw instance. Everything here is specific to this
deployment — it is *not* upstream documentation, and should not go into an upstream PR.

Migrated from macOS to the VPS on **3 Aug 2026**.

## Where it runs

| | |
|---|---|
| Host | `169.58.119.23` — Ubuntu 24.04.4 LTS, 4 vCPU, 8 GB RAM, 96 GB disk |
| Unix user | `nanoclaw` (uid **1001**), lingering enabled |
| Install path | `/home/nanoclaw/nanoclaw-v2` |
| Install slug | **`1e478a5f`** = `sha1("/home/nanoclaw/nanoclaw-v2")[:8]` |
| systemd unit | `nanoclaw-v2-1e478a5f.service` (**user** unit, not system) |
| Agent image | `nanoclaw-agent-v2-1e478a5f:latest` (~3.1 GB) |
| Docker | **rootless**, per-user daemon at `unix:///run/user/1001/docker.sock` |
| Firewall | `ufw` active — only 22/tcp inbound. NanoClaw needs no inbound port |

The slug is derived from the install path, so **moving the directory changes the unit name
and image tag** and breaks the service. Don't move it.

### The macOS install is now a cold spare

`com.nanoclaw-v2-69803438` is unloaded on the Mac. Don't start it — two hosts polling one
Telegram bot token causes `getUpdates` 409, and two WhatsApp sessions log each other out.
It also has a broken `better-sqlite3` (built for `NODE_MODULE_VERSION 127`, node wants
147); it would need `pnpm rebuild better-sqlite3` before it could run at all.

## The command preamble (read this first)

Because Docker is **rootless** and the service is a **user** unit, almost every command
needs the right environment. `su - nanoclaw` alone is not enough — `systemctl --user`
fails with `Failed to connect to bus: No medium found` without `DBUS_SESSION_BUS_ADDRESS`.

```bash
ssh root@169.58.119.23
su - nanoclaw
export XDG_RUNTIME_DIR=/run/user/1001
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus
export DOCKER_HOST=unix:///run/user/1001/docker.sock
cd ~/nanoclaw-v2
```

`XDG_RUNTIME_DIR`, `DOCKER_HOST` and `PATH` are already in `~/.bashrc`; the DBUS one is
not (it is only needed for `systemctl --user`).

## Service management

```bash
systemctl --user status  nanoclaw-v2-1e478a5f
systemctl --user restart nanoclaw-v2-1e478a5f
systemctl --user stop    nanoclaw-v2-1e478a5f
systemctl --user start   nanoclaw-v2-1e478a5f
journalctl --user -u nanoclaw-v2-1e478a5f -f      # unit-level only
```

Application logs do **not** go to journald — the unit redirects them:

```bash
tail -f ~/nanoclaw-v2/logs/nanoclaw.error.log     # check this first
tail -f ~/nanoclaw-v2/logs/nanoclaw.log           # full routing chain
```

`logs/nanoclaw.error.log` is noisy with libsignal chatter (`Closing open session in favor
of incoming prekey bundle`) — that's normal WhatsApp E2EE churn, not an error.

The rootless Docker daemon is its own user unit:

```bash
systemctl --user status docker
```

## Resource limits

```bash
systemctl set-property user-1001.slice MemoryMax=5G CPUQuota=250%    # run as root
```

Currently **5 G / 250%**, deliberately generous because NanoClaw is the only tenant so
far — the cap is runaway protection, not fair-sharing. **Drop to ~3 G** once the other
tenants land (below). A too-tight cap OOM-kills agent containers in a way that looks like
random session failures.

## Rootless Docker: what's different

This install diverges from upstream for one reason: agent containers must run as
`--user 1000:0`. Two constraints collide under rootless:

- The host user is already mapped to container UID 0, so host-owned bind-mounted session
  files appear root-owned. The real host UID owns nothing → `EACCES` on the first
  `/workspace/.heartbeat` write.
- UID 0 is not an option either: Claude Code refuses `--dangerously-skip-permissions` as
  root, which the provider requests via `permissionMode: 'bypassPermissions'`. It fails
  with the opaque **`Claude Code process exited with code 1`** on every turn, while a
  manual `claude -p` inside the same container works fine.

| `--user` | Result |
|---|---|
| `1001:1001` (real host uid) | `EACCES` on the mount |
| `0:0` | Mount writable, Claude Code exits 1 every turn |
| `1000:1000` (image default) | `EACCES` on the mount |
| **`1000:0`** | **Works** |

UID 1000 is the image's non-root `node` user; GID 0 maps to the host user's primary group,
so the mounts stay writable **provided files are group-writable**. Hence `UMask=0002` in
the unit, plus a one-off `chmod -R g+w data/v2-sessions groups` for pre-existing files.

Also true of rootless, worth knowing before you design anything around it:
**a container cannot reach a service on the host's `127.0.0.1`** —
`host.docker.internal` resolves into RootlessKit's netns. It doesn't affect us
(`ONECLI_URL` is the cloud broker, `https://api.onecli.sh`), but it would bite anything
expecting Docker Desktop's macOS behaviour.

### Upstream status of this change

Committed on branch **`ed/rootless-docker-uid-mapping`** (`bb182664`), pushed to
`echarrod/nanoclaw-fork`. **The VPS install now runs on that branch** — the fix is tracked
source, not an uncommitted working-tree edit, so a checkout or update can no longer
silently drop it.

```bash
git branch --show-current    # -> ed/rootless-docker-uid-mapping
```

Still worth care when updating: if `/update-nanoclaw` or any merge brings in a change to
`src/container-runner.ts`, confirm the rootless branch survives it —

```bash
grep -c "1000:0" src/container-runner.ts    # must be 1
```

If that returns 0, every agent turn will fail with `Claude Code process exited with code 1`
while the host looks perfectly healthy. Until the change lands upstream, rebase this
branch rather than abandoning it.

## Channels

| Channel | Status | Notes |
|---|---|---|
| Telegram | working | bot `eds_nemo_bot`, long-polling, no inbound port needed |
| WhatsApp | working | re-paired 4 Aug 2026; full round-trip verified |
| CLI | present but **not wired** | `cli` messaging group exists with no agent group, so `pnpm run chat` times out |

**NanoClaw is linked to Ed's own number** (`447554139120`), so the "WhatsApp (Ed)" DM is a
**self-chat** — every message has `fromMe=true`. The adapter only lets those through when
`chatJid === botPhoneJid`, and `botPhoneJid` is derived from `sock.user.id` at connect.

Channel adapters are normally skill-installed, but they came across in the migration
(`src/channels/telegram.ts`, `whatsapp.ts`), so `/add-telegram` and `/add-whatsapp` are
**not** needed here.

### WhatsApp re-pair

The Baileys session is half-linked: it connects and can send, but receives nothing. Auth
state lives in **`store/auth/`** (not `data/`).

```bash
ssh -t root@169.58.119.23 'su - nanoclaw -c "/home/nanoclaw/repair-whatsapp.sh"'
```

That script stops the service, backs up `store/auth` to `store/auth.bak-<stamp>`, requests
a pairing code, and **restores the backup and restarts if pairing doesn't complete**.
On the phone: WhatsApp → Settings → Linked devices → Link a device → *Link with phone
number instead*.

Two traps if you run the auth step by hand:

- **`pnpm run auth` is broken** — `package.json` points at `src/whatsapp-auth.ts`, which
  does not exist. The real step is `setup/whatsapp-auth.ts`.
- That file only **exports** `run()`; it never self-executes. Running
  `tsx setup/whatsapp-auth.ts` directly does nothing and **exits 0**. Go through the
  dispatcher:

```bash
pnpm exec tsx setup/index.ts --step whatsapp-auth --method pairing-code --phone <number>
```

It also short-circuits with `STATUS: skipped / already-authenticated` if
`store/auth/creds.json` exists — move it aside first.

`WHATSAPP_ALLOWED_SENDERS` in `.env` is an allowlist of digit-only numbers. Non-listed
senders are dropped, but that one *does* log at debug level
(`WhatsApp message dropped — sender not in allowlist`).

### Diagnosing "WhatsApp connects but nothing arrives"

A half-linked Baileys session **can still send** — outbound delivery succeeding proves
nothing about inbound. The signal to check is whether any message ever reached routing:

```bash
grep -c "Inbound" logs/nanoclaw.log        # 0 for WhatsApp = inbound never worked
```

Distinguish *not receiving* from *receiving but not routing* — a live session logs plenty
of raw traffic even when nothing routes:

```bash
grep -icE "metadata discovered|Translated LID|prekey|Media downloaded" logs/nanoclaw.log
```

Beware: **the `fromMe` gate drops silently.** In `src/channels/whatsapp.ts`, both
`continue`s inside `if (fromMe) { ... }` have no logging, so a self-chat message rejected
there is invisible even at `LOG_LEVEL=debug`. To see it, temporarily log `chatJid`,
`sender`, `fromMe`, `botPhoneJid` and `isSelfChat` right after `const fromMe = ...`, then
rebuild and restart. Remember to revert it.

Enable debug logging by adding `Environment=LOG_LEVEL=debug` to the unit, then
`systemctl --user daemon-reload && systemctl --user restart <unit>`.

## Admin CLI

```bash
pnpm run ncl groups list
pnpm run ncl wirings list
pnpm run ncl dropped-messages list          # messages from unwired/unknown senders
pnpm run ncl groups config get --id <agent-group-id>
pnpm run ncl groups restart --id <id> [--message "..."]
```

`groups restart --message` only writes an on-wake message **if a container is currently
running** (it respawns via the kill's `onExit` callback). With nothing running it returns
`{"restarted": 0}` and does nothing.

Ad-hoc SQL — use the in-tree wrapper, not the `sqlite3` binary (which isn't installed):

```bash
pnpm exec tsx scripts/q.ts data/v2.db "select id, name from agent_groups"
```

Column names that catch people out: `messages_in` uses **`content`** and **`status`**
(not `body`/`processed_at`); `messages_out` has no status column.

## Current entities

| | |
|---|---|
| Agent group | `ag-1782125782356-1txucc` — **Nemo**, folder `dm-with-ed`, `cli_scope: global` |
| Wired | `telegram` → Nemo (`shared`), `whatsapp` DM "WhatsApp (Ed)" → Nemo (`shared`) |
| Sessions | `sess-1782125782361-aa2p1e` (Telegram), `sess-1782814504808-9123n4` (WhatsApp) |

Container config is all defaults — no model/effort override, no MCP servers.

## Credentials

Auth goes through **OneCLI cloud** (`ONECLI_URL=https://api.onecli.sh`). There is no
Anthropic key in `.env`; the gateway injects it per request, so nothing is stored in the
container. Verified working — `echo 2+2 | /pnpm/claude -p` inside a live container returns
`4`.

`secretMode: selective` on the OneCLI agent is **not** a problem — it was a red herring
during migration. Note the API has changed: `/api/agents/:id/secrets` is gone, replaced by
grants (`PUT /v1/agents/:id/grants/secrets/:secretId`).

## Troubleshooting

**Container logs vanish on exit** (`--rm`). Grab them while the container is alive:

```bash
docker ps
docker logs <container-name>
```

**The agent-runner swallows the real error.** `Query error: Claude Code process exited
with code 1` tells you nothing. To surface the actual stderr, drive the SDK directly
inside a live container with a `stderr` callback in the `query()` options — that is how
the root-guard failure above was found.

**Check the two-DB split** when a message seems lost:

```bash
S=data/v2-sessions/<agent-group>/<session>
pnpm exec tsx scripts/q.ts $S/inbound.db  "select id,kind,status,substr(content,1,60) from messages_in order by rowid desc limit 5"
pnpm exec tsx scripts/q.ts $S/outbound.db "select channel_type,substr(content,1,80) from messages_out order by rowid desc limit 5"
```

`channel_type: agent` rows are internal agent-to-agent messages, **not** delivered to
Telegram/WhatsApp. A pile of them is noise, not user-visible spam.

**Did it actually go out?** `grep -c "Message delivered" logs/nanoclaw.log`.

## Other tenants on this box

The VPS is intended to host three workloads, each as its **own Unix user with its own
rootless Docker daemon** — separate UID, home, daemon, image store and networks:

| Tenant | Status |
|---|---|
| `nanoclaw` | live (this doc) |
| `cyrus` | not yet migrated — works Linear issues assigned to the app |
| `hive` / `paperclip` | separate session; memory + agent orchestration |

House rules so the tenants don't undermine each other:

- **Never add anyone to the `docker` group** — root-equivalent, collapses all three into
  one trust domain.
- **Don't re-enable the system Docker daemon.** `docker.service`, `docker.socket` and
  `containerd.service` are deliberately disabled. Rootful Docker also writes its own
  iptables rules and **bypasses ufw**; rootless does not.
- **Nothing binds `0.0.0.0`.** Reach admin UIs over `ssh -L`.

**Incus/LXD was evaluated and rejected**: Docker 29.7.1 cannot start *any* container
inside an unprivileged Incus container on this kernel (`runc create failed: ... open
sysctl net.ipv4.ip_unprivileged_port_start: permission denied`). It looks healthy right up
to the first `docker run` — Incus installs fine, the storage driver comes up `overlayfs`,
and BuildKit builds succeed. Incus is still installed but unused (zero instances).

## Rebuilding

```bash
cd ~/nanoclaw-v2
pnpm install --frozen-lockfile
pnpm run build            # host TypeScript -> dist/
pnpm test                 # vitest
./container/build.sh      # agent image, ~3.5 min on this box
```

`pnpm test` on 4 vCPUs occasionally flakes `scripts/q.test.ts` on a 5 s timeout under
parallel load; it passes in isolation at ~2.3 s. Re-run the single file before believing
a failure:

```bash
pnpm exec vitest run scripts/q.test.ts
```
