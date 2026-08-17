# Social credentials

Nanoclaw stores personal social credentials in the host database using AES-256-GCM encryption. The database contains ciphertext only. Credentials are not added to `.env`, copied into `ed-social`, mounted into agent containers, logged, or returned by CLI commands.

## Host master key

Set `SOCIAL_CREDENTIALS_KEY` in the NanoClaw service environment, not in the project `.env` file. It must be a base64-encoded 32-byte key. Generate it locally on the host and put it in the service manager's protected environment configuration; never paste it into chat or commit it.

Restart NanoClaw after setting the key. Losing the key makes existing encrypted social credentials unrecoverable, so retain it in the same password manager or secure operations store as other deployment secrets.

## Enter a credential

On the NanoClaw host, identify the personal social agent group ID, then run:

```sh
pnpm social:credential -- --group <agent-group-id> --provider bluesky --kind app-password
```

The command requires an interactive TTY and hides input. It accepts no credential value on the command line, so the app password does not enter shell history. It reports only that a credential was configured.

Use `app-password` for the Bluesky credential. Future OAuth flows use provider-specific kinds such as `refresh-token`; those are stored through the same host-only boundary.
