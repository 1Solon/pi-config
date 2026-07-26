# Pi configuration

Personal configuration for [pi](https://pi.dev).

## Restore

Clone this repository into pi's global configuration directory:

```powershell
git clone https://github.com/1Solon/pi-config.git "$HOME/.pi/agent"
cd "$HOME/.pi/agent"
npm install
pi
```

Pi installs the packages listed in `settings.json` when it starts. Extension-specific dependencies can be restored from each extension directory with `npm install` when needed.

## Not backed up

Credentials (`auth.json`), provider secrets (`models.json`), session history, runtime state, installed packages, generated model catalogs, checkpoints, and downloaded binaries are intentionally ignored. Run `/login` after restoring credentials on a new machine.

Before committing future changes, check `git diff --staged` for secrets.
