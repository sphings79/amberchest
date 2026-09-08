<div align="center">

<img src="assets/icon.svg" width="96" height="96" alt="Mail Archiver Logo">

# Mail Archiver — The Mail Backup Solution

**IMAP-Postfächer als einfache `.eml`-Dateien sichern, die dir gehören.**
Selbst gehostete E-Mail-Archivierung für macOS, Windows, Linux und Docker —
schreibgeschützt, inkrementell, mit dem Ordnerbaum deines Postfachs.

[![Lizenz: AGPL v3](https://img.shields.io/badge/lizenz-AGPL--3.0-7c5cff?style=flat-square)](LICENSE)
[![Plattformen](https://img.shields.io/badge/plattformen-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Docker-2b3040?style=flat-square)](#installation)
[![Mit TypeScript gebaut](https://img.shields.io/badge/gebaut%20mit-TypeScript-3178c6?style=flat-square)](https://www.typescriptlang.org/)
[![Sterne](https://img.shields.io/github/stars/sphings79/mail-archiver?style=flat-square&color=f0b429)](https://github.com/sphings79/mail-archiver/stargazers)

[English version](README.md) · [Funktionen](#funktionen) · [Installation](#installation) · [Docker](#docker) · [FAQ](#faq)

</div>

---

## Warum noch ein IMAP-Backup?

Dein Anbieter kann deine Mails verlieren. Ein Konto kann gesperrt werden, ein
Passwort gestohlen, eine Synchronisation schiefgehen. Eine Sicherung auf der
eigenen Platte, in einem Format, das jedes Mailprogramm lesen kann, ist die
einzige Kopie, die wirklich dir gehört.

Mail Archiver lädt dein Postfach herunter und lässt es exakt so zurück, wie es
war: **auf dem Server wird nichts gelöscht und nichts als gelesen markiert.**
Ordner werden schreibgeschützt geöffnet, Nachrichten mit `BODY.PEEK` abgeholt —
genau dem IMAP-Befehl, den es dafür gibt, eine Mail zu lesen, ohne ihr
`\Seen`-Flag anzufassen.

> **Alle sechs Etappen sind fertig.** Sicherung, Anhang-Export, Suche, Viewer,
> Export, MCP, Rückspielen, der Container und die Fernsteuerung laufen.

## Bildschirmfotos

<div align="center">

<img src="assets/screenshots/overview-dark.svg" width="880" alt="Übersicht mit Gesamtzahlen, Kontostatus und den letzten Sicherungen">

<em>Übersicht — wie viel gesichert ist, was gerade läuft, was letzte Nacht passiert ist.</em>

<br><br>

<img src="assets/screenshots/folders-dark.svg" width="880" alt="Ordnerauswahl mit Checkboxen, gemerkter Auswahl und hervorgehobenen neuen Ordnern">

<em>Ordnerauswahl — deine Auswahl wird gemerkt, neue Ordner werden hervorgehoben.</em>

<br><br>

<img src="assets/screenshots/setup-dark.svg" width="880" alt="Erster Start mit der Wahl des Master-Passworts">

<em>Erster Start — ein Master-Passwort verschlüsselt alle Zugangsdaten, die später dazukommen.</em>

<br><br>

<img src="assets/screenshots/account-dark.svg" width="880" alt="Kontodialog mit Serverdaten und ausgeklappten erweiterten Einstellungen">

<em>Konto einrichten — Verbindungstest, und unter „Erweitert“ alles Wichtige:
Stapelgröße, Pause zwischen Abrufen, Datumsfilter und der Umgang mit
serverseitig gelöschten Mails.</em>

<br><br>

<img src="assets/screenshots/settings-dark.svg" width="880" alt="Einstellungen mit Archivordner, Sprache, Erscheinungsbild und Akzentfarben">

<em>Einstellungen — Archivordner, Sprache, hell/dunkel, Akzentfarbe und der Weg
zur Docker-Anleitung.</em>

</div>

## Funktionen

- **IMAP über SSL/TLS, STARTTLS oder unverschlüsselt**, auf Wunsch mit
  Akzeptanz selbstsignierter Zertifikate
- **Von Grund auf schreibgeschützt** — keine `\Seen`-Flags, kein Löschen, kein
  `EXPUNGE`
- **Ordnerbaum mit Checkboxen.** Die Auswahl wird pro Konto gespeichert und
  beim nächsten Mal wieder angezeigt; seit dem letzten Lauf neu aufgetauchte
  Ordner werden hervorgehoben, aber nicht vorausgewählt
- **Sonderordner werden erkannt** (Gesendet, Entwürfe, Papierkorb, Spam,
  Archiv). Papierkorb, Spam und Entwürfe sind zunächst abgewählt, alles andere
  ist vorausgewählt
- **Inkrementelle Sicherung.** Es werden nur neue Nachrichten geladen, egal wie
  oft du sicherst
- **Verschiebungen werden erkannt.** Eine Mail, die du auf dem Server in einen
  anderen Ordner verschiebst, wird lokal ebenfalls verschoben statt neu geladen
  — erkannt, bevor auch nur ein Byte des Inhalts abgerufen wird
- **Gelöschte Mails nach deinen Regeln**: behalten, nach `_deleted/`
  verschieben oder lokal ebenfalls löschen. Auf Wunsch automatisch nach N Tagen
  endgültig entfernen
- **Eine `.eml` pro Nachricht** — lesbar mit Thunderbird, Apple Mail, Outlook
  und allem anderen, was RFC 5322 versteht
- **Selbsttragendes Archiv.** Ein Journal je Ordner erlaubt es, den Index
  allein aus den Dateien wieder aufzubauen
- **Verschlüsselte Zugangsdaten.** Ein Master-Passwort, scrypt + AES-256-GCM
- **Deutsch und Englisch**, hell/dunkel/System, fünf Akzentfarben
- **Anhang-Export** als eigener Durchlauf über das Archiv: vier Ablagen
  (Ordnerbaum, flach, Jahr/Monat, ein Ordner pro Mail), Filter für eingebettete
  Bilder, Mindestgröße und Dateityp, Doppelerkennung über den Inhalt und eine
  CSV/JSON-Zuordnungsdatei, die jede Datei ihrer Mail zuordnet
- **Volltextsuche** über Betreff, Absender, Text und Anhangsinhalte — PDF,
  Word, Excel, PowerPoint sowie die Dateien in ZIP- und TAR-Archiven werden
  mitgelesen. Deutsche Umschreibungen stehen im Index, „muenchen“ findet also
  „München“ und „strasse“ findet „Straße“
- **Mail-Ansicht**, die HTML in einem abgeschotteten Rahmen darstellt und
  externe Inhalte erst auf Nachfrage lädt, die `.eml` oder einzelne Anhänge
  herunterlädt und die Nachricht ans Mailprogramm übergibt, damit du antworten
  kannst
- **Export** jeder Trefferliste als EML-Dateien im ZIP, als mbox für
  Thunderbird und Apple Mail oder als PDF je Nachricht
- **KI-Zugriff über MCP** mit Schaltern je Bereich, standardmäßig aus
- **Rückspielen** auf dasselbe Konto oder zu einem anderen Anbieter, mit einer
  Ordnerzuordnung, die aus den Sonderordner-Markern vorgeschlagen wird. Es wird
  ausschließlich hinzugefügt; bereits vorhandene Mails werden über die
  Message-ID übersprungen
- **Docker-Container** mit derselben Weboberfläche, eingebautem Zeitplaner und
  Chromium für den PDF-Export
- **Fernsteuerung**: Die Desktop-App kann einen Container woanders bedienen —
  die geplanten Sicherungen laufen auf dem Server, angeschaut wird vom
  Schreibtisch aus
- **Optionale Archivverschlüsselung** mit dem Master-Passwort, für ein Archiv
  auf einer Platte, die dir nicht allein gehört
- **Live-Fortschritt** über WebSocket, mit einem lesbaren Protokoll

## Installation

Alle drei Desktop-Plattformen entstehen aus derselben Quelle.

### macOS (Apple Silicon)

Das DMG von der [Releases-Seite](https://github.com/sphings79/mail-archiver/releases)
laden, öffnen und die App nach `Programme` ziehen.

Die App ist **nicht notarisiert** — hinter diesem Projekt steht kein bezahltes
Apple-Entwicklerkonto. Beim ersten Start verweigert macOS das Öffnen.
Rechtsklick auf die App → *Öffnen* → bestätigen. Alternativ:

```bash
xattr -dr com.apple.quarantine "/Applications/Mail Archiver.app"
```

### Windows

Den `.exe`-Installer ausführen, oder die portable Variante nehmen, wenn du
nichts installieren möchtest. Der Build ist unsigniert, SmartScreen zeigt daher
eine Warnung: *Weitere Informationen* → *Trotzdem ausführen*.

### Linux

AppImage ausführbar machen und starten, oder das `.deb` installieren:

```bash
sudo dpkg -i mail-archiver_1.0.0_amd64.deb
```

Es werden x64 und arm64 gebaut.

## Docker

> Das Image ist gebaut und getestet; veröffentlicht wird es mit dem ersten
> Release.

Der Container fährt dieselbe Maschinerie und dieselbe Weboberfläche wie die
Desktop-App, dazu einen Zeitplaner. Vorgesehene Nutzung auf unRAID, Synology
oder jedem anderen Docker-Host:

```bash
docker run -d \
  --name mail-archiver \
  -p 8484:8484 \
  -v /mnt/user/appdata/mail-archiver:/config \
  -v /mnt/user/backup/mail:/archive \
  -e MAIL_ARCHIVER_MASTER_PASSWORD='dein-master-passwort' \
  -e MAIL_ARCHIVER_UI_PASSWORD='passwort-für-die-weboberfläche' \
  -e MAIL_ARCHIVER_CRON='0 3 * * *' \
  -e TZ=Europe/Berlin \
  ghcr.io/sphings79/mail-archiver:latest
```

Mit Docker Compose:

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
      MAIL_ARCHIVER_MASTER_PASSWORD: dein-master-passwort
      MAIL_ARCHIVER_UI_PASSWORD: passwort-für-die-weboberfläche
      MAIL_ARCHIVER_CRON: "0 3 * * *"
      TZ: Europe/Berlin
    restart: unless-stopped
```

| Variable | Bedeutung |
| --- | --- |
| `MAIL_ARCHIVER_MASTER_PASSWORD` | Entsperrt beim Start die verschlüsselte Konfiguration |
| `MAIL_ARCHIVER_UI_PASSWORD` | Passwort für die Weboberfläche |
| `MAIL_ARCHIVER_CRON` | Zeitplan als gewöhnlicher Cron-Ausdruck |
| `MAIL_ARCHIVER_PORT` | Port im Container, Standard 8484 |
| `MAIL_ARCHIVER_CRON_EXPORT_ATTACHMENTS` | Nach jedem Lauf auch Anhänge exportieren |
| `PUID` / `PGID` | Benutzer und Gruppe, denen die Volumes gehören, Standard 1000 |
| `MAIL_ARCHIVER_LOG_LEVEL` | `debug`, `info`, `warn` oder `error` |
| `TZ` | Zeitzone, nach der sich der Zeitplan richtet |

Die Weboberfläche antwortet dann auf `http://<host>:8484`. Sie funktioniert
hinter einem Reverse Proxy, sowohl auf einer Subdomain als auch auf einem
Unterpfad. Images entstehen für `linux/amd64` und `linux/arm64`.

## KI-Zugriff über MCP

Mail Archiver kann das Archiv über das Model Context Protocol für eine KI
öffnen — zum Suchen, Lesen und, wenn du es erlaubst, zum Bedienen. Das ist
**standardmäßig aus**, und jede Berechtigungsgruppe hat ihren eigenen Schalter:

| Gruppe | Was sie erlaubt |
| --- | --- |
| Lesen | Suchen, Nachrichten und Anhänge öffnen, Statistiken |
| Sichern | Sicherung und Indizierung starten und abbrechen |
| Exportieren | Anhang-Export und Export-Pakete |
| Konten | Konten anlegen, Serverdaten ändern, Ordnerauswahl setzen |
| Einstellungen | Anwendungseinstellungen ändern |
| Löschen | Konten entfernen, Index verwerfen |

Passwörter sind über MCP nie lesbar — sie lassen sich nur setzen.

**Claude Desktop** (stdio):

```json
{
  "mcpServers": {
    "mail-archiver": {
      "command": "node",
      "args": ["/pfad/zu/mail-archiver/packages/server/dist/mcp-stdio.js"],
      "env": { "MAIL_ARCHIVER_MASTER_PASSWORD": "dein-master-passwort" }
    }
  }
}
```

**Über HTTP** (für den Container oder entfernte Clients): in den Einstellungen
einschalten, den erzeugten Token kopieren und den Client auf `POST /mcp` mit
`Authorization: Bearer <token>` zeigen lassen.

## Wo die Daten liegen

```
~/Mail Archive/                          Basisordner, ein Verzeichnis je Konto
└── du@example.com/
    ├── INBOX/
    │   ├── .mailarchiver.jsonl          Metadaten-Journal dieses Ordners
    │   ├── 2024-01-15_143022_10432_Rechnung-Januar.eml
    │   └── Projekte/                    Unterordner spiegeln die IMAP-Hierarchie
    ├── Gesendet/
    └── _deleted/                        Mails, die vom Server verschwunden sind
        └── INBOX/…
```

- Der Dateiname trägt den UTC-Zeitstempel, die IMAP-UID und einen gekürzten
  Betreff; das Änderungsdatum der Datei wird auf das Datum der Mail gesetzt,
  damit das Archiv in jedem Dateibrowser richtig sortiert.
- `.mailarchiver.jsonl` protokolliert jedes Hinzufügen, jede Flag-Änderung und
  jedes Entfernen. Geht die SQLite-Datenbank verloren, lässt sich das Archiv
  allein aus den Dateien wieder aufbauen.
- Ordnernamen behalten ihre Umlaute und werden auf NFC normalisiert, damit
  dasselbe Postfach auf macOS, Windows und Linux dieselben Pfade ergibt.

## Sicherheitsmodell

`config.enc` enthält sämtliche IMAP-Zugangsdaten und existiert niemals im
Klartext. Aus einem Master-Passwort wird mit scrypt (N=65536, r=8, p=1) ein
Schlüssel abgeleitet, die Datei mit AES-256-GCM versiegelt. Im Container gilt
dasselbe Verfahren, dort kommt das Master-Passwort aus einer
Umgebungsvariablen.

Die Desktop-App startet ihren HTTP-Server auf `127.0.0.1` mit zufälligem Port
und einem Token, das nur für diesen Programmstart gilt. Kein anderer Prozess
auf dem Rechner kann die Schnittstelle ansprechen.

## Fahrplan

| Etappe | Inhalt | Stand |
| --- | --- | --- |
| 1 | Fundament, Konten, Ordnerauswahl, inkrementelle Sicherung, Desktop-App | ✅ fertig |
| 2 | Anhang-Export mit Layouts, Filtern und Doppelerkennung | ✅ fertig |
| 3 | Viewer, Volltextsuche, „im Mailprogramm öffnen“, Export als mbox/PDF/ZIP, MCP-Server | ✅ fertig |
| 4 | Rückspielen und Umzug auf einen anderen Server | ✅ fertig |
| 5 | Docker-Image, Web-Login, Cron-Zeitplan, Fernsteuerung | ✅ fertig |
| 6 | Feinschliff: optionale Archivverschlüsselung, Update-Hinweis, Windows- und Linux-Builds | ✅ fertig |

## FAQ

**Markiert das Programm meine Mails als gelesen?**
Nein. Ordner werden mit `EXAMINE` (schreibgeschützt) geöffnet und Inhalte mit
`BODY.PEEK[]` geholt — genau dafür gibt es diesen IMAP-Befehl.

**Löscht es etwas auf dem Server?**
Nein. `\Deleted` wird nie gesetzt, `EXPUNGE` nie gesendet.

**Was passiert, wenn ich eine Mail auf dem Server lösche?**
Was du pro Konto eingestellt hast: lokale Kopie behalten, nach `_deleted/`
verschieben (Standard, auf Wunsch mit automatischem Leeren nach N Tagen) oder
lokal ebenfalls löschen.

**Und wenn ich eine Mail in einen anderen Ordner verschiebe?**
Sie wird lokal ebenfalls verschoben. Die Zuordnung läuft über einen
Fingerabdruck aus Message-ID, Datum, Absender und Größe — alles vorhanden,
bevor der Inhalt geladen wird, es wird also nichts doppelt heruntergeladen.

**Kann ich die Sicherung ohne dieses Programm lesen?**
Ja, genau dafür ist `.eml` da. Doppelklick, und dein Mailprogramm öffnet die
Nachricht. Thunderbird kann ganze Ordner importieren.

**Unterstützt es POP3?**
Nein, bewusst nicht. POP3 kennt keine Ordner und oft keine stabile
Nachrichten-Identität — eine verlässliche inkrementelle Sicherung ist damit
nicht möglich.

**Unterstützt es Gmail oder Microsoft 365 mit OAuth2?**
Noch nicht — App-Passwörter funktionieren heute, OAuth2 ist geplant.

**Wie groß darf ein Postfach sein?**
Nachrichten werden stapelweise geprüft und geladen, ein Lauf lässt sich
abbrechen und später fortsetzen. Ausgelegt ist das Ganze auf deutlich mehr als
100.000 Nachrichten.

**Gibt es einen Zeitplan in der Desktop-App?**
Nein. Die Desktop-App sichert auf Knopfdruck; für automatische, regelmäßige
Läufe gibt es den Docker-Container.

## Entwicklung

Voraussetzung: Node 22 oder neuer. Docker nur für den lokalen Testserver.

```bash
npm install
npm run build
npm run dev          # Desktop-App
npm run dev:server   # Backend ohne Oberfläche
npm run dev:web      # Frontend mit Hot Reload
npm test             # Unit-Tests
```

### Lokales Testpostfach

Ein Dovecot-Container mit einem absichtlich unangenehmen Testpostfach
(Umlaute, Kaufmanns-Und, verschachtelte Ordner, Sonderordner, eine Mail mit
Anhang):

```bash
docker run -d --name mail-archiver-dovecot -p 127.0.0.1:11143:143 \
  -v "$PWD/dev/dovecot/dovecot.conf:/etc/dovecot/dovecot.conf:ro" \
  dovecot/dovecot:2.3.21
node dev/seed-testserver.mjs
```

Zugang: `127.0.0.1:11143`, keine Verschlüsselung, `test@example.com` /
`testpass`.

```bash
node dev/test-sync.mjs        # kompletter Lauf, gibt den entstandenen Baum aus
node dev/test-behaviour.mjs   # prüft Peek, Inkrementell, Verschieben, Löschen
node dev/test-attachments.mjs # prüft Ablagen, Filter, Doppelerkennung, Manifest
```

### Grafiken neu erzeugen

Die Bildschirmfotos und die Social Preview liegen als SVG unter `assets/`. Für
die Social Preview akzeptiert GitHub nur PNG, deshalb wird sie mit dem
Chromium aus Electron gerendert:

```bash
npx electron dev/render-png.cjs assets/social-preview.svg assets/social-preview.png 1280 640
```

Das App-Symbol entsteht ganz ohne Bildbibliothek:

```bash
python3 dev/make-icon.py packages/desktop/build/icon.png
```

### Aufbau des Projekts

| Paket | Zweck |
| --- | --- |
| `packages/core` | IMAP, Ablage, SQLite-Index, Verschlüsselung, Sync-Maschine |
| `packages/server` | Fastify-REST-API, WebSocket-Ereignisse, liefert das Frontend aus |
| `packages/web` | React-Frontend — in App und Container identisch |
| `packages/desktop` | Electron-Hülle, startet den Server auf localhost |
| `docker/` | Container-Image (Etappe 5) |

## Das Projekt unterstützen

Wenn Mail Archiver eines Tages dein Postfach rettet, helfen zwei Dinge sehr:

⭐ **[Dem Repository einen Stern geben](https://github.com/sphings79/mail-archiver)** —
die billigste Art, anderen beim Finden zu helfen.

☕ **[Einen Kaffee spendieren](https://github.com/sponsors/sphings79)** —
entwickelt wird an Abenden und Wochenenden.

Fehlermeldungen und Wünsche gern in den
[Issues](https://github.com/sphings79/mail-archiver/issues).

## Lizenz

AGPL-3.0-or-later, siehe [LICENSE](LICENSE).

---

<div align="center">
<sub>Schlagwörter: IMAP-Backup · E-Mail-Sicherung · Mail-Archivierung ·
selbst gehostet · eml · mbox · Docker · unRAID · Homelab · macOS · Windows ·
Linux · Postfach exportieren</sub>
</div>
