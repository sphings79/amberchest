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

[English version](README.md) · [Funktionen](#funktionen) · [Installation](#installation) · [Docker](#docker) · [OAuth](#oauth-für-gmail-und-microsoft-365) · [Home Assistant](#home-assistant) · [FAQ](#faq)

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

<em>Jedes Bild zeigt beide Erscheinungsbilder: links dunkel, rechts hell, entlang eines Risses getrennt.</em>

<br><br>

<img src="assets/screenshots/overview.svg" width="880" alt="Übersicht mit Gesamtzahlen, Kontostatus und den letzten Sicherungen, dunkel und hell nebeneinander">

<em>Übersicht — wie viel gesichert ist, was gerade läuft, was letzte Nacht passiert ist.</em>

<br><br>

<img src="assets/screenshots/browser.svg" width="880" alt="Postfach-Browser mit Konten und Ordnerbaum links und der Nachrichtenliste rechts, dunkel und hell nebeneinander">

<em>Postfach — links Konten und Ordner wie im Explorer, rechts die Mails des gewählten Ordners.</em>

<br><br>

<img src="assets/screenshots/search.svg" width="880" alt="Suche mit geöffneten Filtern für Feld, Absender, Empfänger, Datum, Größe und Sortierung, dunkel und hell nebeneinander">

<em>Suche — Volltext über Betreff, Text und Anhangsinhalte, mit Filtern für Feld,
Absender, Empfänger, Zeitraum, Größe, Lesestatus und Sortierung.</em>

<br><br>

<img src="assets/screenshots/homeassistant.svg" width="880" alt="Home-Assistant-Seite mit MQTT-Broker, Topics und Schaltern für Discovery und Befehle, dunkel und hell nebeneinander">

<em>Home Assistant — MQTT-Broker eintragen, fertig: die Entitäten entstehen per
Discovery, das Konto steckt im Topic.</em>

<br><br>

<img src="assets/screenshots/folders.svg" width="880" alt="Ordnerauswahl mit Checkboxen, gemerkter Auswahl und hervorgehobenen neuen Ordnern, dunkel und hell nebeneinander">

<em>Ordnerauswahl — deine Auswahl wird gemerkt, neue Ordner werden hervorgehoben.</em>

<br><br>

<img src="assets/screenshots/setup.svg" width="880" alt="Erster Start mit der Wahl des Master-Passworts, dunkel und hell nebeneinander">

<em>Erster Start — ein Master-Passwort verschlüsselt alle Zugangsdaten, die später dazukommen.</em>

<br><br>

<img src="assets/screenshots/account.svg" width="880" alt="Kontodialog mit Serverdaten und ausgeklappten erweiterten Einstellungen, dunkel und hell nebeneinander">

<em>Konto einrichten — Verbindungstest, und unter „Erweitert“ alles Wichtige:
Stapelgröße, Pause zwischen Abrufen, Datumsfilter und der Umgang mit
serverseitig gelöschten Mails.</em>

<br><br>

<img src="assets/screenshots/settings.svg" width="880" alt="Einstellungen mit Archivordner, Sprache, Erscheinungsbild und Akzentfarben, dunkel und hell nebeneinander">

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

## Speicherplatz und Benachrichtigungen

Zwei Dinge braucht eine Sicherung, die unbeaufsichtigt läuft: Platz, und
jemanden, dem sie Bescheid sagen kann, wenn keiner mehr da ist.

**Der freie Platz** steht in den Einstellungen, für das Laufwerk, auf dem das
Archiv liegt. Dazu zwei Grenzen: eine, ab der gewarnt wird, und eine, ab der
eine laufende Sicherung **anhält**, statt die Platte vollzuschreiben. Anhalten
hinterlässt ein vollständiges Archiv, dem die neuesten Mails fehlen — eine
volle Platte hinterlässt ein System, das nicht einmal mehr ein Protokoll
schreiben kann.

**Benachrichtigungen** gehen an jede Adresse, die einen POST annimmt: ntfy,
Gotify, Discord, Apprise oder etwas Selbstgebautes.

| Ereignis | Voreinstellung |
| --- | --- |
| Eine Sicherung ist fehlgeschlagen | an |
| Eine Sicherung ist durchgelaufen | aus |
| Eine Archivprüfung hat etwas gefunden | an |
| Der Speicherplatz wird knapp | an |

Format auswählen, Adresse eintragen, Testknopf drücken. Für Dienste, die einen
Token wollen, gibt es ein Feld für einen zusätzlichen Header.

```json
{
  "event": "backupFailed",
  "level": "error",
  "title": "Mail Archiver: backup of Privat failed",
  "message": "Connection refused - check host and port",
  "text": "…",
  "at": "2026-09-09T02:00:11.000Z",
  "details": { "account": "Privat", "stats": { … } }
}
```

## Ein Archiv umziehen

Ein Archiv, das auf dem Desktop angefangen hat, gehört irgendwann auf den
Server — und nach einer verlorenen Index-Datenbank sind die Dateien ja noch
alle da. **Umziehen** schickt das Archiv eines Kontos an eine andere Instanz,
die ihren Index aus dem Ankommenden neu aufbaut.

1. Auf der Zielinstanz das Konto anlegen, mit derselben Adresse
2. Beim Quellkonto auf **Umziehen**, Adresse und Oberflächen-Passwort des Ziels
   eintragen
3. Zielkonto auswählen und starten

Es wandern die Dateien, nicht der Index: jeder Ordner führt ein Journal, und
die Gegenstelle baut daraus ihren Index. Ein abgebrochener Umzug ist deshalb
harmlos — beim nächsten Anlauf geht nur, was noch fehlt, verglichen über Name
und Größe.

Jede Nachricht behält ihre UID, die erste Sicherung auf der neuen Maschine lädt
also **nichts** herunter. Eine Datei, deren Journaleintrag fehlt, wird
stattdessen gelesen und bekommt UIDVALIDITY null — die nächste Sicherung ordnet
sie dann über den Fingerabdruck zu, denselben Weg wie bei einer echten
UIDVALIDITY-Änderung, und lädt ebenfalls nichts.

**Auf der Quelle wird nichts gelöscht.** Prüfe das Archiv drüben und lass dort
einmal sichern; erst wenn beides passt, kommt die alte Kopie weg — von Hand.

Zwei Dinge, die man wissen sollte:

- Ein **verschlüsseltes Archiv** wandert, wie es ist. Die Gegenstelle kann es
  nur mit demselben Master-Passwort lesen.
- Der empfangende Endpunkt nimmt ausschließlich relative Pfade an, die auf
  `.eml` oder den Journalnamen enden, unterhalb des Kontoverzeichnisses. Alles
  andere wird abgewiesen.

Dieselbe Übernahme läuft auch allein: `POST /api/accounts/<id>/adopt` nimmt ein
Archivverzeichnis in Betrieb, das schon da liegt — so wird eine verlorene
Index-Datenbank wieder aufgebaut.

## Das Archiv prüfen

Ein Backup, das nie geprüft wird, ist eine Hoffnung und keine Sicherung.
**Prüfen** liest bei einem Konto jede gesicherte Datei und vergleicht sie mit
der Prüfsumme vom Tag des Herunterladens. Ein Bit, das auf der Platte gekippt
ist, eine gelöschte Datei und eine Datei, die zu nichts mehr gehört, tauchen
damit namentlich auf.

| Befund | Was er bedeutet |
| --- | --- |
| Datei fehlt | Der Index kennt die Nachricht, die Datei ist weg |
| Inhalt verändert | Die Datei entspricht nicht mehr dem, was vom Server kam |
| Nicht lesbar | Beschädigt, oder mit einem anderen Master-Passwort verschlüsselt |
| Nicht im Index | Eine Nachrichtendatei, auf die nichts mehr zeigt |
| Anzahl weicht ab | Der Ordner hat eine andere Anzahl Nachrichten als auf dem Server |

**Mit dem Server abgleichen** beantwortet die Frage, die man wirklich hat: fehlt
etwas? Dafür wird je gesichertem Ordner die Anzahl vom Server geholt und neben
die lokale gestellt. Ein `STATUS` pro Ordner, keine Nachrichteninhalte.

Es wird nichts ins Archiv geschrieben und nichts gelöscht. Die einzige Änderung
ist eine Prüfsumme, die für Nachrichten nachgetragen wird, die vor dieser
Funktion gesichert wurden — der erste Lauf nach dem Update schreibt sie, jeder
weitere vergleicht dagegen.

Für die KI-Anbindung gibt es dasselbe als Werkzeug `verify_archive`, in der
Rechtegruppe **Sichern**.

## OAuth für Gmail und Microsoft 365

Google und Microsoft nehmen für IMAP kein Passwort mehr an. Mail Archiver meldet
sich stattdessen mit einem Token an und erneuert es selbst — die nächtliche
Sicherung läuft also weiter, ohne dass jemand am Rechner sitzt.

Einen gemeinsamen Client gibt es nicht: Postfach-Zugriff ist mit die
weitreichendste Berechtigung, die es gibt, und keiner der beiden Anbieter gibt
sie einer nicht verifizierten Anwendung. Jeder legt deshalb einmal seinen
eigenen Client an, unter **Einstellungen → OAuth-Zugänge**.

### Microsoft 365 und Outlook.com

1. Entra-Portal → **App-Registrierungen** → **Neue Registrierung**
2. Unter **Authentifizierung** die Plattform **Mobile Geräte und
   Desktopanwendungen** hinzufügen und öffentliche Clientflows erlauben
3. Die **Anwendungs-ID (Client)** in die Einstellungen kopieren, Secret leer
   lassen
4. Im Konto **OAuth** wählen und auf **Code anfordern** klicken: Mail Archiver
   zeigt einen kurzen Code, den du auf einem beliebigen Gerät eingibst

Microsoft unterstützt den Device-Flow — es muss also nichts von außen
erreichbar sein. Das ist der bequeme Weg für einen Container.

### Gmail

Googles Device-Flow ist ausschließlich für Anmeldung, Drive und YouTube
freigegeben, Gmail muss deshalb einmal durch den Browser:

1. Google Cloud Console → neues Projekt → **Gmail-API** aktivieren
2. **Anmeldedaten** → **OAuth-Client-ID** → Anwendungstyp **Desktop**
3. Client-ID und Secret in die Einstellungen kopieren
4. Im Konto **OAuth** wählen und **Im Browser anmelden**

Wo der Browser danach landet, hängt von der gewählten Rückleitung ab:

| Rückleitung | Braucht | Wie es sich anfühlt |
| --- | --- | --- |
| Loopback, Desktop-App | nichts | vollautomatisch, die App fängt die Rückleitung selbst auf |
| Loopback, Container | nichts | der Browser landet auf einer Seite, die nicht lädt — diese Adresse zurück in Mail Archiver kopieren |
| Eigene Adresse | erreichbare HTTPS-Adresse, als **Web**-Client registriert | der Anbieter leitet direkt in die Oberfläche zurück |

Solange das Google-Projekt im Testmodus ist, verfällt der Refresh-Token nach
sieben Tagen und du musst neu verbinden. Das Veröffentlichen des Projekts —
weiterhin als dein eigener, privater Client — hebt die Grenze auf.

### Mehrere Konten beim selben Anbieter

Ein registrierter Client deckt beliebig viele Postfächer ab — er identifiziert
die Anwendung, nicht die Person. Jedes Konto stimmt einzeln zu und bekommt
seinen eigenen Refresh-Token. Zwei Dinge sind dabei zu beachten:

- Solange das Google-Projekt im Testmodus läuft, muss **jedes** Google-Konto
  einzeln unter *Testnutzer* eingetragen sein.
- Wer in mehreren Konten gleichzeitig angemeldet ist, wird auf dem
  Zustimmungsbildschirm gefragt, welches es sein soll. Mail Archiver wählt die
  Adresse des Kontos vor, um das es geht, und meldet sich direkt danach einmal
  an — ein Token, der zum falschen Postfach gehört, fällt damit sofort auf und
  nicht erst nachts um drei.

Ein Postfach, das wirklich einen eigenen Client braucht — etwa ein
Workspace-Tenant mit eigener App-Registrierung —, kann den Anbieter-Platz
**Anderer** mit eigenen Endpunkten benutzen.


## Home Assistant

Mail Archiver veröffentlicht den Zustand jedes Kontos auf einem MQTT-Broker.
Home Assistant zeigt damit, wann ein Postfach zuletzt gesichert wurde, und kann
eine Sicherung per Knopf oder Automatisierung starten. Einschalten unter
**Home Assistant** in der Seitenleiste, Broker eintragen, fertig: die
Entitäten entstehen per MQTT-Discovery, in der `configuration.yaml` ist nichts
nötig.

Das Konto steckt im Topic, damit mehrere Postfächer sauber getrennt bleiben:

```
mailarchiver/status                       online / offline
mailarchiver/state                        Summen und der nächste geplante Lauf
mailarchiver/account/<konto>/state        ein JSON-Dokument je Postfach
mailarchiver/account/<konto>/set          backup | cancel
```

Je Postfach entsteht ein Gerät mit vier Entitäten und einem Knopf:

| Entität | Typ |
| --- | --- |
| Nachrichten | Sensor |
| Archivgröße | Sensor, `data_size` |
| Letzte Sicherung | Sensor, `timestamp` |
| Sicherung läuft | Binärsensor, `running` |
| Jetzt sichern | Knopf |

Befehle haben einen eigenen Schalter. Mit ausgeschaltetem **Befehle annehmen**
abonniert die Anbindung nichts und veröffentlicht keinen Knopf — die Verbindung
ist dann nur lesend.

Eine Beispielautomatisierung, die bei einer fehlgeschlagenen Sicherung meldet:

```yaml
automation:
  - alias: Mail-Sicherung fehlgeschlagen
    triggers:
      - trigger: mqtt
        topic: mailarchiver/account/privat/state
        value_template: "{{ value_json.last_backup_status }}"
        payload: failed
    actions:
      - action: notify.mobile_app
        data:
          message: "Die Mail-Sicherung ist fehlgeschlagen: {{ trigger.payload_json.last_error }}"
```

### Integration und Home Assistant App

Zwei Begleitprojekte gehen über MQTT hinaus:

| Projekt | Was es ist |
| --- | --- |
| [Mail Archiver Integration](https://github.com/sphings79/mail-archiver-home-assistant) | Eine echte Home-Assistant-Integration, installierbar über HACS. Spricht direkt mit dieser Instanz, bringt eine eigene Lovelace-Karte mit und braucht keinen MQTT-Broker. |
| [Home Assistant App (Addon)](https://github.com/sphings79/mail-archiver-ha-app) | Betreibt Mail Archiver als Add-on unter Home Assistant OS. Erscheint per Ingress in der Seitenleiste und damit auch in der Home-Assistant-App auf dem Handy. |

## Auf dem Handy

Die Weboberfläche lässt sich installieren. Im Browser des Handys öffnen und
**Zum Home-Bildschirm hinzufügen** wählen — sie läuft dann im Vollbild mit
eigenem Symbol wie eine App. Hinter einem Reverse Proxy mit HTTPS klappt das
von überall; `http://` gilt nur auf localhost als installierbar.

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

☕ **[Einen Kaffee spendieren](https://buymeacoffee.com/sphings)** —
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
