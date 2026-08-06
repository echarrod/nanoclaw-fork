# `deploy/vps/` — host files for **this** install

Not upstream material. These are the two files that previously existed only on the VPS at
`169.58.119.23`, so a rebuild of the box lost them and nothing recorded that they existed.
Operational context lives in [`docs/deployment-vps.md`](../../docs/deployment-vps.md).

| File | Installs to |
|---|---|
| `nanoclaw-cloudflared.service` | `/etc/systemd/system/nanoclaw-cloudflared.service` |
| `cloudflared.yml.example` | `/etc/nanoclaw/cloudflared.yml` (after substituting the tunnel UUID) |

**What is deliberately not here:** `/etc/nanoclaw/<TUNNEL_ID>.json`, the tunnel
credentials. It is a live secret. If it is ever lost, delete the tunnel and create a new
one rather than trying to recover the file.

## Installing on a rebuilt host

Run as root on the VPS, with `TUNNEL_ID` set to the tunnel UUID
(`cloudflared --config /dev/null tunnel list`):

```bash
REPO=/home/nanoclaw/nanoclaw-v2
TUNNEL_ID=<uuid>

install -d -m 0750 -o root -g nanoclaw /etc/nanoclaw
sed "s/__TUNNEL_ID__/${TUNNEL_ID}/g" "$REPO/deploy/vps/cloudflared.yml.example" \
  > /etc/nanoclaw/cloudflared.yml
chown root:nanoclaw /etc/nanoclaw/cloudflared.yml
chmod 0640 /etc/nanoclaw/cloudflared.yml

# Credentials JSON: from `cloudflared tunnel create`, or the Cloudflare dashboard.
chown root:nanoclaw "/etc/nanoclaw/${TUNNEL_ID}.json"
chmod 0640 "/etc/nanoclaw/${TUNNEL_ID}.json"

install -m 0644 "$REPO/deploy/vps/nanoclaw-cloudflared.service" \
  /etc/systemd/system/nanoclaw-cloudflared.service
systemctl daemon-reload
systemctl enable --now nanoclaw-cloudflared
systemctl status nanoclaw-cloudflared
```

DNS routing is a one-off per tunnel. `--config /dev/null` is not decoration — a
`~/.cloudflared/config.yml` that pins a different `tunnel:` overrides the name given on
the command line, and the route silently lands on the wrong tunnel:

```bash
cloudflared --config /dev/null tunnel route dns "$TUNNEL_ID" nanoclaw.getstorra.com
```

## Before the hostname goes public

Cloudflare Access must be in front of `nanoclaw.getstorra.com` before DNS is routed, and
any webhook path needs a *scoped* Access bypass plus signature verification — Telegram,
WhatsApp, GitHub and Linear callbacks cannot complete an SSO flow. The recipe and the
blast-radius checks are in Hive's
[`docs/host.md`](https://github.com/storra-eng/hive/blob/main/docs/host.md) §4; reuse it
rather than re-deriving it. See also "Public hostname and the tunnel" in
[`docs/deployment-vps.md`](../../docs/deployment-vps.md).
