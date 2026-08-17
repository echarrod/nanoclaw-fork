# Social credentials

Nanoclaw stores personal social credentials in the host database using AES-256-GCM encryption. The database contains ciphertext only. Credentials are not added to `.env`, copied into `ed-social`, mounted into agent containers, logged, or returned by CLI commands.

OAuth client IDs and the public callback base URL are normal host configuration. The encryption key, provider client secrets, app passwords, and user tokens are credentials and must stay outside `.env`.

## Host master key

Set `SOCIAL_CREDENTIALS_KEY` in the NanoClaw service environment, not in the project `.env` file. It must be a base64-encoded 32-byte key. Keep a copy in your password manager, never in chat or source control.

On the host, save that key through the hidden-prompt command. It writes a mode-`0600` systemd EnvironmentFile and a narrow user-service drop-in - it does not print or put the key in shell history:

```sh
pnpm social:master-key -- --systemd-unit nanoclaw-v2-1e478a5f.service
systemctl --user daemon-reload
systemctl --user restart nanoclaw-v2-1e478a5f.service
```

It refuses to overwrite an existing key file - replacing a key after credentials exist would make them unreadable.

Losing the key makes existing encrypted social credentials unrecoverable, so retain it in the same password manager or secure operations store as other deployment secrets.

## Enter a credential

On the NanoClaw host, identify the personal social agent group ID, then run:

```sh
pnpm social:credential -- --group <agent-group-id> --provider bluesky --kind app-password
```

The command requires an interactive TTY and hides input. It accepts no credential value on the command line, so the app password does not enter shell history. It reports only that a credential was configured.

Use `app-password` for the Bluesky credential. Future OAuth flows use provider-specific kinds such as `refresh-token`; those are stored through the same host-only boundary.

## Connect X or LinkedIn

Configure `SOCIAL_PUBLIC_BASE_URL`, the relevant public client ID, and the matching HTTPS callback URL in the provider's developer settings. NanoClaw registers these callbacks when configured:

```text
https://<public-nanoclaw-host>/webhook/social-oauth-x
https://<public-nanoclaw-host>/webhook/social-oauth-linkedin
```

Before LinkedIn connection, enter its application client secret through the hidden prompt:

```sh
pnpm social:credential -- --group <agent-group-id> --provider linkedin --kind client-secret
```

If the X developer application is configured as a confidential web application, store its client secret the same way. A public/native X client does not need one:

```sh
pnpm social:credential -- --group <agent-group-id> --provider x --kind client-secret
```

Then print a one-time approval URL from the host and open it in the account owner's browser:

```sh
pnpm social:oauth -- --group <agent-group-id> --provider x
pnpm social:oauth -- --group <agent-group-id> --provider linkedin
```

X uses PKCE and requests `offline.access` for refresh tokens. LinkedIn uses its server-side three-legged OAuth exchange with its application client secret. Both flows store resulting tokens only in the encrypted host credential store.
