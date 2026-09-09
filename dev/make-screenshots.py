"""
Draws the SVG "screenshots" for the README.

Hand drawn pictures of the interface. They are sharp at any size, tiny, and
reviewable in a diff - a real PNG screenshot is none of those things.

The sources under assets/screenshots/src are drawn in the dark theme only.
This script recolours each one into the light theme and puts both halves into
one picture, torn apart along a ragged diagonal, so a single image shows what
the application looks like either way.

    python3 dev/make-screenshots.py
"""

from pathlib import Path

W, H = 1200, 720
BG = "#0d0f14"
PANEL = "#151821"
PANEL_2 = "#1b1f2a"
BORDER = "#262c3a"
TEXT = "#e8eaf0"
MUTED = "#9aa2b5"
FAINT = "#6b7386"
ACCENT = "#7c5cff"
ACCENT_SOFT = "#221d3d"
OK = "#3ddc97"
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"

# Navigation, in the order the application shows it.
NAV = [
    "Übersicht",
    "Konten",
    "Postfach",
    "Suche",
    "Statistik",
    "Einstellungen",
    "KI-Anbindung",
    "Home Assistant",
    "Protokoll",
]


def head(height: int, label: str, title: str, desc: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {height}" width="{W}" height="{height}" role="img" aria-label="{label}">
  <title>{title}</title>
  <desc>{desc}</desc>

  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9674ff"/>
      <stop offset="1" stop-color="#6244e2"/>
    </linearGradient>
    <clipPath id="round">
      <rect x="0" y="0" width="{W}" height="{height}" rx="14"/>
    </clipPath>
  </defs>

  <g clip-path="url(#round)" font-family="{FONT}">
    <rect width="{W}" height="{height}" fill="{BG}"/>
"""


def titlebar() -> str:
    return f"""
    <!-- title bar -->
    <rect width="{W}" height="44" fill="{PANEL}"/>
    <line x1="0" y1="44" x2="{W}" y2="44" stroke="{BORDER}" stroke-width="1"/>
    <circle cx="24" cy="22" r="6" fill="#ff5f57"/>
    <circle cx="44" cy="22" r="6" fill="#febc2e"/>
    <circle cx="64" cy="22" r="6" fill="#28c840"/>
    <text x="94" y="26" fill="{MUTED}" font-size="12.5" font-weight="500">AmberChest</text>
    <text x="184" y="26" fill="{FAINT}" font-size="12.5">IMAP mail backup in plain .eml files</text>
"""


def nav_icon(name: str, x: int, y: int, colour: str) -> str:
    """A 18x18 line icon, drawn at the top left corner (x, y)."""
    s = f'stroke="{colour}" stroke-width="1.6" fill="none"'
    if name == "Übersicht":
        return f"""<g {s}>
      <rect x="{x}" y="{y}" width="7" height="7" rx="1.5"/><rect x="{x + 11}" y="{y}" width="7" height="7" rx="1.5"/>
      <rect x="{x}" y="{y + 11}" width="7" height="7" rx="1.5"/><rect x="{x + 11}" y="{y + 11}" width="7" height="7" rx="1.5"/>
    </g>"""
    if name == "Konten":
        return f"""<g {s}>
      <rect x="{x}" y="{y + 2}" width="18" height="14" rx="2.5"/>
      <path d="M{x} {y + 5.5} {x + 9} {y + 11} {x + 18} {y + 5.5}" stroke-linecap="round"/>
    </g>"""
    if name == "Postfach":
        return f"""<g {s}>
      <path d="M{x + 1} {y + 3}h6l2 2.5h8" /><rect x="{x + 1}" y="{y + 3}" width="16" height="12" rx="2.5"/>
      <path d="M{x + 5} {y + 9}h8M{x + 5} {y + 12}h5" stroke-linecap="round"/>
    </g>"""
    if name == "Statistik":
        return f"""<g {s}>
      <path d="M{x + 1} {y + 17}v-7M{x + 6.5} {y + 17}v-12M{x + 12} {y + 17}v-4M{x + 17} {y + 17}v-9" stroke-linecap="round"/>
    </g>"""
    if name == "Suche":
        return f"""<g {s}>
      <circle cx="{x + 8}" cy="{y + 8}" r="6"/><path d="M{x + 12.5} {y + 12.5} {x + 17} {y + 17}" stroke-linecap="round"/>
    </g>"""
    if name == "Einstellungen":
        return f"""<g {s}>
      <circle cx="{x + 9}" cy="{y + 9}" r="3.4"/><circle cx="{x + 9}" cy="{y + 9}" r="8"/>
    </g>"""
    if name == "KI-Anbindung":
        return f"""<g {s}>
      <rect x="{x + 1}" y="{y + 5}" width="16" height="12" rx="3.5"/>
      <path d="M{x + 9} {y + 1}v4" stroke-linecap="round"/><circle cx="{x + 9}" cy="{y + 1}" r="1.4" fill="{colour}"/>
      <circle cx="{x + 6}" cy="{y + 11}" r="1.3" fill="{colour}" stroke="none"/>
      <circle cx="{x + 12}" cy="{y + 11}" r="1.3" fill="{colour}" stroke="none"/>
    </g>"""
    if name == "Home Assistant":
        return f"""<g {s}>
      <path d="M{x + 1} {y + 9} {x + 9} {y + 2} {x + 17} {y + 9}" stroke-linejoin="round"/>
      <path d="M{x + 3.5} {y + 8}v8h11v-8" stroke-linejoin="round"/>
      <path d="M{x + 6.8} {y + 16}v-3a2.4 2.4 0 0 1 4.4 0v3"/>
    </g>"""
    return f"""<g {s}>
      <rect x="{x + 1}" y="{y + 1}" width="15" height="17" rx="2"/>
      <path d="M{x + 5} {y + 6}h7M{x + 5} {y + 10}h7M{x + 5} {y + 14}h4" stroke-linecap="round"/>
    </g>"""


def sidebar(active: str, height: int = H, accounts: int = 2) -> str:
    """The left hand navigation, identical on every picture."""
    out = [f"""
    <!-- sidebar -->
    <rect x="0" y="44" width="228" height="{height - 44}" fill="{PANEL}"/>
    <line x1="228" y1="44" x2="228" y2="{height}" stroke="{BORDER}" stroke-width="1"/>

    <rect x="18" y="66" width="36" height="36" rx="11" fill="url(#accent)"/>
    <g stroke="#fff" stroke-width="1.7" fill="none">
      <rect x="27" y="76" width="18" height="14" rx="2.5"/>
      <path d="M27 79.5 36 85l9-5.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="64" y="82" fill="{TEXT}" font-size="13" font-weight="600">AmberChest</text>
    <text x="64" y="96" fill="{FAINT}" font-size="9.5">IMAP mail backup in plain .eml files</text>
"""]

    y = 126
    for item in NAV:
        colour = ACCENT if item == active else MUTED
        if item == active:
            out.append(f'    <rect x="12" y="{y}" width="204" height="36" rx="11" fill="{ACCENT_SOFT}"/>\n')
        out.append(f"    {nav_icon(item, 26, y + 9, colour)}\n")
        weight = ' font-weight="500"' if item == active else ""
        out.append(f'    <text x="56" y="{y + 23}" fill="{colour}" font-size="12.5"{weight}>{item}</text>\n')
        if item == "Konten":
            out.append(f'    <text x="200" y="{y + 23}" fill="{FAINT}" font-size="11" text-anchor="end">{accounts}</text>\n')
        y += 42

    # Bottom block, measured from the lower edge so it never touches the last
    # navigation item.
    lock = height - 28
    connection = height - 90
    coffee = height - 106
    star = height - 138

    out.append(f"""
    <g stroke="{FAINT}" stroke-width="1.5" fill="none">
      <path d="M35 {star - 10}l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" stroke-linejoin="round"/>
    </g>
    <text x="56" y="{star}" fill="{FAINT}" font-size="12">Stern auf GitHub</text>

    <g stroke="{FAINT}" stroke-width="1.5" fill="none">
      <path d="M28 {coffee - 13}h11v7a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4z"/>
      <path d="M39 {coffee - 11}h2.5a2.5 2.5 0 0 1 0 5H39"/>
    </g>
    <text x="56" y="{coffee}" fill="{FAINT}" font-size="12">Kaffee spendieren</text>

    <rect x="12" y="{connection}" width="204" height="44" rx="11" fill="#11141b" stroke="{BORDER}"/>
    <g stroke="{FAINT}" stroke-width="1.5" fill="none">
      <rect x="26" y="{connection + 14}" width="16" height="11" rx="2"/><path d="M30 {connection + 29}h8"/>
    </g>
    <text x="52" y="{connection + 18}" fill="{FAINT}" font-size="8.5" letter-spacing="0.7">VERBINDUNG</text>
    <text x="52" y="{connection + 33}" fill="{MUTED}" font-size="12">Dieser Rechner</text>
    <path d="M203 {connection + 18}l4-4 4 4M203 {connection + 28}l4 4 4-4" stroke="{FAINT}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>

    <g stroke="{FAINT}" stroke-width="1.6" fill="none">
      <rect x="28" y="{lock - 9}" width="13" height="9" rx="2"/>
      <path d="M31 {lock - 9}v-3a3.5 3.5 0 0 1 7 0v3"/>
    </g>
    <text x="56" y="{lock}" fill="{FAINT}" font-size="12.5">Sperren</text>
""")
    return "".join(out)


def card(x, y, w, h, fill=PANEL, stroke=BORDER, r=14) -> str:
    return f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}"/>\n'


def text(x, y, value, fill=TEXT, size=12.5, weight=None, anchor=None, family=None, spacing=None) -> str:
    parts = [f'    <text x="{x}" y="{y}" fill="{fill}" font-size="{size}"']
    if weight:
        parts.append(f' font-weight="{weight}"')
    if anchor:
        parts.append(f' text-anchor="{anchor}"')
    if family:
        parts.append(f' font-family="{family}"')
    if spacing:
        parts.append(f' letter-spacing="{spacing}"')
    parts.append(f">{value}</text>\n")
    return "".join(parts)


def toggle(x, y, on: bool, label: str) -> str:
    fill = ACCENT if on else "#2a2f3d"
    knob = x + 21 if on else x + 9
    return (
        f'    <rect x="{x}" y="{y}" width="30" height="18" rx="9" fill="{fill}"/>\n'
        f'    <circle cx="{knob}" cy="{y + 9}" r="6.5" fill="#fff"/>\n'
        + text(x + 42, y + 13, label, MUTED)
    )


def field(x, y, w, label, value, placeholder=False) -> str:
    return (
        text(x, y, label, FAINT, 9.5, spacing="0.6")
        + card(x, y + 8, w, 34, "#11141b", BORDER, 10)
        + text(x + 14, y + 30, value, FAINT if placeholder else TEXT, 12)
    )


def button(x, y, w, label, primary=False, icon=None) -> str:
    fill = "url(#accent)" if primary else "#181c26"
    stroke = "none" if primary else BORDER
    colour = "#fff" if primary else MUTED
    out = f'    <rect x="{x}" y="{y}" width="{w}" height="34" rx="11" fill="{fill}" stroke="{stroke}"/>\n'
    if icon:
        out += icon
    return out + text(x + (34 if icon else 16), y + 22, label, colour, 12.5, "500")


def tail() -> str:
    return "  </g>\n</svg>\n"


# --------------------------------------------------------------- the pictures

def browser() -> str:
    out = [
        head(H, "AmberChest mailbox browser with the folder tree and the message list",
             "AmberChest — Postfach",
             "The mailbox browser: accounts and folders on the left, the messages of the selected folder on the right."),
        titlebar(),
        sidebar("Postfach"),
        text(268, 96, "Postfach", TEXT, 20, "600"),
    ]

    # folder tree
    out.append(card(268, 126, 300, 560))
    out.append(card(284, 142, 268, 30, "#11141b", BORDER, 9))
    out.append(f'    <g stroke="{FAINT}" stroke-width="1.5" fill="none"><circle cx="300" cy="157" r="4.5"/><path d="M303.5 160.5 307 164" stroke-linecap="round"/></g>\n')
    out.append(text(316, 161, "Ordner filtern …", FAINT, 11.5))

    tree = [
        (0, "Privat", "12.480", True, True),
        (1, "INBOX", "8.412", False, True),
        (2, "Rechnungen", "612", False, False),
        (2, "Newsletter", "1.905", False, False),
        (1, "Gesendet", "2.187", False, False),
        (1, "Archiv", "1.881", False, False),
        (2, "2024", "934", False, False),
        (2, "2023", "947", False, False),
        (1, "Papierkorb", "0", False, False),
        (0, "Arbeit", "35.733", True, False),
        (1, "INBOX", "21.004", False, False),
        (1, "Projekte", "9.884", False, False),
        (1, "Gesendet", "4.845", False, False),
    ]
    y = 196
    for depth, name, count, is_account, active in tree:
        x = 292 + depth * 18
        if active:
            out.append(card(284, y - 15, 268, 28, ACCENT_SOFT, "none", 9))
        colour = TEXT if is_account else (ACCENT if active else MUTED)
        weight = "600" if is_account else None
        if is_account:
            out.append(f'    <rect x="{x}" y="{y - 11}" width="16" height="16" rx="5" fill="{ACCENT_SOFT}"/>\n')
            out.append(f'    <g stroke="{ACCENT}" stroke-width="1.4" fill="none"><rect x="{x + 3}" y="{y - 7}" width="10" height="8" rx="1.5"/><path d="M{x + 3} {y - 5.5} {x + 8} {y - 2} {x + 13} {y - 5.5}"/></g>\n')
        else:
            out.append(f'    <g stroke="{ACCENT if active else FAINT}" stroke-width="1.4" fill="none"><path d="M{x} {y - 8}h5l1.6 2h7.4v8H{x}z"/></g>\n')
        out.append(text(x + 24, y, name, colour, 12.5, weight))
        out.append(text(536, y, count, FAINT, 11, anchor="end"))
        y += 36

    # message list
    out.append(card(588, 126, 578, 560))
    out.append(text(608, 158, "Privat / INBOX", TEXT, 13.5, "600"))
    out.append(text(1146, 158, "8.412 Nachrichten", FAINT, 11, anchor="end"))
    out.append(f'    <line x1="588" y1="176" x2="1166" y2="176" stroke="{BORDER}"/>\n')

    rows = [
        ("Rechnung 2024-114", "buchhaltung@stadtwerke.de", "14.02.2024", "42 KB", True, True),
        ("Re: Angebot Küche", "info@tischlerei-lang.de", "13.02.2024", "18 KB", False, False),
        ("Ihre Bestellung ist unterwegs", "versand@shop.example", "12.02.2024", "96 KB", True, False),
        ("Terminbestätigung Zahnarzt", "praxis@dr-mueller.de", "11.02.2024", "9 KB", False, False),
        ("Newsletter Februar", "news@verein.example", "09.02.2024", "212 KB", True, False),
        ("Grüße aus München", "familie@example.com", "07.02.2024", "7 KB", False, False),
        ("Vertragsunterlagen", "service@versicherung.de", "05.02.2024", "1,2 MB", True, False),
        ("Passwort geändert", "noreply@konto.example", "03.02.2024", "6 KB", False, False),
    ]
    y = 196
    for subject, sender, date, size, has_attachment, selected in rows:
        if selected:
            out.append(card(600, y - 20, 554, 58, ACCENT_SOFT, "none", 11))
        out.append(text(618, y, subject, TEXT if selected else MUTED, 12.5, "500" if selected else None))
        out.append(text(618, y + 19, sender, FAINT, 11))
        out.append(text(1138, y, date, FAINT, 11, anchor="end"))
        out.append(text(1138, y + 19, size, FAINT, 10.5, anchor="end"))
        if has_attachment:
            out.append(f'    <g stroke="{FAINT}" stroke-width="1.4" fill="none"><path d="M1058 {y - 9}v7a4 4 0 0 0 8 0v-9a2.6 2.6 0 0 0-5.2 0v9" stroke-linecap="round"/></g>\n')
        y += 60

    out.append(tail())
    return "".join(out)


def search() -> str:
    out = [
        head(H, "AmberChest search screen with the extended filters open",
             "AmberChest — Suche",
             "Full text search with the filter panel open: field, sender, recipient, dates, size, read state and sort order."),
        titlebar(),
        sidebar("Suche"),
        text(268, 96, "Suche", TEXT, 20, "600"),
    ]

    out.append(card(268, 126, 898, 386))
    out.append(card(286, 144, 380, 34, "#11141b", BORDER, 10))
    out.append(f'    <g stroke="{FAINT}" stroke-width="1.5" fill="none"><circle cx="306" cy="161" r="5"/><path d="M310 165l4 4" stroke-linecap="round"/></g>\n')
    out.append(text(324, 165, "rechnung 2024", TEXT, 12.5))
    out.append(button(676, 144, 118, "Alle Konten"))
    out.append(button(806, 144, 108, "Filter"))
    out.append(f'    <circle cx="898" cy="161" r="9" fill="{ACCENT}"/>\n')
    out.append(text(898, 165, "3", "#fff", 10.5, "600", anchor="middle"))
    out.append(button(926, 144, 128, "Exportieren"))

    out.append(card(286, 194, 862, 300, "#11141b", "none", 12))

    out.append(field(306, 214, 262, "ABSENDER ENTHÄLT", "buchhaltung"))
    out.append(field(586, 214, 262, "EMPFÄNGER ENTHÄLT", "beliebig", True))
    out.append(field(866, 214, 262, "SUCHEN IN", "Nur Betreff"))
    out.append(field(306, 276, 262, "VON", "01.01.2024"))
    out.append(field(586, 276, 262, "BIS", "31.12.2024"))
    out.append(field(866, 276, 262, "SORTIERUNG", "Neueste zuerst"))
    out.append(field(306, 338, 402, "MINDESTGRÖSSE (KB)", "100"))
    out.append(field(726, 338, 402, "MAXIMALGRÖSSE (KB)", "0", True))

    out.append(toggle(306, 396, True, "Nur mit Anhang"))
    out.append(toggle(306, 426, False, "Nur ungelesene"))
    out.append(toggle(586, 396, False, "Nur markierte"))
    out.append(toggle(586, 426, False, "Serverseitig gelöschte einbeziehen"))

    chips = ["Privat/INBOX", "Privat/Rechnungen", "Arbeit/Projekte"]
    y = 388
    for chip in chips:
        w = 22 + int(len(chip) * 6.2)
        out.append(f'    <rect x="866" y="{y}" width="{w}" height="26" rx="13" fill="{ACCENT_SOFT}" stroke="{ACCENT}"/>\n')
        out.append(text(877, y + 17, chip, ACCENT, 11))
        y += 32

    out.append(text(268, 542, "18 Treffer", FAINT, 11.5))

    hits = [
        ("Rechnung 2024-114", "buchhaltung@stadtwerke.de · Privat/Rechnungen", "… Ihre ", "Rechnung", " über 128,40 Euro ist beigefügt …"),
        ("Rechnung 2024-098", "buchhaltung@stadtwerke.de · Privat/Rechnungen", "… die ", "Rechnung", " für Januar 2024 finden Sie im Anhang …"),
    ]
    y = 562
    for subject, meta, before, mark, after in hits:
        out.append(card(268, y, 898, 62))
        out.append(text(292, y + 26, subject, TEXT, 12.5, "500"))
        out.append(text(1142, y + 26, "14.02.2024", FAINT, 11, anchor="end"))
        out.append(f'    <text x="292" y="{y + 46}" font-size="11" fill="{FAINT}">{before}<tspan fill="{ACCENT}">{mark}</tspan>{after}</text>\n')
        out.append(text(1142, y + 46, meta, FAINT, 10.5, anchor="end"))
        y += 72

    out.append(tail())
    return "".join(out)


def homeassistant() -> str:
    out = [
        head(H, "AmberChest Home Assistant screen with the MQTT settings",
             "AmberChest — Home Assistant",
             "The Home Assistant screen: MQTT broker, topics, switches for discovery and commands, and the pointer to the integration."),
        titlebar(),
        sidebar("Home Assistant"),
        text(268, 96, "Home Assistant", TEXT, 20, "600"),
    ]

    out.append(card(268, 126, 720, 540))
    out.append(f'    <g stroke="{ACCENT}" stroke-width="1.6" fill="none"><path d="M292 160a12 12 0 0 1 16 0M296 165a7 7 0 0 1 8 0" stroke-linecap="round"/><circle cx="300" cy="170" r="1.6" fill="{ACCENT}" stroke="none"/></g>\n')
    out.append(text(320, 166, "MQTT-Anbindung", TEXT, 13.5, "600"))
    out.append(f'    <rect x="440" y="152" width="86" height="20" rx="10" fill="#12291f"/>\n')
    out.append(text(483, 166, "verbunden", OK, 10.5, "500", anchor="middle"))

    out.append(text(292, 194, "Veröffentlicht den Zustand jedes Kontos auf einem MQTT-Broker. Home Assistant legt die", FAINT, 11.5))
    out.append(text(292, 212, "Entitäten per Discovery selbst an - Nachrichten, Archivgröße, letzte Sicherung und einen Knopf.", FAINT, 11.5))

    out.append(toggle(292, 232, True, "MQTT aktivieren"))

    out.append(field(292, 274, 672, "BROKER", "mqtt://192.168.1.10:1883"))
    out.append(field(292, 334, 328, "BENUTZER", "amberchest"))
    out.append(field(636, 334, 328, "PASSWORT", "••••••••••"))
    out.append(field(292, 394, 328, "BASIS-TOPIC", "amberchest"))
    out.append(field(636, 394, 328, "SENDEINTERVALL", "1 min"))

    out.append(card(292, 454, 672, 96, "#11141b", "none", 12))
    out.append(text(310, 476, "Topics", FAINT, 9.5, spacing="0.6"))
    lines = [
        "amberchest/status",
        "amberchest/state",
        "amberchest/account/privat/state",
        "amberchest/account/privat/set",
    ]
    y = 494
    for line in lines:
        out.append(text(310, y, line, MUTED, 11, family=MONO))
        y += 15

    out.append(toggle(292, 566, True, "Home-Assistant-Discovery senden"))
    out.append(toggle(636, 566, True, "Befehle annehmen (Sichern per Knopf)"))
    out.append(toggle(292, 596, True, "Nachrichten behalten (retained)"))
    out.append(toggle(636, 596, False, "Selbstsigniertes Zertifikat akzeptieren"))

    out.append(button(292, 622, 156, "Neu verbinden"))
    out.append(button(464, 622, 136, "Jetzt senden"))
    out.append(text(964, 644, "zuletzt gesendet 21:34", FAINT, 11, anchor="end"))

    # the integration card
    out.append(card(1008, 126, 158, 344))
    out.append(f'    <g stroke="{ACCENT}" stroke-width="1.6" fill="none"><path d="M1030 168l14-12 14 12" stroke-linejoin="round"/><path d="M1034 166v14h20v-14" stroke-linejoin="round"/></g>\n')
    out.append(text(1087, 206, "Home-Assistant-", TEXT, 12.5, "600", anchor="middle"))
    out.append(text(1087, 222, "Integration", TEXT, 12.5, "600", anchor="middle"))
    out.append(text(1087, 250, "Eigene Integration", FAINT, 11, anchor="middle"))
    out.append(text(1087, 266, "über HACS, mit", FAINT, 11, anchor="middle"))
    out.append(text(1087, 282, "Lovelace-Karte und", FAINT, 11, anchor="middle"))
    out.append(text(1087, 298, "ohne Broker.", FAINT, 11, anchor="middle"))
    out.append(text(1087, 330, "Integration auf GitHub", ACCENT, 11, anchor="middle"))

    out.append(tail())
    return "".join(out)


def statistics() -> str:
    out = [
        head(H, "AmberChest statistics screen with messages per year and top senders",
             "AmberChest — Statistik",
             "The statistics screen: messages per year, the most frequent senders and the largest folders."),
        titlebar(),
        sidebar("Statistik"),
        text(268, 96, "Statistik", TEXT, 20, "600"),
        button(1010, 74, 156, "Alle Konten"),
    ]

    tiles = [
        ("NACHRICHTEN", "48.213", "14.03.2011 bis heute"),
        ("ARCHIVGRÖSSE", "1,84 GB", "Ø 40 KB je Nachricht"),
        ("ANHÄNGE", "6.412", "912 MB"),
        ("MEHRFACH ABGELEGT", "9.204", "einmal gespeichert"),
    ]
    x = 268
    for label, value, note in tiles:
        out.append(card(x, 126, 212, 92))
        out.append(text(x + 20, 152, label, FAINT, 9.5, spacing="0.6"))
        out.append(text(x + 20, 178, value, TEXT, 19, "600"))
        out.append(text(x + 20, 198, note, FAINT, 10))
        x += 228

    def bars(bx, by, bw, title, rows):
        parts = [card(bx, by, bw, 44 + len(rows) * 34)]
        parts.append(text(bx + 22, by + 30, title, TEXT, 13.5, "600"))
        top = max(value for _, value, _ in rows)
        y = by + 62
        for label, value, note in rows:
            parts.append(text(bx + 22, y, label, TEXT, 11.5))
            parts.append(text(bx + bw - 96, y, f"{value:,}".replace(",", "."), MUTED, 11, anchor="end"))
            parts.append(text(bx + bw - 22, y, note, FAINT, 10.5, anchor="end"))
            width = int((bw - 44) * value / top)
            parts.append(f'    <rect x="{bx + 22}" y="{y + 7}" width="{bw - 44}" height="5" rx="2.5" fill="{PANEL_2}"/>\n')
            parts.append(f'    <rect x="{bx + 22}" y="{y + 7}" width="{width}" height="5" rx="2.5" fill="{ACCENT}"/>\n')
            y += 34
        return "".join(parts)

    out.append(bars(268, 238, 898, "Nachrichten je Jahr", [
        ("2022", 7420, "268 MB"),
        ("2023", 9880, "402 MB"),
        ("2024", 12140, "531 MB"),
        ("2025", 11330, "486 MB"),
    ]))
    out.append(bars(268, 434, 440, "Häufigste Absender", [
        ("newsletter@shop.example", 1840, "96 MB"),
        ("buchhaltung@stadtwerke.de", 912, "212 MB"),
        ("info@verein.example", 640, "31 MB"),
    ]))
    out.append(bars(726, 434, 440, "Größte Ordner", [
        ("Archiv/2024", 12140, "531 MB"),
        ("INBOX", 8412, "402 MB"),
        ("Projekte/Rechnungen", 3120, "288 MB"),
    ]))

    out.append(tail())
    return "".join(out)


def verify() -> str:
    out = [
        head(H, "AmberChest checking an archive, with three findings",
             "AmberChest — Archiv prüfen",
             "The archive check: every file against its checksum, and the folders against the server."),
        titlebar(),
        sidebar("Konten"),
        text(268, 96, "Konten", TEXT, 20, "600"),
        f'    <rect y="44" width="{W}" height="{H - 44}" fill="#0d0f14" opacity="0.6"/>\n',
    ]

    out.append(card(300, 86, 600, 548, r=16))
    out.append(text(330, 130, "Archiv prüfen — Privat", TEXT, 16, "600"))
    out.append(text(330, 166, "Liest jede gesicherte Datei und vergleicht sie mit der Prüfsumme vom", MUTED, 11.5))
    out.append(text(330, 184, "Tag der Sicherung. Es wird nichts geändert und nichts gelöscht.", MUTED, 11.5))

    out.append(toggle(330, 204, True, "Mit dem Server abgleichen"))
    out.append(toggle(330, 240, False, "Serverseitig gelöschte mitprüfen"))

    out.append(card(330, 282, 540, 214, "#11141b", "none", 12))
    out.append(text(350, 308, "Fertig", MUTED, 11.5))
    out.append(text(850, 308, "12.480 / 12.480", FAINT, 11, anchor="end"))

    numbers = [
        ("Geprüft", "12.480", False),
        ("Fehlend", "1", True),
        ("Verändert", "1", True),
        ("Unlesbar", "0", False),
        ("Verwaist", "1", True),
        ("Auf dem Server", "12.479", False),
    ]
    for index, (label, value, bad) in enumerate(numbers):
        bx = 350 + (index % 3) * 174
        by = 324 + (index // 3) * 60
        out.append(card(bx, by, 160, 50, PANEL, "none", 10))
        out.append(text(bx + 14, by + 20, label, FAINT, 9.5))
        out.append(text(bx + 14, by + 40, value, "#f0645a" if bad else TEXT, 13, "500"))

    out.append(text(350, 476, "48,2 MB gelesen", FAINT, 10.5))

    findings = [
        ("Inhalt verändert", "INBOX/2024-01-16_…_Grüße-aus-München.eml"),
        ("Datei fehlt", "INBOX/2024-01-17_…_Rechnung-mit-Anhang.eml"),
        ("Nicht im Index", "INBOX/fremde-datei.eml"),
    ]
    fy = 508
    for kind, path in findings:
        out.append(card(330, fy, 540, 34, "#11141b", "none", 9))
        out.append(text(350, fy + 22, "!", "#f0645a", 12, "700"))
        out.append(text(366, fy + 22, f"{kind} · {path}", MUTED, 11))
        fy += 40

    out.append(button(660, 578, 100, "Schließen"))
    out.append(button(772, 578, 168, "Prüfung starten", True))

    out.append(tail())
    return "".join(out)


def transfer() -> str:
    out = [
        head(H, "AmberChest moving an archive to another instance",
             "AmberChest — Archiv umziehen",
             "Moving an archive: the files are sent to another instance, which rebuilds its index."),
        titlebar(),
        sidebar("Konten"),
        text(268, 96, "Konten", TEXT, 20, "600"),
        f'    <rect y="44" width="{W}" height="{H - 44}" fill="#0d0f14" opacity="0.6"/>\n',
    ]

    out.append(card(300, 118, 600, 484, r=16))
    out.append(text(330, 162, "Archiv umziehen — Privat", TEXT, 16, "600"))
    out.append(text(330, 198, "12.480 Nachrichten, 612 MB. Es wandern die Dateien, nicht der Index —", MUTED, 11.5))
    out.append(text(330, 216, "die Gegenstelle baut ihn aus den Journalen neu auf.", MUTED, 11.5))

    out.append(field(330, 244, 540, "ADRESSE DER GEGENSTELLE", "http://nas:8484"))
    out.append(field(330, 306, 540, "ZIELKONTO", "Privat — privat@example.com (0)"))

    out.append(card(330, 376, 540, 122, "#11141b", "none", 12))
    out.append(text(350, 402, "Dateien werden übertragen …", MUTED, 11.5))
    out.append(text(850, 402, "8.412 / 12.480", FAINT, 11, anchor="end"))
    out.append(f'    <rect x="350" y="416" width="500" height="6" rx="3" fill="{PANEL}"/>\n')
    out.append(f'    <rect x="350" y="416" width="337" height="6" rx="3" fill="{ACCENT}"/>\n')
    out.append(text(350, 448, "8.412 gesendet, 0 waren schon da, 0 fehlgeschlagen — 402 MB", FAINT, 10.5))
    out.append(text(350, 476, "INBOX/2024-03-02_100000_1_Angebot.eml", FAINT, 10.5, family=MONO))

    out.append(button(660, 532, 100, "Schließen"))
    out.append(button(772, 532, 168, "Abbrechen"))

    out.append(tail())
    return "".join(out)


def oauth() -> str:
    out = [
        head(H, "AmberChest connecting a mailbox with OAuth using a device code",
             "AmberChest — OAuth",
             "Connecting an account with OAuth: a provider is picked, a device code is shown and the archiver waits for the confirmation."),
        titlebar(),
        sidebar("Konten"),
        text(268, 96, "Konten", TEXT, 20, "600"),
        f'    <rect y="44" width="{W}" height="{H - 44}" fill="#0d0f14" opacity="0.6"/>\n',
    ]

    out.append(card(280, 108, 640, 560, r=16))
    out.append(text(310, 152, "Konto bearbeiten — Arbeit", TEXT, 16, "600"))

    out.append(field(310, 184, 290, "SERVER", "outlook.office365.com"))
    out.append(field(628, 184, 262, "PORT", "993"))
    out.append(field(310, 244, 290, "BENUTZER", "dennis@example.com"))
    out.append(field(628, 244, 262, "ANMELDUNG", "OAuth 2.0"))

    # the connect box, as it looks while a device code is pending
    out.append(card(310, 310, 580, 268, "#11141b", "none", 12))
    out.append(f'    <g stroke="{ACCENT}" stroke-width="1.6" fill="none"><circle cx="335" cy="337" r="5"/><path d="M339 341l10 10M345 347l-3 3M349 351l-3 3" stroke-linecap="round"/></g>\n')
    out.append(text(356, 342, "Mit dem Anbieter verbinden", TEXT, 12.5, "600"))

    out.append(field(330, 378, 540, "ANBIETER", "Microsoft"))

    out.append(text(330, 450, "Diesen Code auf der Seite eingeben — Handy oder anderer Rechner geht auch.", MUTED, 11.5))

    out.append(card(330, 464, 178, 42, PANEL, BORDER, 10))
    out.append(text(419, 492, "K7F4-9QLD", TEXT, 18, "600", anchor="middle", family=MONO, spacing="2"))
    out.append(card(520, 464, 42, 42, "#181c26", BORDER, 10))
    out.append(f'    <g stroke="{MUTED}" stroke-width="1.5" fill="none"><rect x="533" y="476" width="11" height="13" rx="2"/><path d="M537 474h11v13"/></g>\n')
    out.append(f'    <g stroke="{ACCENT}" stroke-width="1.5" fill="none"><path d="M580 480h9v9h-9z"/><path d="M586 477h5v5" stroke-linecap="round"/></g>\n')
    out.append(text(600, 490, "microsoft.com/devicelogin", ACCENT, 11.5))

    out.append(f'    <g stroke="{FAINT}" stroke-width="1.6" fill="none"><path d="M336 546a7 7 0 1 1 5-2" stroke-linecap="round"/></g>\n')
    out.append(text(352, 550, "Warte auf die Bestätigung …", FAINT, 11))

    out.append(text(310, 604, "Der Token wird vor jeder Verbindung erneuert — geplante Sicherungen laufen weiter.", FAINT, 11))

    out.append(button(628, 618, 118, "Abbrechen"))
    out.append(button(758, 618, 132, "Speichern", True))

    out.append(tail())
    return "".join(out)


def notifications() -> str:
    out = [
        head(H, "AmberChest settings for notifications and the disk space guard",
             "AmberChest — Benachrichtigungen",
             "The notification settings: a webhook address, the format, which events are sent, and the two disk space thresholds."),
        titlebar(),
        sidebar("Einstellungen"),
        text(268, 96, "Einstellungen", TEXT, 20, "600"),
    ]

    # notifications
    out.append(card(268, 126, 560, 540))
    out.append(f'    <g stroke="{ACCENT}" stroke-width="1.6" fill="none"><path d="M292 168v-6a8 8 0 0 1 16 0v6l3 5h-22z" stroke-linejoin="round"/><path d="M297 173a3 3 0 0 0 6 0" stroke-linecap="round"/></g>\n')
    out.append(text(320, 166, "Benachrichtigungen", TEXT, 13.5, "600"))

    out.append(text(292, 196, "Schickt eine Nachricht an alles, was einen POST annimmt — ntfy, Gotify,", FAINT, 11.5))
    out.append(text(292, 214, "Discord, Apprise. Eine nachts fehlgeschlagene Sicherung nützt nur,", FAINT, 11.5))
    out.append(text(292, 232, "wenn sie jemand mitbekommt.", FAINT, 11.5))

    out.append(toggle(292, 252, True, "Benachrichtigungen aktivieren"))

    out.append(field(292, 294, 512, "ADRESSE", "https://ntfy.sh/mein-postfach"))
    out.append(field(292, 354, 246, "FORMAT", "ntfy"))
    out.append(field(558, 354, 246, "ZUSÄTZLICHER HEADER", "—"))

    out.append(text(292, 434, "WANN GESENDET WIRD", FAINT, 9.5, spacing="0.6"))
    events = [
        (True, "Wenn eine Sicherung fehlschlägt"),
        (True, "Wenn eine Archivprüfung etwas findet"),
        (True, "Wenn der Speicherplatz knapp wird"),
        (False, "Nach jeder erfolgreichen Sicherung"),
    ]
    y = 448
    for on, label in events:
        out.append(toggle(292, y, on, label))
        y += 34

    out.append(button(292, 596, 190, "Testnachricht senden"))
    out.append(f'    <rect x="496" y="601" width="92" height="24" rx="12" fill="#12291f"/>\n')
    out.append(text(542, 617, "Angekommen.", OK, 10.5, "500", anchor="middle"))

    # disk space
    out.append(card(848, 126, 318, 540))
    out.append(f'    <g stroke="{ACCENT}" stroke-width="1.6" fill="none"><rect x="872" y="156" width="20" height="16" rx="3"/><path d="M876 172v4h12v-4"/><circle cx="882" cy="164" r="3"/></g>\n')
    out.append(text(902, 168, "Speicherplatz", TEXT, 13.5, "600"))

    out.append(card(872, 194, 270, 96, "#11141b", "none", 12))
    out.append(text(892, 224, "182 GB", TEXT, 20, "600"))
    out.append(text(892, 244, "frei von 465 GB", FAINT, 11))
    out.append(f'    <rect x="892" y="260" width="230" height="8" rx="4" fill="{PANEL}"/>\n')
    out.append(f'    <rect x="892" y="260" width="140" height="8" rx="4" fill="{ACCENT}"/>\n')

    out.append(field(872, 310, 270, "WARNEN UNTER (GB)", "20"))
    out.append(text(872, 366, "Zeigt einen Hinweis und schickt eine", FAINT, 10.5))
    out.append(text(872, 382, "Benachrichtigung. 0 schaltet es ab.", FAINT, 10.5))

    out.append(field(872, 404, 270, "SICHERUNG ANHALTEN UNTER (GB)", "5"))
    out.append(text(872, 460, "Eine laufende Sicherung hört auf, statt", FAINT, 10.5))
    out.append(text(872, 476, "die Platte vollzuschreiben.", FAINT, 10.5))

    out.append(card(872, 506, 270, 76, "#2f2513", "none", 12))
    out.append(f'    <g stroke="#e0a33f" stroke-width="1.6" fill="none"><path d="M892 546l9-16 9 16z" stroke-linejoin="round"/><path d="M901 537v5" stroke-linecap="round"/></g>\n')
    out.append(text(922, 534, "Unter der Warngrenze wird", "#e0a33f", 10.5))
    out.append(text(922, 550, "einmal gemeldet, nicht bei", "#e0a33f", 10.5))
    out.append(text(922, 566, "jedem Lauf.", "#e0a33f", 10.5))

    out.append(tail())
    return "".join(out)


def patch_sidebar(path: Path, active: str) -> None:
    """Replaces the navigation in an older picture with the current one."""
    content = path.read_text()
    start = content.index("    <!-- sidebar -->")
    end = content.index("<!-- ", start + 40)
    end = content.rindex("\n", start, end) + 1
    content = content[:start] + sidebar(active).lstrip("\n") + "\n" + content[end:]
    path.write_text(content)


# ------------------------------------------------------- dark and light in one

# Every colour of the dark theme and what it becomes in the light one. Accent,
# window buttons and the colour swatches are deliberately missing: they look
# the same either way.
LIGHT = {
    "#0d0f14": "#f3f5fa",  # window background
    "#151821": "#ffffff",  # panel
    "#11141b": "#eef1f7",  # input, inner block
    "#1b1f2a": "#f6f8fc",
    "#181c26": "#ffffff",  # button
    "#232837": "#e8ecf5",
    "#262c3a": "#dde2ee",  # border
    "#343b4d": "#c8cfdd",
    "#2a2f3d": "#c9cfdd",  # switch, off
    "#e8eaf0": "#131722",  # text
    "#9aa2b5": "#4b5568",  # muted text
    "#6b7386": "#7a8397",  # faint text
    "#221d3d": "#ede9ff",  # accent background
    "#35c489": "#15925f",  # ok
    "#3ddc97": "#15925f",
    "#12291f": "#dff5e9",  # ok background
    "#12301f": "#dff5e9",
    "#2f2513": "#fdf0d8",  # warning background
    "#e0a33f": "#a97608",  # warning
    "#f0645a": "#c0392b",  # danger
}

# The tear, as horizontal offsets every 18 pixels down the picture. Fixed on
# purpose: a random edge would make every run a new diff.
TEAR = [0, 4, -3, 6, -5, 2, -2, 7, -4, 1, 5, -6, 3, -2, 5, -3, 2, 4, -3, 3, -5, 2, 6, -4, 1, -6, 3, 5, -2]


def tear_points(height: int) -> list[tuple[int, int]]:
    """The ragged line, from the top edge down to the bottom edge."""
    top, bottom = int(W * 0.60), int(W * 0.40)
    points = []
    steps = max(height // 18, 2)
    for index in range(steps + 1):
        y = round(index * height / steps)
        x = round(top + (bottom - top) * index / steps) + TEAR[index % len(TEAR)]
        points.append((x, y))
    return points


def split(source: str) -> str:
    """Puts the dark and the light version of one picture into one file."""
    # The clip id differs between the older files (round, round2 …).
    start = source.index(">", source.index('<g clip-path="url(#round')) + 1
    end = source.rindex("</g>")
    body_dark = source[start:end]

    body_light = body_dark
    for dark, light in LIGHT.items():
        body_light = body_light.replace(dark, light)
        body_light = body_light.replace(dark.upper(), light)

    height = int(source.split('height="', 2)[1].split('"')[0])
    points = tear_points(height)
    line = " ".join(f"{x} {y}" for x, y in points)
    left = f"M0 0 L{points[0][0]} 0 L{line} L0 {height} Z"
    right = f"M{W} 0 L{points[0][0]} 0 L{line} L{W} {height} Z"

    defs_end = source.index("</defs>")
    extra = f"""    <clipPath id="tear-dark"><path d="{left}"/></clipPath>
    <clipPath id="tear-light"><path d="{right}"/></clipPath>
"""
    head_part = source[:defs_end] + extra + source[defs_end:start]

    return (
        head_part
        + f'\n    <g clip-path="url(#tear-dark)">{body_dark}</g>\n'
        + f'    <g clip-path="url(#tear-light)">{body_light}</g>\n'
        + f'    <path d="M{points[0][0]} 0 L{line}" fill="none" stroke="#7c5cff" stroke-width="2" stroke-opacity="0.75" stroke-linejoin="round"/>\n'
        + source[end:]
    )


SRC = Path("assets/screenshots/src")
OUT = Path("assets/screenshots")


def main() -> None:
    (SRC / "browser.svg").write_text(browser())
    (SRC / "statistics.svg").write_text(statistics())
    (SRC / "verify.svg").write_text(verify())
    (SRC / "transfer.svg").write_text(transfer())
    (SRC / "search.svg").write_text(search())
    (SRC / "homeassistant.svg").write_text(homeassistant())
    (SRC / "oauth.svg").write_text(oauth())
    (SRC / "notifications.svg").write_text(notifications())
    patch_sidebar(SRC / "overview.svg", "Übersicht")
    patch_sidebar(SRC / "settings.svg", "Einstellungen")

    for source in sorted(SRC.glob("*.svg")):
        (OUT / source.name).write_text(split(source.read_text()))
    print("wrote", ", ".join(sorted(p.name for p in OUT.glob("*.svg"))))


if __name__ == "__main__":
    main()
