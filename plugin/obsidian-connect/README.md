# VaultConnect

Sync your Obsidian vault with a self-hosted backend and Google Drive. Browse your remote vaults visually, push local changes incrementally, and pull remote updates directly into Obsidian.

## What it does

- Authenticates with a backend (email/password or Google OAuth).
- Lists vaults stored in the backend and lets you pick one to link with your local vault.
- **Push**: detects changed local files since the last sync and uploads only the diff.
- **Pull**: downloads files that changed on the server since the last pull.
- Optional Google Drive integration: each vault can be backed by a Drive folder that stays in sync automatically.

## Requirements

- An account on the VaultConnect backend (self-hosted on Railway or another provider).
- Google Drive connection is optional but recommended for off-site backup.

## Installation

1. Open Obsidian → **Settings** → **Community plugins** → **Browse**.
2. Search for **VaultConnect** and click **Install**, then **Enable**.

Alternatively, install manually by copying `main.js` and `manifest.json` into `.obsidian/plugins/vault-connect/` inside your vault.

## Configuration

1. Open **Settings** → **VaultConnect**.
2. Enter your **Email** and **Password**, then click **Login email** — or click **Login with Google** to authenticate via Google OAuth.
3. Once logged in, click **Select vault** to pick an existing remote vault, or **Create from this vault** to create a new one from your current vault.
4. Optionally click **Connect Google Drive** to link a Drive folder to the selected vault.

## Usage

Use the sidebar panel (cloud icon in the left ribbon) or the toolbar buttons:

| Button | Action |
|--------|--------|
| **Push** | Upload local changes to the backend |
| **Pull** | Download remote changes to your vault |
| **New** | Create a new remote vault from the current local vault |
| **Web** | Open the backend web panel in your browser |

You can also run any of these via the Command Palette (`Ctrl/Cmd+P` → search "VaultConnect").

## Privacy

The plugin sends your vault files (content + metadata) to the backend URL configured at build time. No data is sent to third-party services unless you connect Google Drive, in which case Google's OAuth flow is used and files are stored in your own Drive account. Credentials are stored locally in Obsidian's plugin data file.
