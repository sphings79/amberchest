<div align="center">

<img src="assets/icon.svg" width="96" height="96" alt="Mail Archiver logo">

# Mail Archiver — The Mail Backup Solution

**Back up IMAP mailboxes to plain `.eml` files you own.** Self-hosted email
archiving for macOS, Windows, Linux and Docker — read-only, incremental, and
with a folder tree that mirrors your mailbox.

[![Licence: AGPL v3](https://img.shields.io/badge/licence-AGPL--3.0-7c5cff?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Docker-2b3040?style=flat-square)](#install)
[![Built with TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6?style=flat-square)](https://www.typescriptlang.org/)
[![Stars](https://img.shields.io/github/stars/sphings79/mail-archiver?style=flat-square&color=f0b429)](https://github.com/sphings79/mail-archiver/stargazers)

[Deutsche Version](README.de.md) · [Features](#features) · [Install](#install) · [Docker](#docker) · [OAuth](#oauth-for-gmail-and-microsoft-365) · [Home Assistant](#home-assistant) · [FAQ](#faq)

</div>

---

## Why another IMAP backup tool?

Your provider can lose your mail. An account can be closed, a password can be
stolen, a sync can go wrong. A backup that lives on your own disk, in a format
every mail client can read, is the only copy that is really yours.

Mail Archiver downloads your mailbox and leaves it exactly as it was: **nothing
is deleted on the server, nothing is marked as read.** Folders are opened
read-only and message bodies are fetched with `BODY.PEEK`, the IMAP command
that exists precisely so a client can read a message without touching its
`\Seen` flag.

> **All six stages are done.** Backup, attachment export, search, viewer,
> exports, MCP, restore, the container and the remote mode all work.

## Screenshots

<div align="center">

<em>Every picture shows both looks: dark on the left, light on the right, torn apart down the middle.</em>

<br><br>

<img src="assets/screenshots/overview.svg" width="880" alt="Overview screen with aggregate numbers, account status and recent backups, dark and light side by side">

<em>Overview — how much is archived, what is running, what happened last night.</em>

<br><br>

<img src="assets/screenshots/browser.svg" width="880" alt="Mailbox browser with accounts and the folder tree on the left and the message list on the right, dark and light side by side">

<em>Mailbox — accounts and folders on the left like a file manager, the messages of the selected folder on the right.</em>

<br><br>

<img src="assets/screenshots/search.svg" width="880" alt="Search screen with the filters open for field, sender, recipient, dates, size and sort order, dark and light side by side">

<em>Search — full text over subject, body and attachment content, with filters for
field, sender, recipient, date range, size, read state and sort order.</em>

<br><br>

<img src="assets/screenshots/homeassistant.svg" width="880" alt="Home Assistant screen with the MQTT broker, topics and the switches for discovery and commands, dark and light side by side">

<em>Home Assistant — enter the MQTT broker and you are done: the entities appear
through discovery, with the account in the topic.</em>

<br><br>

<img src="assets/screenshots/folders.svg" width="880" alt="Folder selection dialog with checkboxes, remembered selection and new folders highlighted, dark and light side by side">

<em>Folder selection — your choice is remembered, new folders are highlighted.</em>

<br><br>

<img src="assets/screenshots/setup.svg" width="880" alt="First run screen where the master password is chosen, dark and light side by side">

<em>First run — one master password encrypts every credential you enter later.</em>

<br><br>

<img src="assets/screenshots/account.svg" width="880" alt="Account dialog with server details and the advanced options expanded, dark and light side by side">

<em>Account setup — connection test, and everything that matters under “Advanced”:
batch size, pause between fetches, date filter and what happens to mail deleted
on the server.</em>

<br><br>

<img src="assets/screenshots/settings.svg" width="880" alt="Settings screen with archive folder, language, theme and accent colours, dark and light side by side">

<em>Settings — archive folder, language, light/dark, accent colour, and the way
to the Docker guide.</em>

</div>

## Features

- **IMAP over SSL/TLS, STARTTLS or plain**, with optional acceptance of
  self-signed certificates
- **Read-only by design** — no `\Seen` flags, no deletions, no `EXPUNGE`
- **Folder tree with checkboxes.** The selection is stored per account and
  shown again next time; folders that appeared since the last run are
  highlighted but stay unchecked
- **Special use folders recognised** (Sent, Drafts, Trash, Junk, Archive).
  Trash, Junk and Drafts start unchecked, everything else is pre-selected
- **Incremental backup.** Only new messages are downloaded, no matter how often
  you run it
- **Move detection.** A message you moved between folders on the server is
  moved locally instead of downloaded again — recognised before a single byte
  of the body is fetched
- **Deleted mail handled your way**: keep it, move it to `_deleted/`, or mirror
  the deletion. Optional automatic purge after N days
- **One `.eml` per message** — readable by Thunderbird, Apple Mail, Outlook and
  anything else that speaks RFC 5322
- **Self describing archive.** A per-folder journal lets the index be rebuilt
  from the files alone
- **Encrypted credentials.** One master password, scrypt + AES-256-GCM
- **German and English**, light/dark/system theme, five accent colours
- **Attachment export** as a separate pass over the archive: four layouts
  (folder tree, flat, year/month, one directory per message), filters for
  embedded images, minimum size and file type, de-duplication by content, and a
  CSV/JSON manifest that maps every file back to its message
- **Full text search** over subject, sender, body and attachment content —
  PDF, Word, Excel, PowerPoint and the files inside ZIP and TAR archives are
  read as well. German transliterations are indexed, so "muenchen" finds
  "München" and "strasse" finds "Straße"
- **Message viewer** that renders HTML in a sandboxed frame with external
  content blocked until you ask for it, downloads the .eml or single
  attachments, and hands the message to your mail client so you can reply
- **Export** of any search result as EML files in a ZIP, as an mbox for
  Thunderbird and Apple Mail, or as one PDF per message
- **AI access over MCP** with per-area switches, off by default
- **Restore** to the same account or to a different provider, with a folder
  mapping proposed from the special use markers. Only ever appends: messages
  that are already there are skipped by Message-ID
- **Docker container** with the same web interface, a built-in scheduler and
  Chromium for PDF export
- **Remote mode**: the desktop app can operate a container elsewhere, so the
  scheduled backups run on your server while you look at them from your desk
- **Optional archive encryption** with the master password, for an archive on
  a disk you do not fully control
- **Live progress** over a websocket, with a log you can actually read

## Install

Builds for all three desktop platforms come from the same source.

### macOS (Apple Silicon)

Download the DMG from the [releases](https://github.com/sphings79/mail-archiver/releases)
page, open it and drag the app into `Applications`.

The app is **not notarised** — there is no paid Apple developer account behind
this project. On first launch macOS refuses to open it. Right-click the app and
choose *Open*, then confirm. Alternatively:

```bash
xattr -dr com.apple.quarantine "/Applications/Mail Archiver.app"
```

### Windows

Run the `.exe` installer, or take the portable build if you would rather not
install anything. The build is unsigned, so SmartScreen shows a warning:
*More info* → *Run anyway*.

### Linux

Use the AppImage (make it executable and run it) or install the `.deb`:

```bash
sudo dpkg -i mail-archiver_1.0.0_amd64.deb
```

Both x64 and arm64 are built.

## Docker

> The image is built and tested; publishing to the registry happens with the
> first release.

The container runs the same engine and the same web interface as the desktop
app, plus a scheduler. Intended usage on unRAID, Synology or any Docker host:

```bash
docker run -d \
  --name mail-archiver \
  -p 8484:8484 \
  -v /mnt/user/appdata/mail-archiver:/config \
  -v /mnt/user/backup/mail:/archive \
  -e MAIL_ARCHIVER_MASTER_PASSWORD='your-master-password' \
  -e MAIL_ARCHIVER_UI_PASSWORD='password-for-the-web-interface' \
  -e MAIL_ARCHIVER_CRON='0 3 * * *' \
  -e TZ=Europe/Berlin \
  ghcr.io/sphings79/mail-archiver:latest
```

With Docker Compose:

```yaml
services:
  mail-archiver:
    image: ghcr.io/sphings79/mail-archiver:latest
    container_name: mail-archiver
    ports:
      - "8484:8484"
    volumes:
      - ./config:/config
      - /mnt/backup/mail:/archive
    environment:
      MAIL_ARCHIVER_MASTER_PASSWORD: your-master-password
      MAIL_ARCHIVER_UI_PASSWORD: password-for-the-web-interface
      MAIL_ARCHIVER_CRON: "0 3 * * *"
      TZ: Europe/Berlin
    restart: unless-stopped
```

| Variable | Meaning |
| --- | --- |
| `MAIL_ARCHIVER_MASTER_PASSWORD` | Unlocks the encrypted configuration on start |
| `MAIL_ARCHIVER_UI_PASSWORD` | Password for the web interface |
| `MAIL_ARCHIVER_CRON` | Schedule, standard cron expression |
| `MAIL_ARCHIVER_PORT` | Port inside the container, default 8484 |
| `MAIL_ARCHIVER_CRON_EXPORT_ATTACHMENTS` | Also export attachments after each scheduled run |
| `PUID` / `PGID` | User and group the volumes belong to, default 1000 |
| `MAIL_ARCHIVER_LOG_LEVEL` | `debug`, `info`, `warn` or `error` |
| `TZ` | Time zone the schedule follows |

The web interface answers on `http://<host>:8484`. It works behind a reverse
proxy, both on a subdomain and on a sub-path. Images are built for
`linux/amd64` and `linux/arm64`.

## AI access over MCP

Mail Archiver can expose the archive to an AI assistant through the Model
Context Protocol — searching, reading, and, if you allow it, operating the
application. It is **off by default**, and each permission group has its own
switch:

| Group | What it allows |
| --- | --- |
| Read | Search, open messages and attachments, statistics |
| Back up | Start and cancel backups and indexing |
| Export | Attachment export and export bundles |
| Accounts | Create accounts, change server details, set folder selection |
| Settings | Change application settings |
| Delete | Remove accounts, drop the index |

Passwords are never readable through MCP — they can only be set.

**Claude Desktop** (stdio transport):

```json
{
  "mcpServers": {
    "mail-archiver": {
      "command": "node",
      "args": ["/path/to/mail-archiver/packages/server/dist/mcp-stdio.js"],
      "env": { "MAIL_ARCHIVER_MASTER_PASSWORD": "your-master-password" }
    }
  }
}
```

**Over HTTP** (for the container or a remote client): switch it on in the
settings, copy the generated token and point the client at `POST /mcp` with
`Authorization: Bearer <token>`.

## OAuth for Gmail and Microsoft 365

Google and Microsoft no longer accept a password for IMAP. Mail Archiver can
sign in with a token instead, and it refreshes that token by itself, so a
nightly backup keeps running without anybody at the keyboard.

There is no shared client: a mailbox scope is as sensitive as a permission
gets, and neither provider hands one to an unverified application. Everyone
registers their own client once, under **Settings → OAuth clients**.

### Microsoft 365 and Outlook.com

1. Entra portal → **App registrations** → **New registration**
2. Under **Authentication**, add the platform **Mobile and desktop
   applications** and allow public client flows
3. Copy the **Application (client) ID** into the settings; leave the secret
   empty
4. In the account, pick **OAuth**, then **Get a code**: Mail Archiver shows a
   short code that you type in on any device

Microsoft supports the device flow, so nothing has to be reachable from
outside — this is the comfortable path for a container.

### Gmail

Google's device flow is documented for sign-in, Drive and YouTube only, so
Gmail has to go through a browser once:

1. Google Cloud console → new project → enable the **Gmail API**
2. **Credentials** → **OAuth client ID** → application type **Desktop**
3. Copy the client ID and secret into the settings
4. In the account, pick **OAuth** and **Sign in with a browser**

Where the browser lands afterwards depends on the redirect you choose:

| Redirect | Needs | How it feels |
| --- | --- | --- |
| Loopback, desktop app | nothing | fully automatic; the app catches the redirect |
| Loopback, container | nothing | the browser lands on a page that does not load — copy that address back into Mail Archiver |
| Public address | a reachable HTTPS address, registered as a **Web** client | the provider redirects straight back into the interface |

While the project is in testing mode, Google expires the refresh token after
seven days and you have to connect again. Publishing the project (still as
your own private client) removes that limit.

### More than one account at the same provider

One registered client covers as many mailboxes as you like — the client
identifies the application, not the person, and every account consents
separately and gets its own refresh token. Two things to watch:

- While the Google project is in testing mode, **every** Google account has to
  be listed under *Test users*, one by one.
- If you are signed into several accounts in the same browser, the consent
  screen asks which one. Mail Archiver preselects the address of the account
  you are connecting and logs in once right afterwards, so a token that ended
  up belonging to the wrong mailbox is caught immediately.

A mailbox that genuinely needs a client of its own — a Workspace tenant with
its own app registration, say — can use the **Other** provider slot with its
own endpoints.


## Home Assistant

Mail Archiver publishes the state of every account to an MQTT broker, so Home
Assistant can show when a mailbox was last backed up — and start a backup from
a button or an automation. Switch it on under **Home Assistant** in the
sidebar, enter the broker address, done: the entities are created through MQTT
discovery, nothing has to be written into `configuration.yaml`.

The account is part of the topic, so several mailboxes stay apart:

```
mailarchiver/status                       online / offline
mailarchiver/state                        totals and the next scheduled run
mailarchiver/account/<account>/state      one JSON document per mailbox
mailarchiver/account/<account>/set        backup | cancel
```

Per mailbox you get a device with four entities plus a button:

| Entity | Type |
| --- | --- |
| Messages | sensor |
| Archive size | sensor, `data_size` |
| Last backup | sensor, `timestamp` |
| Backup running | binary sensor, `running` |
| Back up now | button |

Commands are a separate switch. With **Accept commands** turned off the bridge
never subscribes and publishes no button, which makes the connection read only.

An example automation — a notification when a backup fails:

```yaml
automation:
  - alias: Mail backup failed
    triggers:
      - trigger: mqtt
        topic: mailarchiver/account/privat/state
        value_template: "{{ value_json.last_backup_status }}"
        payload: failed
    actions:
      - action: notify.mobile_app
        data:
          message: "The mail backup failed: {{ trigger.payload_json.last_error }}"
```

### Integration and Home Assistant App

Two companion projects go beyond MQTT:

| Project | What it is |
| --- | --- |
| [Mail Archiver Integration](https://github.com/sphings79/mail-archiver-home-assistant) | A native Home Assistant integration, installable through HACS. Talks to this instance directly, brings its own Lovelace card, needs no MQTT broker. |
| [Home Assistant App (Add-on)](https://github.com/sphings79/mail-archiver-ha-app) | Runs Mail Archiver as an add-on on Home Assistant OS. Appears in the sidebar through ingress, so it also works in the Home Assistant app on your phone. |

## On your phone

The web interface is installable. Open it in the browser of your phone and
choose **Add to home screen** — it then runs full screen with its own icon,
just like an app. Behind a reverse proxy with HTTPS this works from anywhere;
`http://` only counts as installable on localhost.

## Where things are stored

```
~/Mail Archive/                          base folder, one directory per account
└── you@example.com/
    ├── INBOX/
    │   ├── .mailarchiver.jsonl          metadata journal for this folder
    │   ├── 2024-01-15_143022_10432_Invoice-January.eml
    │   └── Projects/                    subfolders mirror the IMAP hierarchy
    ├── Sent/
    └── _deleted/                        messages that vanished from the server
        └── INBOX/…
```

- The file name carries the UTC timestamp, the IMAP UID and a shortened
  subject; the file modification time is set to the message date, so the
  archive sorts correctly in any file browser.
- `.mailarchiver.jsonl` records every add, flag change and removal. If the
  SQLite index is ever lost, the archive can be rebuilt from the files alone.
- Folder names keep their umlauts and are normalised to NFC, so the same
  mailbox produces the same paths on macOS, Windows and Linux.

## Security model

`config.enc` holds all IMAP credentials and never exists in plain text. A
master password is turned into a key with scrypt (N=65536, r=8, p=1) and the
file is sealed with AES-256-GCM. The same scheme is used inside the container,
where the master password comes from an environment variable.

The desktop app starts its HTTP server on `127.0.0.1` with a random port and a
random token that is only valid for that launch, so no other process on the
machine can talk to the API.

## Roadmap

| Stage | Content | Status |
| --- | --- | --- |
| 1 | Foundation, accounts, folder selection, incremental backup, desktop app | ✅ done |
| 2 | Attachment export with layouts, filters and de-duplication | ✅ done |
| 3 | Viewer, full text search, "open in mail client", export as mbox/PDF/ZIP, MCP server | ✅ done |
| 4 | Restore, and migration to a different server | ✅ done |
| 5 | Docker image, web login, cron schedule, remote mode | ✅ done |
| 6 | Polish: themes, translations, optional archive encryption, Windows and Linux releases | planned |

## FAQ

**Does it mark my mail as read?**
No. Folders are opened with `EXAMINE` (read-only) and bodies are fetched with
`BODY.PEEK[]`, which is the whole point of that IMAP command.

**Does it delete anything on the server?**
No. `\Deleted` is never set and `EXPUNGE` is never sent.

**What happens when I delete a mail on the server?**
Whatever you configured per account: keep the local copy, move it into
`_deleted/` (the default, with optional purge after N days), or delete it
locally as well.

**What if I move a mail into another folder?**
It is moved locally too. The match is made on a fingerprint built from
Message-ID, date, sender and size — all available before the body is
downloaded, so nothing is fetched twice.

**Can I read the backup without this program?**
Yes, that is the point of `.eml`. Double-click a file and your mail client
opens it. Thunderbird can import whole folders.

**Does it support POP3?**
No, deliberately. POP3 has no folders and often no stable message identity,
which makes a trustworthy incremental backup impossible.

**Does it support Gmail or Microsoft 365 with OAuth2?**
Not yet — app passwords work today, OAuth2 is planned.

**How big can a mailbox be?**
Messages are scanned and fetched in batches, and a run can be cancelled and
resumed. The design target is well beyond 100,000 messages.

**Is there a scheduler in the desktop app?**
No. The desktop app backs up on demand; automatic, scheduled runs are what the
Docker container is for.

## Development

Requirements: Node 22 or newer. Docker only for the local test server.

```bash
npm install
npm run build
npm run dev          # desktop app
npm run dev:server   # headless backend
npm run dev:web      # frontend with hot reload
npm test             # unit tests
```

### Local test mailbox

A Dovecot container with a deliberately awkward test mailbox (umlauts,
ampersands, nested folders, special use folders, a message with an attachment):

```bash
docker run -d --name mail-archiver-dovecot -p 127.0.0.1:11143:143 \
  -v "$PWD/dev/dovecot/dovecot.conf:/etc/dovecot/dovecot.conf:ro" \
  dovecot/dovecot:2.3.21
node dev/seed-testserver.mjs
```

Account: `127.0.0.1:11143`, no encryption, `test@example.com` / `testpass`.

```bash
node dev/test-sync.mjs        # full run, prints the resulting tree
node dev/test-behaviour.mjs   # checks peek, incremental, move and delete
node dev/test-attachments.mjs # checks layouts, filters, de-duplication, manifest
```

### Regenerating the artwork

The screenshots and the social preview are SVG files under `assets/`. GitHub
only accepts PNG for the social preview, so it is rendered with the Chromium
that ships with Electron:

```bash
npx electron dev/render-png.cjs assets/social-preview.svg assets/social-preview.png 1280 640
```

The application icon is generated without any image library:

```bash
python3 dev/make-icon.py packages/desktop/build/icon.png
```

### Project layout

| Package | Purpose |
| --- | --- |
| `packages/core` | IMAP, storage, SQLite index, encryption, sync engine |
| `packages/server` | Fastify REST API, websocket events, serves the frontend |
| `packages/web` | React frontend — identical in the app and in the container |
| `packages/desktop` | Electron shell, starts the server on localhost |
| `docker/` | Container image (stage 5) |

## Support the project

If Mail Archiver saves your mailbox one day, two things help a lot:

⭐ **[Star the repository](https://github.com/sphings79/mail-archiver)** —
the cheapest way to help other people find it.

☕ **[Buy me a coffee](https://buymeacoffee.com/sphings)** — development
happens in evenings and weekends.

Bug reports and feature requests are welcome in the
[issues](https://github.com/sphings79/mail-archiver/issues).

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).

---

<div align="center">
<sub>Keywords: IMAP backup · email backup · mail archiving · self-hosted ·
eml · mbox · Docker · unRAID · homelab · macOS · Windows · Linux ·
imap-backup alternative · mailbox export</sub>
</div>
