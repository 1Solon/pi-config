# Pi configuration

Personal configuration for [pi](https://pi.dev).

## Contents

This snapshot combines Pi's global configuration from `~/.pi/agent` with the shared skills installed under `~/.agents/skills`. The shared skills are stored in this repository's `skills/` directory so Pi discovers them after restore.

## Restore

Clone this repository into Pi's global configuration directory:

```powershell
git clone https://github.com/1Solon/pi-config.git "$HOME/.pi/agent"
pi
```

Pi installs the packages listed in `settings.json` when it starts. The selected theme is supplied by the configured `awesome-pi-themes` package, so there is no local theme file to restore.

## Not backed up

Credentials (`auth.json`), provider secrets (`models.json`), session history, runtime state, installed packages, generated model catalogs, checkpoints, and downloaded binaries are intentionally ignored. Run `/login` after restoring credentials on a new machine.

Before committing future changes, check `git diff --staged` for secrets.
