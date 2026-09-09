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

[English version](README.md) · [Funktionen](#funktionen) · [Installation](#installation) · [Desktop oder Container?](#desktop-oder-container) · [Docker](#docker) · [OAuth](#oauth-für-gmail-und-microsoft-365) · [Archiv prüfen](#das-archiv-prüfen) · [Statistik](#statistik-und-register) · [Home Assistant](#home-assistant) · [FAQ](#faq)

**Gehört ebenfalls zum Projekt:** [Home-Assistant-Integration](https://github.com/sphings79/mail-archiver-home-assistant) · [Home Assistant App (Addon)](https://github.com/sphings79/mail-archiver-ha-app)

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

> **Alles auf dem Fahrplan ist fertig.** Sicherung, Anhang-Export, Suche,
> Viewer, Export, MCP, Rückspielen, der Container, die Fernsteuerung, OAuth,
> die Archivprüfung, der Umzug, Statistik und Register laufen.

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

<img src="assets/screenshots/statistics.svg" width="880" alt="Statistik mit Nachrichten je Jahr, häufigsten Absendern und größten Ordnern, dunkel und hell nebeneinander">

<em>Statistik — was tatsächlich im Archiv liegt, direkt aus dem Index: je Jahr,
je Absender, je Ordner, nach Anhangstyp.</em>

<br><br>

<img src="assets/screenshots/verify.svg" width="880" alt="Dialog zum Prüfen des Archivs mit Zahlen und drei Befunden, dunkel und hell nebeneinander">

<em>Archiv prüfen — jede Datei gegen ihre Prüfsumme, jeder Ordner gegen den
Server. Was fehlt, sich verändert hat oder nicht in den Index gehört, steht
namentlich da.</em>

<br><br>

<img src="assets/screenshots/transfer.svg" width="880" alt="Dialog zum Umziehen des Archivs auf eine andere Instanz mit Fortschritt, dunkel und hell nebeneinander">

<em>Umziehen — das Archiv wandert zur anderen Instanz, die ihren Index aus den
Journalen neu aufbaut. Ein Abbruch ist harmlos, die erste Sicherung drüben lädt
nichts.</em>

<br><br>

<img src="assets/screenshots/oauth.svg" width="880" alt="Kontodialog beim Verbinden per OAuth mit Device-Code und der Adresse zur Eingabe, dunkel und hell nebeneinander">

<em>OAuth — Microsoft gibt einen Code aus, den du auf einem beliebigen Gerät
eingibst, Gmail läuft über den Browser. Der Token erneuert sich selbst,
geplante Sicherungen laufen weiter.</em>

<br><br>

<img src="assets/screenshots/homeassistant.svg" width="880" alt="Home-Assistant-Seite mit MQTT-Broker, Topics und Schaltern für Discovery und Befehle, dunkel und hell nebeneinander">

<em>Home Assistant — MQTT-Broker eintragen, fertig: die Entitäten entstehen per
Discovery, das Konto steckt im Topic.</em>

<br><br>

<img src="assets/screenshots/notifications.svg" width="880" alt="Benachrichtigungen mit Adresse, Format, den vier Ereignissen und den beiden Speicherplatzgrenzen, dunkel und hell nebeneinander">

<em>Benachrichtigungen und Speicherplatz — eine Adresse, die einen POST annimmt,
genügt; zwei Grenzen entscheiden, wann gewarnt wird und wann eine laufende
Sicherung anhält.</em>

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
- **OAuth für Gmail und Microsoft 365**, die für IMAP kein Passwort mehr
  annehmen. Microsoft per Device-Code, Gmail über den Browser; der Token wird
  vor jeder Verbindung erneuert, geplante Sicherungen laufen also weiter
- **Postfach-Browser**: links Konten und Ordner, rechts die Mails des gewählten
  Ordners, direkt aus dem lokalen Index
- **Archivprüfung.** Jede Datei gegen die Prüfsumme vom Tag des Herunterladens,
  jeder Ordner gegen die Anzahl auf dem Server — damit „fehlt etwas?" eine
  Antwort hat
- **Archiv umziehen** auf eine andere Instanz, aus der App heraus: es wandern
  die Dateien, die Gegenstelle baut ihren Index aus den Journalen, und die
  erste Sicherung dort lädt nichts
- **Gmail-Duplikate einmal gespeichert.** Eine Mail, die im Ordner und in
  „Alle Nachrichten" liegt, wird erkannt, bevor etwas geladen wird: beide
  Ordner zeigen sie, die Bytes gibt es einmal
- **Alles vor einem Datum vor dem Löschen schützen** — um das Postfach auf dem
  Server zu leeren, während das Archiv es behält
- **Statistik**: Nachrichten je Jahr, häufigste Absender, größte Ordner und
  Nachrichten, Anhänge nach Typ
- **Register im Archiv** — eine `index.html` je Ordner, die auf die
  `.eml`-Dateien daneben verweist, lesbar ohne dieses Programm
- **Speicherplatz-Wächter**: eine Grenze zum Warnen und eine, ab der eine
  laufende Sicherung anhält, statt die Platte vollzuschreiben
- **Benachrichtigungen** an alles, was einen POST annimmt — ntfy, Gotify,
  Discord, Apprise — bei fehlgeschlagener Sicherung, erfolgreicher Sicherung,
  einem Prüfbefund oder knappem Speicher
- **Auf dem Handy installierbar**: die Weboberfläche ist eine progressive Web-App
- **Live-Fortschritt** über WebSocket, mit einem lesbaren Protokoll

## Drei Projekte, ein Archiv

| | Was es ist |
| --- | --- |
| **Mail Archiver** (hier) | Die Anwendung: Desktop-App für macOS, Windows und Linux, dazu ein Docker-Container mit derselben Oberfläche |
| [**Mail Archiver Integration**](https://github.com/sphings79/mail-archiver-home-assistant) | Home-Assistant-Integration aus HACS: ein Gerät je Postfach, Sensoren, ein Knopf zum Sichern und eine Lovelace-Karte |
| [**Home Assistant App (Addon)**](https://github.com/sphings79/mail-archiver-ha-app) | Betreibt Mail Archiver unter Home Assistant OS, per Ingress in der Seitenleiste |

Die Anwendung steht für sich; die beiden anderen sind da, wenn du Home
Assistant betreibst.

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

## Desktop oder Container?

Beide führen dieselbe Maschinerie und dieselbe Oberfläche aus. Nur das hier
unterscheidet sich:

| | Desktop-App | Container / Add-on |
| --- | --- | --- |
| Sichert, während der Rechner aus ist | — | ✅ |
| Sicherung nach Zeitplan | — | ✅ Cron |
| Von anderen Geräten erreichbar, auch vom Handy | — | ✅ |
| Anmeldung vor der Oberfläche | — | ✅ |
| OAuth-Rückleitung fängt die App selbst auf | ✅ | — Adresse einmal einfügen |
| Nachricht im Mailprogramm öffnen | ✅ | — `.eml` herunterladen |
| Per Doppelklick installiert, ohne Server | ✅ | — |

Alles andere ist gleich: Sicherung, Anhang-Export, Suche, Ansicht, Export als
PDF, mbox und ZIP, Rückspielen, Archivprüfung, Umzug, Gmail-Verlinkung,
Schutzdatum, Statistik, Register, Benachrichtigungen, Speicherplatz-Wächter,
MCP und MQTT. Das Archiv auf der Platte sieht in beiden Fällen gleich aus, es
kann also von einem zum anderen wandern — siehe
[Ein Archiv umziehen](#ein-archiv-umziehen).

Verbreitet ist beides zusammen: der Container auf dem NAS oder in Home
Assistant erledigt die Nacht, die Desktop-App verbindet sich damit, wenn du
etwas nachsehen willst.

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


### Umzug in das Home-Assistant-Add-on

Das Add-on antwortet normalerweise nur über Ingress, und Ingress ist keine
Adresse, an die die Desktop-App Dateien schicken kann. Zwei Einstellungen im
Reiter **Konfiguration** des Add-ons öffnen den Weg:

1. Ein **Oberflächen-Passwort** setzen (`ui_password`). Ohne eins weist das
   Add-on alles ab, was nicht der Supervisor ist — Ingress hat keine eigene
   Anmeldung, dieser Schutz ist also das Einzige, was davor steht.
2. Unter **Netzwerk** den Port `8484` auf den Host legen.

Die Oberfläche antwortet dann auch unter `http://homeassistant.local:8484`, und
genau diese Adresse will **Umziehen**, zusammen mit dem Oberflächen-Passwort.
Den Port ohne das Passwort freizugeben ändert nichts: das Add-on weist weiter
ab und schreibt das ins Protokoll.

Dieselbe Übernahme läuft auch allein: `POST /api/accounts/<id>/adopt` nimmt ein
Archivverzeichnis in Betrieb, das schon da liegt — so wird eine verlorene
Index-Datenbank wieder aufgebaut.

## Gmail: eine Nachricht, mehrere Ordner

Gmail zeigt jede Mail in ihrem Ordner **und** in „Alle Nachrichten" — wer beides
sichert, hat sie doppelt. Mit **Nachricht nur einmal speichern** in den
erweiterten Kontoeinstellungen wird aus der zweiten Kopie ein Eintrag, der auf
die erste Datei zeigt:

| | Dateien | Archiv |
| --- | --- | --- |
| Aus | 6 | 1080 Bytes |
| An | 3 | 540 Bytes |

Beide Ordner zeigen weiterhin alle Nachrichten, die Suche findet sie, und
öffnen lässt sie sich von beiden Seiten. Heruntergeladen wird sie kein zweites
Mal — sie wird schon am Umschlag erkannt, bevor ein Byte des Inhalts abgerufen
wird.

Verliert ausgerechnet der Ordner mit der Datei die Nachricht auf dem Server,
wandert die Datei in einen Ordner, der sie noch zeigt. Das Löschen einer Kopie
nimmt nie die andere mit.

## Statistik und Register

**Die Statistik** beantwortet, was eigentlich im Archiv liegt: Nachrichten je
Jahr, die häufigsten Absender, die größten Ordner und Nachrichten, Anhänge nach
Typ. Alles kommt aus dem Index — die Seite kostet ein paar Abfragen und liest
keine einzige Datei.

**Das Register** macht das Archiv ohne dieses Programm benutzbar. Es schreibt
neben die Nachrichten eine `index.html` — je Ordner eine Seite, die auf die
`.eml`-Dateien daneben verweist, dazu eine Übersicht. In jedem Browser aus einem
gewöhnlichen Verzeichnis zu öffnen: kein Server, keine Datenbank, nichts zu
installieren. Geschrieben wird es auf Knopfdruck, im Dialog **Prüfen**.

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

### Postfach leeren, Archiv behalten

Alte Mail vom Server räumen, um dort Platz zu gewinnen, ist ein ganz normaler
Vorgang — und das Archiv ist genau der Ort, an dem sie das überleben soll. In
den erweiterten Kontoeinstellungen ein Datum unter **Älteres nie löschen ab**
eintragen, und alles davor bleibt liegen, egal was auf dem Server passiert und
egal welche Löschregel eingestellt ist. Alles Neuere folgt weiter der normalen
Regel.

```
Server geleert, Löschregel „spiegeln", geschützt vor dem 01.01.2024:
  2 geschützt, 1 entfernt
  übrig: die Nachricht von 2019 und die von 2020
```

Der Abgleich mit dem Server meldet den Ordner danach nicht mehr als abweichend:
mehr zu haben als der Server ist bei dieser Einstellung der Zweck und kein
Fehler.

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
| 1 | Grundlage, Konten, Ordnerauswahl, inkrementelle Sicherung, Desktop-App | ✅ fertig |
| 2 | Anhang-Export mit Ablagen, Filtern und Doppelerkennung | ✅ fertig |
| 3 | Ansicht, Volltextsuche, „im Mailprogramm öffnen", Export als mbox/PDF/ZIP, MCP-Server | ✅ fertig |
| 4 | Rückspielen, auch zu einem anderen Anbieter | ✅ fertig |
| 5 | Docker-Image, Web-Login, Zeitplan, Fernsteuerung | ✅ fertig |
| 6 | Themes, Übersetzungen, optionale Archivverschlüsselung, Windows- und Linux-Pakete | ✅ fertig |
| 7 | Postfach-Browser, mehr Suchfilter, MQTT und die Home-Assistant-Projekte | ✅ fertig |
| 8 | OAuth, Archivprüfung, Umzug, Gmail-Duplikate, Statistik, Register | ✅ fertig |
| weiter | CalDAV/CardDAV ist ausdrücklich **nicht** geplant — hier geht es um Mail |  |

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
Ja. Microsoft per Device-Code, Gmail über den Browser, und der Token wird von
selbst erneuert — geplante Sicherungen laufen also weiter. Siehe
[OAuth](#oauth-für-gmail-und-microsoft-365).

**Kann ich das Postfach auf dem Server leeren und hier alles behalten?**
Ja, dafür gibt es das Schutzdatum. Ist ein Datum gesetzt, wird nichts Älteres
je aus dem Archiv entfernt, egal was auf dem Server passiert.

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
