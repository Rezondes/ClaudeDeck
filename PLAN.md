# Plan: ClaudeDeck - Stream Deck Plugin für Claude Code (Windows)

Hinweis zur Reihenfolge: Die Packages folgen den technischen Abhängigkeiten, nicht der Reihenfolge aus dem Brainstorming. Der Spike (Package 0) steht vorne, weil er entscheidet, ob ClaudeDeck in Claude Desktop überhaupt Freigaben erteilen kann.

## Überblick

| # | Package | Ziel in einem Satz | Abhängig von |
|---|---------|--------------------|--------------|
| 0 | Spike: Hooks in Desktop und CLI | Es ist belegt, welche Hooks in Claude Desktop und im CLI wie feuern und ob ein `PermissionRequest`-Hook den Desktop-Dialog ersetzt. | - |
| 1 | Projekt-Scaffold | Ein leeres, baubares Stream Deck Plugin mit Testsetup ist auf dem Stream Deck verlinkt. | 0 |
| 2 | Session-Store (Domain) | Hook-Events werden deterministisch in einen Session-Zustand pro Session übersetzt. | 1 |
| 3 | Kontext-Auslastung | Für jede Session ist der Füllstand des Kontextfensters in Prozent aus dem Transkript bekannt. | 1 |
| 4 | Hook-Server | Claude Code Hooks erreichen das Plugin per HTTP, und offene Freigaben werden bis zur Entscheidung gehalten. | 2 |
| 5 | Claude-Code-Plugin | Die ClaudeDeck-Hooks kommen über ein Claude-Code-Plugin, das sich über `/plugin` installieren, deaktivieren und entfernen lässt. | 0 |
| 6 | Key-Rendering | Alle Key-Zustände werden als SVG gerendert, passend zu den Referenz-Screenshots. | 1 |
| 7 | Allow / Always / Deny Keys | Offene Freigaben lassen sich per Tastendruck erteilen, dauerhaft für die Session erlauben oder ablehnen. | 4, 6 |
| 8 | Claude Status Key | Jeder Status-Key zeigt live Projekt, Zustand und Kontext einer Session und blinkt bei Handlungsbedarf. | 2, 3, 4, 6 |
| 9 | Fenster-Fokus | Ein Druck auf einen Status-Key holt das Fenster der Session in den Vordergrund. | 8 |
| 10 | Interrupt-Key (Go/No-Go) | Eine laufende Session lässt sich per Tastendruck unterbrechen, oder es ist dokumentiert, warum nicht. | 9 |
| 11 | Permission-Modus-Key (Go/No-Go) | Der Permission-Modus einer Session lässt sich per Tastendruck wechseln, oder es ist dokumentiert, warum nicht. | 7 |
| 12 | Desktop-Session-Katalog | Die Session-Metadaten von Claude Desktop (lokale ID, Hook-Session-ID, Ordner, Titel, letzte Aktivität) sind lesbar. | - |
| 13 | Vorbelegung der Status-Keys | Status-Keys zeigen Desktop-Sessions sofort beim Start bzw. Hinzufügen, nicht erst nach dem ersten Prompt. | 12 |
| 14 | Session-Titel als Beschriftung | Status-, Decision- und Modus-Keys beschriften Desktop-Sessions mit ihrem Titel statt dem Ordnernamen. | 13 |
| 15 | Mehrere Sessions pro Ordner | Mehrere Keys mit demselben Ordner zeigen dessen Sessions nach Aktualität verteilt; optional zeigt ein Key nur die neueste. | 13 |
| 16 | Deep Link in die Desktop-Session | Ein Druck auf einen Status-Key öffnet die Session direkt im Chatfenster von Claude Desktop. | 12 |
| 17 | Claude-Window-Actions | Je eine Action minimiert/stellt wieder her bzw. maximiert/stellt wieder her das Claude-Desktop-Fenster. | - |

Packages 2, 3 und 6 können nach Package 1 parallel laufen. Package 5 kann direkt nach Package 0 parallel zu allem anderen laufen. Packages 12 und 17 sind unabhängig voneinander; 13 bis 16 folgen auf 12 (14, 15 und 16 berühren dieselben Dateien und laufen nacheinander).

## Architektur

ClaudeDeck besteht aus zwei Plugins in einem Repo, die per HTTP auf `127.0.0.1` kommunizieren:

```
Claude Code (Desktop / CLI)
  └─ Claude-Code-Plugin "claudedeck"      claude-plugin/
       hooks/hooks.json  (type: "http", keine eigene Logik)
            │  POST http://127.0.0.1:37419/hook/<Event>
            ▼
Stream Deck Plugin "ClaudeDeck"           Repo-Root (src/, com.claudedeck.streamdeck.sdPlugin/)
  Hook-Server ─ Session-Store ─ Pending-Approvals ─ Actions/Keys
```

- Das Claude-Code-Plugin enthält nur Konfiguration. Die gesamte Logik liegt im Stream-Deck-Plugin.
- Läuft das Stream-Deck-Plugin nicht, schlägt der HTTP-Hook fehl und Claude Code fällt auf die normale Abfrage zurück (geprüft in Package 0).
- Repo-Layout: Stream-Deck-Projekt im Root, Claude-Code-Plugin in `claude-plugin/`, Marketplace-Datei in `.claude-plugin/marketplace.json`. So lässt sich das Repo später direkt per `/plugin marketplace add <github-user>/ClaudeDeck` einbinden.

## Annahmen

- Gerät: Stream Deck MK.2 (15 Tasten, 72x72 px, gerendert in 144x144 für High-DPI). Keine Dials, kein Touchstrip.
- Software auf diesem PC: Windows 11, Stream Deck 7.4.2, Node 24.19, npm 12.0.2, Claude Desktop (Code-Tab) und Claude Code CLI.
- Stack: TypeScript, offizielles SDK `@elgato/streamdeck`, Build und Linken über `@elgato/cli` (`streamdeck`), Tests mit Vitest.
- Plugin-UUID: `com.claudedeck.streamdeck`, Plugin-Ordner `com.claudedeck.streamdeck.sdPlugin`. Kann vor dem ersten Release noch geändert werden.
- Transport: Hooks vom Typ `http`, die auf `http://127.0.0.1:37419/hook/<Event>` posten. Der Port ist fest, weil er statisch in `hooks/hooks.json` steht.
- Schutz gegen Browser-Requests: Auch Webseiten können per `fetch()` an `127.0.0.1` senden. Der Hook-Server akzeptiert deshalb nur `Content-Type: application/json` (erzwingt im Browser einen CORS-Preflight, den der Server nicht beantwortet) und lehnt jeden Request mit `Origin`-Header ab. Dass Claude Code genau so sendet (JSON-Content-Type, kein `Origin`), prüft Package 0.
- `~/.claude/settings.json` wird von ClaudeDeck nie angefasst, auch nicht im Spike.
- Laut Doku: Antwortet ein `PermissionRequest`-Hook nicht, bricht ab oder läuft in einen Timeout, fällt Claude Code auf die normale Abfrage zurück. Package 0 prüft das für Desktop.
- Bei mehreren offenen Freigaben wirken Allow, Always und Deny immer auf die **älteste**. Der Key zeigt dazu Tool und Projekt.
- Wartezeit auf einen Tastendruck: 60 s, danach greift die normale Abfrage.
- Status-Key-Slots füllen sich automatisch in der Reihenfolge der Session-Starts. Optional lässt sich ein Key im Property Inspector fest an einen Projektordner binden.
- Done (grün) bleibt, bis der Key gedrückt oder ein neuer Prompt gesendet wird, spätestens 10 min lang. Danach Idle (grau). `SessionEnd` gibt den Slot frei.
- Fokus in Desktop: Nur das Fenster kommt nach vorne. Eine bestimmte Session in der Seitenleiste auszuwählen ist nicht möglich, weil kein Deep Link dokumentiert ist.
- Plugin-Hooks laufen in Claude Desktop: In der Desktop-Session, in der dieser Plan entstand, feuern `SessionStart`-Hooks anderer Plugins nachweislich. Laut Spike funktioniert `type: "http"` in Plugin-Hooks (außer `SessionStart`). Offen ist nur, ob `PermissionRequest` den Desktop-Dialog ersetzt (manuell in Package 7 AC8).
- Geparkt und nicht Teil dieses Plans: Slash-Commands im Claude-Code-Plugin (z. B. `/claudedeck status`), Plan Usage Key, macOS und Cross-Platform, Fokus auf einzelne Tabs in Windows Terminal, Veröffentlichung im Elgato Marketplace und auf GitHub, README und OpenSource-Packaging.
- Die Ruflo-Dateien im Projekt-Root (`.claude-flow/`, `.swarm/`, `ruvector.db`) gehören nicht zu ClaudeDeck und kommen in die `.gitignore`.

---

## Package 0: Spike - Hooks in Desktop und CLI

**Ziel:** Es ist belegt, welche Hooks in Claude Desktop und im CLI wie feuern und ob ein `PermissionRequest`-Hook den Desktop-Dialog ersetzt.

**Abhängigkeiten:** keine

**Betroffene Dateien:**
- `spike/echo-server.mjs` (neu, Wegwerf-Code)
- `spike/.claude-plugin/marketplace.json` (neu, lokaler Marketplace für den Spike)
- `spike/claudedeck-spike/.claude-plugin/plugin.json` (neu)
- `spike/claudedeck-spike/hooks/hooks.json` (neu)
- `docs/spike-results.md` (neu, Ergebnis)

### Kontext

Die Doku bestätigt `PermissionRequest`, `Notification`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse` und `PostToolUse` sowie HTTP-Hooks. Plugin-Hooks laufen in Desktop (in dieser Desktop-Session beobachtet). **Nicht geklärt** ist: (a) ob `type: "http"` auch in der `hooks.json` eines Plugins funktioniert, (b) ob die Entscheidung eines `PermissionRequest`-Hooks den Desktop-Dialog ersetzt, ob der Dialog parallel erscheint oder erst nach dem Hook kommt. Davon hängt die Architektur von Package 4, 5 und 7 ab. Die Hooks kommen deshalb schon im Spike als lokales Plugin, nicht über `~/.claude/settings.json`. Dieses Package ist ein manuelles Experiment, kein Produktionscode, und deshalb ohne TDD.

### Acceptance Criteria

- [ ] AC0: `docs/spike-results.md` sagt, ob `type: "http"` in der Plugin-`hooks.json` funktioniert. Falls nicht, ist ein Ersatz getestet: Command-Hook mit `node "${CLAUDE_PLUGIN_ROOT}/hooks/forward.mjs"`, der stdin an den Server weiterreicht, inklusive gemessener Verzögerung pro Aufruf.
- [ ] AC1: `docs/spike-results.md` sagt für Desktop und für das CLI je mit Ja oder Nein, ob ein HTTP-`PermissionRequest`-Hook, der nach 10 s `allow` liefert, das Tool ausführt, ohne dass ein Dialog bestätigt werden muss.
- [ ] AC2: Das Dokument beschreibt, was der Desktop-Dialog während der 10 s Wartezeit tut: nicht sichtbar, sichtbar und parallel bedienbar, oder erst nach dem Hook.
- [ ] AC3: Das Dokument beschreibt, was passiert, wenn der Nutzer den Desktop-Dialog bedient, während der Hook noch wartet: Wird die HTTP-Verbindung geschlossen, und kommt das beim Server als `close` an?
- [ ] AC4: Das Dokument beschreibt das Verhalten bei gestopptem Server (Connection refused): Fallback auf die normale Abfrage ja oder nein, Fehlermeldung in der Oberfläche ja oder nein, Verzögerung in Sekunden.
- [ ] AC5: Für jedes registrierte Event liegt ein echtes Beispiel-Payload (gekürzt) im Dokument, darunter `PermissionRequest` mit oder ohne `permission_suggestions`, sowie die Notification-Typen, die tatsächlich ankommen.
- [ ] AC5b: Das Dokument nennt die HTTP-Header, die Claude Code beim HTTP-Hook sendet, insbesondere `Content-Type` und ob ein `Origin`-Header vorhanden ist (Grundlage für Package 4 AC2b).
- [ ] AC6: Das Dokument nennt, ob `session_id`, `cwd` und `transcript_path` in Desktop-Sessions gesetzt sind und ob der Transkript-Pfad nach `~/.claude/projects/` zeigt.
- [ ] AC7: Das Dokument nennt den Prozessnamen und den Fenstertitel von Claude Desktop, das Format des Fenstertitels im Terminal bei einer CLI-Session, und woran sich Desktop- und CLI-Sessions im Payload unterscheiden lassen (Input für Package 9).
- [ ] AC8: `docs/spike-results.md` endet mit einer Go/No-Go-Entscheidung für Freigaben in Desktop. Bei No-Go nennt sie die Konsequenz: Allow, Always und Deny nur für das CLI, in Desktop nur Status.
- [ ] AC9: Nach dem Spike ist das Spike-Plugin per `/plugin uninstall claudedeck-spike` entfernt und der Spike-Marketplace per `/plugin marketplace remove claudedeck-spike` abgemeldet. `~/.claude/settings.json` wurde zu keinem Zeitpunkt von Hand geändert. (Umsetzung: Plugin nur per `--plugin-dir` geladen, Abweichung dokumentiert in `docs/spike-results.md`.)

### Tests (TDD)

Kein automatisierter Test, da Wegwerf-Code. Manuelle Checks:

1. Spike-Plugin einbinden: in Claude Desktop oder im CLI `/plugin marketplace add F:\Code\ClaudeDeck\spike`, dann `/plugin install claudedeck-spike@claudedeck-spike`. Danach Desktop und CLI neu starten.
2. `node spike/echo-server.mjs` starten. Der Server loggt jeden Request mit Zeitstempel als JSON und antwortet auf `PermissionRequest` nach 10 s mit `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`. Er loggt `req.on('close')`.
3. In Desktop eine neue Session öffnen und einen Bash-Befehl anfordern, der nicht erlaubt ist, z. B. `whoami`. Beobachten und mitschreiben (AC1, AC2).
4. Wiederholen und dabei den Desktop-Dialog vor Ablauf der 10 s bedienen (AC3).
5. Server stoppen und wiederholen (AC4).
6. Schritte 3 bis 5 im CLI (`claude` in Windows Terminal).
7. Einen Prompt mit `AskUserQuestion` provozieren und eine Session normal beenden, um die Notification-, Stop- und SessionEnd-Payloads zu sehen (AC5).
8. Fenster prüfen: `Get-Process | Where-Object MainWindowTitle | Select-Object ProcessName, MainWindowTitle` (AC7).
9. Kommt in Schritt 3 kein Request beim Server an, `type: "http"` durch den Command-Hook-Ersatz aus AC0 ersetzen und die Schritte 3 bis 8 wiederholen.
10. Spike-Plugin und Marketplace entfernen (AC9).

Testbefehl: keiner (manuell).

### Umsetzungsschritte

1. `spike/echo-server.mjs` mit `node:http` schreiben, ohne Abhängigkeiten.
2. Spike-Plugin anlegen: `plugin.json` mit `name: "claudedeck-spike"`, `hooks/hooks.json` mit HTTP-Hooks für `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification` und `Stop`, jeweils `"timeout": 60`, sowie `marketplace.json`, die auf `./claudedeck-spike` zeigt.
3. Plugin einbinden, Claude Desktop und das CLI neu starten.
4. Manuelle Checks 3 bis 9 durchführen und Ergebnisse in `docs/spike-results.md` festhalten.
5. Plugin entfernen, Go/No-Go eintragen.

### Out of Scope

- Produktionsreifer Server (Package 4).
- Endgültiges Claude-Code-Plugin (Package 5).
- Interrupt und Moduswechsel (Package 10 und 11 haben eigene Spikes).

---

## Package 1: Projekt-Scaffold

**Ziel:** Ein leeres, baubares Stream Deck Plugin mit Testsetup ist auf dem Stream Deck verlinkt.

**Abhängigkeiten:** Package 0 (nur bei Go oder eingeschränktem Go sinnvoll)

**Betroffene Dateien:**
- `package.json` (neu)
- `tsconfig.json` (neu)
- `rollup.config.mjs` (neu, aus dem `streamdeck create`-Template)
- `vitest.config.ts` (entfällt, Vitest-Defaults reichen)
- `.gitignore` (neu)
- `com.claudedeck.streamdeck.sdPlugin/manifest.json` (neu)
- `com.claudedeck.streamdeck.sdPlugin/imgs/` (neu, Platzhalter-Icons)
- `src/plugin.ts` (neu)
- `src/plugin.test.ts` (neu)

### Kontext

Das Projekt ist leer. Das Stream Deck CLI ist nicht installiert. Das offizielle Template (`streamdeck create`) liefert TypeScript, Rollup und das Manifest. Vitest kommt dazu. Im Manifest werden die Actions schon angelegt (Allow, Always, Deny, Status, Interrupt, Mode), damit spätere Packages nur Logik ergänzen.

### Acceptance Criteria

- [ ] AC1: `npm run build` erzeugt `com.claudedeck.streamdeck.sdPlugin/bin/plugin.js` ohne Fehler.
- [ ] AC2: `npm test` läuft durch und führt mindestens einen Test aus.
- [ ] AC3: `streamdeck link com.claudedeck.streamdeck.sdPlugin` ist erfolgt. Nach `npm run reload` erscheint "ClaudeDeck" mit allen Actions (fünf, seit Interrupt durch das No-Go in Package 10 entfallen ist) in der Stream Deck App (manueller Check).
- [ ] AC4: `manifest.json` deklariert `"OS": [{ "Platform": "windows", "MinimumVersion": "10" }]` und `"Software": { "MinimumVersion": "7.1" }` (SDK 3 des `@elgato/streamdeck`-Pakets verlangt 7.1).
- [ ] AC5: `.gitignore` enthält `node_modules/`, `*.sdPlugin/bin/`, `*.log`, `.claude-flow/`, `.swarm/`, `ruvector.db` (bereits vor Package 0 angelegt).

### Tests (TDD)

1. `src/plugin.test.ts > "manifest declares all ClaudeDeck actions"` - deckt AC3 teilweise und AC4 ab
   - Gegeben: `manifest.json` wird als JSON eingelesen.
   - Erwartet: UUIDs `com.claudedeck.streamdeck.allow`, `.always`, `.deny`, `.status`, `.interrupt`, `.mode` sind vorhanden, Plattform ist `windows`, `Software.MinimumVersion` ist `7.1`.

Testbefehl: `npm test` (wird in diesem Package als `vitest run` angelegt)

### Umsetzungsschritte

1. `npm i -D @elgato/cli` (lokal statt global, Aufruf per `npx streamdeck`, `npm run link`, `npm run reload`; `streamdeck restart` startet das Plugin nicht zuverlässig neu, `reload` beendet den Plugin-Prozess und Stream Deck startet ihn nach etwa 10 s neu).
2. Dateien aus `node_modules/@elgato/cli/template` von Hand übernehmen (`streamdeck create` ist interaktiv), UUID `com.claudedeck.streamdeck`.
3. `npm i -D vitest`, Script `"test": "vitest run"` ergänzen.
4. Test schreiben, rot sehen (Actions fehlen im Manifest).
5. Actions im Manifest eintragen, Test grün.
6. `.gitignore` anlegen, `npm run build`, `streamdeck link`, manuell in der App prüfen.

### Out of Scope

- Jede Action-Logik (ab Package 7).
- Eigene Icons im finalen Look (Package 6).

---

## Package 2: Session-Store (Domain)

**Ziel:** Hook-Events werden deterministisch in einen Session-Zustand pro Session übersetzt.

**Abhängigkeiten:** Package 1

**Betroffene Dateien:**
- `src/domain/session-store.ts` (neu)
- `src/domain/session-store.test.ts` (neu)
- `src/domain/hook-event.ts` (neu, Typen der Payloads aus `docs/spike-results.md`)

### Kontext

Der Status-Key braucht pro Session einen von fünf Zuständen: `working`, `approval`, `input`, `done`, `idle`. Diese Logik ist reine Domain ohne IO und wird zuerst gebaut, damit Server und Keys nur noch anschließen. Die Zeit kommt über eine injizierte Uhr (`now: () => number`), damit der Übergang von Done zu Idle nach 10 min ohne echtes Warten testbar ist.

Mapping (endgültig anhand der Spike-Payloads):

| Event | Neuer Zustand |
|-------|---------------|
| erstes Event einer unbekannten Session (es gibt keinen `SessionStart`, HTTP-Hooks werden dafür nicht unterstützt, siehe Spike) | Session anlegen, Slot zuweisen, dann wie das Event selbst |
| `UserPromptSubmit`, `PreToolUse` (außer `AskUserQuestion`), `PostToolUse` | `working` |
| `PreToolUse` mit `tool_name == "AskUserQuestion"`, `Notification` vom Typ `elicitation_dialog` oder `agent_needs_input` | `input` |
| `PermissionRequest` | `approval` (Zähler `pendingApprovals` +1; Anzeige bleibt `approval`, solange der Zähler > 0 ist, auch wenn parallele Subagents derselben Session weitere Events senden) |
| Freigabe entschieden, Timeout oder Abbruch (intern vom Hook-Server, `approvalDecided`) | Zähler -1, bei 0 der zuletzt aus Events abgeleitete Zustand |
| `Stop` | `done` |
| `done` und 10 min ohne Event, oder Key gedrückt | `idle` |
| `SessionEnd` | Session entfernen, Slot frei |

### Acceptance Criteria

- [ ] AC1: Jede Zeile der Mapping-Tabelle führt vom vorherigen Zustand zum angegebenen neuen Zustand.
- [ ] AC2: Sessions bekommen Slots `0..n` in der Reihenfolge ihres ersten Events. Ein durch `SessionEnd` frei gewordener Slot wird von der nächsten neuen Session belegt.
- [ ] AC3: Eine Session mit einem `cwd`, der an einen Slot gepinnt ist, landet immer in diesem Slot. Andere Sessions überspringen gepinnte Slots.
- [ ] AC4: Ein Event für eine unbekannte `session_id` (z. B. weil das Plugin nach dem Session-Start gestartet wurde) legt die Session implizit an, statt das Event zu verwerfen.
- [ ] AC5: `done` wird nach genau 10 min ohne weiteres Event zu `idle`, bei 9:59 min nicht.
- [ ] AC6: Der Projektname einer Session ist der letzte Pfadteil von `cwd`, z. B. `F:\Code\ClaudeDeck` wird zu `ClaudeDeck`.
- [ ] AC7: Der Store meldet Änderungen über einen Listener (`onChange(sessionId)`), genau einmal pro tatsächlicher Zustandsänderung.

### Tests (TDD)

1. `session-store.test.ts > "maps each hook event to its session state"` (tabellengetrieben mit `it.each`) - AC1
   - Gegeben: Session im Ausgangszustand, Event aus der Tabelle.
   - Erwartet: neuer Zustand laut Tabelle.
2. `> "assigns slots in start order and reuses freed slots"` - AC2
   - Gegeben: Start A, B, C, Ende B, Start D.
   - Erwartet: A=0, C=2, D=1.
3. `> "pinned cwd always gets its slot"` - AC3
   - Gegeben: Slot 0 gepinnt auf `F:\Code\api-svc`, Start von `F:\Code\web-app`, dann `F:\Code\api-svc`.
   - Erwartet: web-app=1, api-svc=0.
4. `> "creates unknown session implicitly"` - AC4
   - Gegeben: leerer Store, `PreToolUse` für `session_id` `x`.
   - Erwartet: Session `x` existiert mit `working`.
5. `> "done turns idle after 10 minutes"` - AC5
   - Gegeben: Fake-Uhr, `Stop` bei t=0.
   - Erwartet: bei t=599 999 ms `done`, bei t=600 000 ms `idle`.
6. `> "project name is last cwd segment"` - AC6
   - Gegeben: `cwd` `F:\Code\ClaudeDeck` und `F:\Code\ClaudeDeck\`.
   - Erwartet: beide ergeben `ClaudeDeck`.
7. `> "notifies listener once per real change"` - AC7
   - Gegeben: zweimal `PreToolUse` hintereinander.
   - Erwartet: Listener genau einmal aufgerufen.

Testbefehl: `npm test`

### Umsetzungsschritte

1. Payload-Typen aus `docs/spike-results.md` in `hook-event.ts` übernehmen.
2. Tests 1 bis 7 nacheinander rot, minimal grün, refactor.
3. Done-zu-Idle über eine `tick()`-Methode mit injizierter Uhr lösen (kein `setTimeout` im Store, der Aufrufer ruft `tick()` periodisch).

### Out of Scope

- Kontext-Prozent (Package 3).
- HTTP und Warteschlange offener Freigaben (Package 4).

---

## Package 3: Kontext-Auslastung

**Ziel:** Für jede Session ist der Füllstand des Kontextfensters in Prozent aus dem Transkript bekannt.

**Abhängigkeiten:** Package 1

**Betroffene Dateien:**
- `src/domain/context-usage.ts` (neu)
- `src/domain/context-usage.test.ts` (neu)
- `test/fixtures/transcript-sample.jsonl` (neu, gekürzt und anonymisiert aus einem echten Transkript)

### Kontext

Jeder Hook liefert `transcript_path`. Das Transkript ist JSONL, assistant-Einträge enthalten `message.usage` mit `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` und `output_tokens` (geprüft an `~/.claude/projects/F--Code-ClaudeDeck/*.jsonl`, also auch für Desktop-Sessions). Die aktuelle Kontextgröße ist die Summe dieser Werte im **letzten** assistant-Eintrag, der nicht Sidechain ist. Das Limit: `1 000 000`, wenn die Modell-ID `[1m]` enthält **oder** mehr als 200 000 Tokens belegt sind (echte Transkripte enthalten `[1m]` nie, siehe Review), sonst `200 000`. Transkripte können groß werden, deshalb wird nur das Dateiende gelesen.

### Acceptance Criteria

- [ ] AC1: Für die Fixture liefert `readContextUsage(path)` den erwarteten Prozentwert (gerundet auf eine ganze Zahl).
- [ ] AC2: Einträge mit `"isSidechain": true` (Subagents) werden ignoriert.
- [ ] AC3: Es werden höchstens die letzten 256 KiB der Datei gelesen.
- [ ] AC4: Fehlt die Datei, ist sie leer oder enthält sie keinen usage-Eintrag, ist das Ergebnis `null` statt einer Exception.
- [ ] AC5: Eine unvollständige letzte Zeile (Datei wird gerade geschrieben) wird übersprungen.
- [ ] AC6: Werte über 100 % werden auf 100 begrenzt.

### Tests (TDD)

1. `context-usage.test.ts > "computes percent from last assistant usage"` - AC1
   - Gegeben: Fixture mit zwei assistant-Einträgen, der letzte summiert 60 000 Tokens, Modell ohne `[1m]`.
   - Erwartet: `30`.
2. `> "ignores sidechain entries"` - AC2
   - Gegeben: letzter Eintrag ist Sidechain mit 190 000 Tokens, davor Haupteintrag mit 20 000.
   - Erwartet: `10`.
3. `> "reads only the file tail"` - AC3
   - Gegeben: Datei mit 1 MiB Füllzeilen am Anfang, usage am Ende, Lesefunktion als Spy injiziert.
   - Erwartet: gelesene Bytes kleiner oder gleich 262 144.
4. `> "returns null for missing or empty files"` - AC4
5. `> "skips a truncated last line"` - AC5
   - Gegeben: letzte Zeile ist abgeschnittenes JSON.
   - Erwartet: Wert aus der vorletzten gültigen Zeile.
6. `> "uses 1M limit for [1m] models and clamps to 100"` - AC6

Testbefehl: `npm test`

### Umsetzungsschritte

1. Fixture aus einem echten Transkript bauen, Inhalte entfernen, nur `type`, `isSidechain`, `message.model` und `message.usage` behalten.
2. Tests 1 bis 6 in TDD-Reihenfolge.
3. Tail-Lesen mit `fs.promises.open` und `read` ab `size - 256 KiB`.

### Out of Scope

- Wann neu gelesen wird (Package 8: bei `PostToolUse`, `Stop` und `UserPromptSubmit`).
- Genaue Kontextgrößen pro Modell über `200k` und `1M` hinaus.

---

## Package 4: Hook-Server

**Ziel:** Claude Code Hooks erreichen das Plugin per HTTP, und offene Freigaben werden bis zur Entscheidung gehalten.

**Abhängigkeiten:** Package 2

**Betroffene Dateien:**
- `src/server/hook-server.ts` (neu)
- `src/server/hook-server.test.ts` (neu)
- `src/server/pending-approvals.ts` (neu)
- `src/server/pending-approvals.test.ts` (neu)
- `src/plugin.ts` (ändern: Server starten)

### Kontext

Der Server läuft im Plugin-Prozess und lauscht nur auf `127.0.0.1`. Jeder Event wird an den Session-Store weitergegeben. `PermissionRequest` ist besonders: Die HTTP-Antwort wird zurückgehalten, bis eine Taste gedrückt wird, 60 s vergangen sind oder Claude die Verbindung schließt (laut Spike AC3). Die Warteschlange ist FIFO. Die URL-Struktur `/hook/<Event>` ist der Vertrag mit dem Claude-Code-Plugin (Package 5). Gegen Requests aus Webseiten im Browser prüft der Server `Content-Type` und `Origin` (siehe Annahmen).

### Acceptance Criteria

- [ ] AC1: Der Server bindet ausschließlich an `127.0.0.1:37419` (fester Port, siehe Annahmen).
- [ ] AC2: Requests auf andere Pfade als `POST /hook/<Event>` oder mit ungültigem JSON-Body werden mit `404` bzw. `400` beantwortet und nicht an den Store weitergegeben. Bodies über 1 MiB werden mit `413` abgelehnt. Payloads, in denen `session_id` oder `cwd` kein String ist, werden mit `400` abgelehnt (der Session-Store vertraut diesen Feldern).
- [ ] AC2b: Requests mit `Origin`-Header oder mit einem anderen `Content-Type` als `application/json` werden mit `403` bzw. `415` abgelehnt und nicht an den Store weitergegeben. `OPTIONS`-Preflights bekommen `405` ohne CORS-Header.
- [ ] AC3: Nicht-blockierende Events (`UserPromptSubmit`, `PreToolUse`, ...) werden sofort mit `200` und dem JSON-Body `{}` beantwortet und an den Store weitergegeben.
- [ ] AC4: Ein `PermissionRequest` landet in der Warteschlange. Die Antwort kommt erst nach `approve()`, `approveAlways()`, `deny()` oder Timeout.
- [ ] AC5: `approve()` beantwortet die älteste offene Anfrage mit `decision.behavior = "allow"`, `deny()` mit `"deny"` und der `message` "Denied via ClaudeDeck".
- [ ] AC6: `approveAlways()` beantwortet mit `allow` und `updatedPermissions` mit `"destination": "session"`. Übernommen werden nur Vorschläge vom Typ `addRules` und `addDirectories` aus `permission_suggestions`, **nie `setMode`** (siehe Spike). Ist danach nichts übrig, wird eine Regel `{ "type": "addRules", "rules": [{ "toolName": <tool_name> }], "behavior": "allow", "destination": "session" }` erzeugt.
- [ ] AC7: Nach 60 s ohne Entscheidung antwortet der Server mit `{}` (keine Entscheidung), damit Claude die normale Abfrage zeigt, und entfernt die Anfrage aus der Warteschlange.
- [ ] AC8: Schließt der Client die Verbindung vorher, wird die Anfrage aus der Warteschlange entfernt und der Store bekommt "Freigabe entschieden".
- [ ] AC9: Ist der Port belegt, loggt das Plugin einen Fehler und läuft weiter (Keys zeigen "offline"), statt abzustürzen.
- [ ] AC10: Bei leerer Warteschlange sind `approve()`, `approveAlways()` und `deny()` ohne Wirkung und werfen keinen Fehler.

### Tests (TDD)

1. `pending-approvals.test.ts > "resolves oldest request first"` - AC4, AC5
   - Gegeben: Anfragen A (t=0) und B (t=1).
   - Erwartet: `approve()` löst A mit `allow` auf, B wartet weiter.
2. `> "deny resolves with deny and message"` - AC5
3. `> "always uses session-scoped suggestions"` - AC6
   - Gegeben: Anfrage mit `permission_suggestions` (Beispiel aus dem Spike), dann eine ohne.
   - Erwartet: `updatedPermissions` enthält die Vorschläge mit `destination: "session"`, im zweiten Fall eine Regel für `tool_name`.
4. `> "times out after 60s with empty decision"` - AC7 (Fake-Timer von Vitest)
5. `> "cancel removes request"` - AC8
6. `> "no-op on empty queue"` - AC10
7. `hook-server.test.ts > "rejects unknown paths, invalid JSON and oversized bodies"` - AC2 (echter Server auf Port `0`, `fetch` aus Node)
7b. `> "rejects browser-style requests"` - AC2b
   - Gegeben: POST mit `Origin: https://evil.example`, POST mit `Content-Type: text/plain`, `OPTIONS`-Request.
   - Erwartet: `403`, `415`, `405`, keine `Access-Control-Allow-*`-Header, Store unverändert.
8. `> "answers non-blocking events immediately and forwards to store"` - AC3
9. `> "holds PermissionRequest until approve"` - AC4
10. `> "client abort cancels pending request"` - AC8 (`AbortController` beim `fetch`)
11. `> "binds to loopback only"` - AC1 (`server.address().address === "127.0.0.1"`)
12. `> "port in use does not throw"` - AC9

Testbefehl: `npm test`

### Umsetzungsschritte

1. `pending-approvals.ts` als reine Klasse mit injiziertem Timer, Tests 1 bis 6.
2. `hook-server.ts` mit `node:http`, Port als Parameter (Tests nutzen `0`), Tests 7 bis 12.
3. In `src/plugin.ts` Server starten, Store und Warteschlange verdrahten.

### Out of Scope

- Eintragen der Hooks (Package 5).
- Keys, die `approve()` und Co. auslösen (Package 7).

---

## Package 5: Claude-Code-Plugin

**Ziel:** Die ClaudeDeck-Hooks kommen über ein Claude-Code-Plugin, das sich über `/plugin` installieren, deaktivieren und entfernen lässt.

**Abhängigkeiten:** Package 0

**Betroffene Dateien:**
- `.claude-plugin/marketplace.json` (neu, Repo-Root)
- `claude-plugin/.claude-plugin/plugin.json` (neu)
- `claude-plugin/hooks/hooks.json` (neu)
- `src/server/hook-contract.ts` (neu, gemeinsame Konstante für Port und URL)
- `test/claude-plugin.test.ts` (neu)

### Kontext

Statt eines Installers, der `~/.claude/settings.json` ändert, liefert ClaudeDeck die Hooks als eigenes Claude-Code-Plugin. Das löst drei Probleme auf einmal: Deine Settings werden nie angefasst, das fehlende Uninstall-Event im Stream Deck SDK spielt keine Rolle mehr (Entfernen geht über `/plugin uninstall claudedeck`), und das Repo ist später direkt als Marketplace nutzbar. Das Plugin enthält nur Konfiguration. Event-Liste und Hook-Format kommen aus `docs/spike-results.md`. Der Vertrag mit dem Stream-Deck-Plugin ist `POST http://127.0.0.1:37419/hook/<Event>` (Package 4).

Erwartete Form eines Eintrags in `hooks.json` (endgültig laut Spike):

```json
{
  "hooks": {
    "PermissionRequest": [
      { "hooks": [ { "type": "http", "url": "http://127.0.0.1:37419/hook/PermissionRequest", "timeout": 65 } ] }
    ]
  }
}
```

### Acceptance Criteria

- [ ] AC1: `hooks.json` enthält genau einen Eintrag pro Event aus `docs/spike-results.md` (`SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`).
- [ ] AC2: Jede URL hat die Form `http://127.0.0.1:37419/hook/<Event>`, wobei `<Event>` genau dem Schlüssel des Eintrags entspricht.
- [ ] AC3: `PermissionRequest` hat `"timeout": 65` (5 s Puffer über den 60 s des Servers), alle anderen Events `"timeout": 5`.
- [ ] AC4: `plugin.json` hat `name: "claudedeck"`, eine Versionsnummer und eine Beschreibung. `marketplace.json` im Repo-Root listet das Plugin mit `source: "./claude-plugin"`.
- [ ] AC5: Port und URL-Präfix stehen in genau einer Konstante im Stream-Deck-Code (`src/server/hook-contract.ts`). Ein Test stellt sicher, dass `hooks.json` dieselben Werte verwendet, damit beide Seiten nicht auseinanderlaufen.
- [ ] AC6: entfällt laut Spike AC0 (HTTP-Hooks funktionieren in Plugins, kein `forward.mjs` nötig).
- [ ] AC7: Manueller Check: `/plugin marketplace add F:\Code\ClaudeDeck` und `/plugin install claudedeck@claudedeck` in Desktop, dann Neustart. Events kommen beim laufenden Stream-Deck-Plugin an. Nach `/plugin disable claudedeck` kommen keine Events mehr, und Freigaben laufen wieder normal über Desktop. (Verschoben in den End-to-End-Check von Package 7 AC8, da der Hook-Server erst mit Package 4 existiert. Vorab belegt: Lauf per `--plugin-dir` im CLI liefert alle Events.)

### Tests (TDD)

1. `test/claude-plugin.test.ts > "hooks.json registers every required event once"` - AC1
   - Gegeben: `claude-plugin/hooks/hooks.json` wird eingelesen.
   - Erwartet: Die Event-Schlüssel entsprechen exakt der Liste, jeder mit genau einem Hook.
2. `> "every hook url matches its event and the shared contract"` - AC2, AC5
   - Gegeben: `HOOK_BASE_URL` aus `src/server/hook-contract.ts`.
   - Erwartet: Für jeden Eintrag gilt `url === HOOK_BASE_URL + "/" + eventName`.
3. `> "timeouts are 65s for PermissionRequest and 5s otherwise"` - AC3
4. `> "plugin and marketplace manifests are consistent"` - AC4
   - Erwartet: `marketplace.plugins[0].name === plugin.name === "claudedeck"`, `source === "./claude-plugin"`.

Testbefehl: `npm test`

### Umsetzungsschritte

1. `src/server/hook-contract.ts` mit `HOOK_PORT = 37419` und `HOOK_BASE_URL` anlegen. Package 4 nutzt diese Konstante (ist Package 4 schon fertig, dort den Literalwert ersetzen).
2. Tests 1 bis 4 schreiben, rot sehen.
3. `plugin.json`, `hooks.json` und `marketplace.json` anlegen, Tests grün.
4. Manueller Check AC7.

### Out of Scope

- Slash-Commands wie `/claudedeck status` (geparkt).
- Veröffentlichung auf GitHub (geparkt).

---

## Package 6: Key-Rendering

**Ziel:** Alle Key-Zustände werden als SVG gerendert, passend zu den Referenz-Screenshots.

**Abhängigkeiten:** Package 1

**Betroffene Dateien:**
- `src/render/status-key.ts` (neu)
- `src/render/decision-key.ts` (neu)
- `src/render/colors.ts` (neu)
- `src/render/render.test.ts` (neu)
- `src/render/__snapshots__/` (neu, von Vitest erzeugt)

### Kontext

Das SDK nimmt per `setImage()` SVG als Data-URL entgegen. Reine Funktionen ohne IO, damit sie per Snapshot testbar sind. Design laut Screenshots:

- **Status-Key** (144x144): abgerundeter Rahmen mit Glow in der Zustandsfarbe, dunkler Hintergrund mit Farbverlauf. Oben groß der Projektname, darunter links das Statuslabel in der Zustandsfarbe, rechts der Kontext in Prozent, darunter ein Balken.
- Zustandsfarben: `working` blau `#2F7BFF`, `approval` gelb `#F5C518`, `input` lila `#B05CE6`, `done` grün `#2FBF5B`, `idle` grau `#8A8F98`.
- Kontextfarbe (Prozentwert und Balken): unter 50 % grün, 50 bis 79 % gelb, ab 80 % rot.
- **Allow / Always / Deny:** Im Ruhezustand dunkel mit Rahmen in der Akzentfarbe (Allow grün mit `✓`, Always gelb mit `✓∞`, Deny rot mit `✕`) und gedimmtem Label. Bei offener Freigabe vollflächig in der Akzentfarbe, weißes Symbol und Label, darunter Tool-Name und Befehls-Vorschau.
- Befehls-Vorschau: bei `Bash` der Befehl, bei `Edit`, `Write` und `Read` der Dateiname, sonst nichts. Maximal 12 Zeichen, sonst mit `…` gekürzt.

### Acceptance Criteria

- [ ] AC1: `renderStatusKey({ project, state, contextPercent })` liefert für jeden der fünf Zustände ein gültiges SVG 144x144 mit Projektname, Statuslabel (Working, Approve, Input, Done, Idle) und Prozentwert.
- [ ] AC2: Die Kontextfarbe wechselt bei 50 % und 80 % (Grenzen: 49 grün, 50 gelb, 79 gelb, 80 rot).
- [ ] AC3: `contextPercent = null` zeigt `--` und keinen Balken.
- [ ] AC4: Projektnamen länger als 10 Zeichen werden mit `…` gekürzt, Sonderzeichen wie `<` und `&` werden XML-escaped.
- [ ] AC5: `renderDecisionKey({ kind, pending })` liefert den gedimmten Zustand für `pending = null` und sonst den leuchtenden Zustand mit Tool-Name und Vorschau.
- [ ] AC6: `commandPreview` liefert `npm test` für `Bash` mit `{ command: "npm test" }`, `plugin.ts` für `Edit` mit `file_path` `F:\Code\ClaudeDeck\src\plugin.ts` und kürzt längere Werte auf 12 Zeichen inklusive `…`.
- [ ] AC7: Ein Flash-Frame (`flash: true`) des Status-Keys hat einen hellen Rahmen ohne Glow, sonst identisch.
- [ ] AC8: Die Optik entspricht den Screenshots (manueller Check auf dem echten Stream Deck nach Package 7 und 8).

### Tests (TDD)

1. `render.test.ts > "status key renders each state"` (`it.each` über fünf Zustände, Snapshot plus Prüfung, dass Label und Prozentwert im SVG vorkommen) - AC1
2. `> "context color thresholds"` - AC2
3. `> "null context shows placeholder"` - AC3
4. `> "truncates and escapes project names"` - AC4
5. `> "decision key idle vs pending"` - AC5
6. `> "command preview per tool"` - AC6
7. `> "flash frame differs only in border"` - AC7

Testbefehl: `npm test`

### Umsetzungsschritte

1. `colors.ts` mit Farbtabelle und `contextColor(percent)`.
2. Tests in obiger Reihenfolge, jeweils minimal implementieren.
3. SVG als Template-String, Ausgabe als `data:image/svg+xml;charset=utf8,` mit `encodeURIComponent`.

### Out of Scope

- Animation und Timer fürs Blinken (Package 8).

---

## Package 7: Allow / Always / Deny Keys

**Ziel:** Offene Freigaben lassen sich per Tastendruck erteilen, dauerhaft für die Session erlauben oder ablehnen.

**Abhängigkeiten:** Package 4, Package 6

**Betroffene Dateien:**
- `src/actions/decision-action.ts` (neu, eine Klasse für alle drei Keys, parametrisiert mit `kind`)
- `src/actions/decision-action.test.ts` (neu)
- `src/plugin.ts` (ändern: Actions registrieren)

### Kontext

Die drei Keys zeigen immer die **älteste** offene Freigabe aus `PendingApprovals` (Package 4). Bei mehreren offenen Anfragen erscheint unter dem Tool-Namen der Projektname, z. B. `Bash · api-svc`, damit klar ist, welche Session gemeint ist. Die Action-Klasse bekommt `PendingApprovals` und eine `KeyView`-Schnittstelle (dünner Wrapper um `action.setImage`) injiziert, damit sie ohne Stream Deck testbar ist.

### Acceptance Criteria

- [ ] AC1: Ohne offene Freigabe zeigen alle drei Keys den gedimmten Zustand.
- [ ] AC2: Kommt eine Freigabe herein, wechseln alle sichtbaren Allow-, Always- und Deny-Keys im selben Event-Loop-Durchlauf in den leuchtenden Zustand mit Tool-Name und Vorschau.
- [ ] AC3: Druck auf Allow ruft `approve()` auf, auf Always `approveAlways()`, auf Deny `deny()`.
- [ ] AC4: Nach der Entscheidung zeigen die Keys die nächste offene Freigabe oder wieder den gedimmten Zustand.
- [ ] AC5: Bei zwei oder mehr offenen Freigaben enthält das Label zusätzlich den Projektnamen.
- [ ] AC6: Druck ohne offene Freigabe hat keine Wirkung und zeigt kein `showAlert()`.
- [ ] AC7: Ist der Hook-Server offline (Package 4 AC9), zeigen die Keys im gedimmten Zustand den Text `offline`.
- [ ] AC8: Manueller End-to-End-Check in Claude Desktop: Bash-Befehl anfordern, Allow auf dem Stream Deck drücken, der Befehl läuft. Dasselbe mit Deny (Befehl wird abgelehnt) und Always (ein zweiter gleichartiger Befehl in derselben Session fragt nicht mehr, in einer neuen Session schon). Nur wenn Package 0 Go ergeben hat, sonst im CLI.

### Tests (TDD)

1. `decision-action.test.ts > "dim when no pending approval"` - AC1
2. `> "lights up on new pending approval"` - AC2
3. `> "key press maps to queue decision"` (`it.each` über allow, always, deny) - AC3
4. `> "shows next pending after decision"` - AC4
5. `> "adds project name when multiple pending"` - AC5
6. `> "press without pending is a no-op"` - AC6
7. `> "shows offline when server down"` - AC7

Testbefehl: `npm test`

### Umsetzungsschritte

1. `KeyView`-Schnittstelle und Fake für Tests definieren.
2. Tests 1 bis 7 in TDD-Reihenfolge.
3. In `src/plugin.ts` drei Actions registrieren, die dieselbe Klasse mit unterschiedlichem `kind` nutzen. Umgesetzt ohne Decorator: `src/actions/key-adapter.ts` (setzt `manifestId` direkt) leitet Stream-Deck-Events an testbare Controller weiter, `src/actions/key-view.ts` ist die schmale Schnittstelle dafür.
4. `npm run build`, `npm run reload`, manueller Check AC8.

### Out of Scope

- Moduswechsel beim Freigeben (Package 11).

---

## Package 8: Claude Status Key

**Ziel:** Jeder Status-Key zeigt live Projekt, Zustand und Kontext einer Session und blinkt bei Handlungsbedarf.

**Abhängigkeiten:** Package 2, Package 3, Package 4, Package 6

**Betroffene Dateien:**
- `src/actions/status-action.ts` (neu)
- `src/actions/status-action.test.ts` (neu)
- `src/actions/slot-registry.ts` (neu)
- `src/actions/slot-registry.test.ts` (neu)
- `com.claudedeck.streamdeck.sdPlugin/ui/status.html` (neu, Property Inspector)
- `src/plugin.ts` (ändern)

### Kontext

Wie beim Original gilt: So viele Status-Keys wie platziert, so viele Sessions werden angezeigt. Die Keys werden nach Position auf dem Gerät (Zeile, dann Spalte, aus `ev.action.coordinates`) sortiert und bekommen Slot 0, 1, 2, ... Der Session-Store (Package 2) ordnet Sessions den Slots zu. Ein Key ohne Session zeigt einen leeren, dunklen Zustand. `approval` und `input` blinken (Wechsel zwischen Normal- und Flash-Frame alle 500 ms). Die Kontext-Prozente werden nach `PostToolUse`, `Stop` und `UserPromptSubmit` neu gelesen (Package 3), höchstens einmal pro 2 s pro Session. Dafür braucht der Status-Key die rohen Events vom Hook-Server (der `onChange` des Stores feuert nur bei Zustandsänderungen). Liefert `readContextUsage` `null`, bleibt der letzte Wert stehen. Der Store bekommt hier einen Zugriff auf alle Sessions (`sessions()`). Pins müssen vor dem Start des Hook-Servers gesetzt werden, oder `setPins` ordnet laufende Sessions neu zu (Hinweis aus dem Review von Package 2). Der Property Inspector bietet "An Projektordner binden" (Pfad-Eingabe).

### Acceptance Criteria

- [ ] AC1: Status-Keys bekommen Slots nach Geräteposition (oben links = 0, zeilenweise), unabhängig von der Reihenfolge, in der sie erscheinen.
- [ ] AC2: Entfernt man einen Status-Key, rücken die Slots der anderen nach.
- [ ] AC3: Ein Key mit zugeordneter Session zeigt Projektname, Zustand und Kontext gemäß Package 6. Ein Key ohne Session zeigt den leeren Zustand.
- [ ] AC4: Eine Zustandsänderung im Store aktualisiert nur den Key der betroffenen Session.
- [ ] AC5: Im Zustand `approval` oder `input` wechselt der Key alle 500 ms zwischen Normal- und Flash-Frame. In allen anderen Zuständen läuft kein Timer.
- [ ] AC6: Der Kontext wird nach `PostToolUse`, `Stop` und `UserPromptSubmit` neu gelesen, höchstens einmal je 2 s pro Session.
- [ ] AC7: Ein im Property Inspector eingetragener Projektordner pinnt den Slot (Package 2 AC3) und bleibt nach einem Neustart des Plugins erhalten (Action-Settings).
- [ ] AC8: Druck auf einen Key im Zustand `done` setzt ihn auf `idle` (Package 2). Der Fenster-Fokus kommt in Package 9 dazu.
- [ ] AC9: Manueller Check mit drei parallelen Desktop-Sessions: drei Keys zeigen drei Projekte, Zustände wechseln live, `approval` blinkt.

### Tests (TDD)

1. `slot-registry.test.ts > "orders keys by device position"` - AC1
   - Gegeben: Keys erscheinen in der Reihenfolge (2,0), (0,0), (1,0) als (Spalte, Zeile).
   - Erwartet: Slots (0,0)=0, (1,0)=1, (2,0)=2.
2. `> "reassigns slots when a key disappears"` - AC2
3. `status-action.test.ts > "renders session or empty state"` - AC3
4. `> "updates only affected key"` - AC4
5. `> "flashes only in approval and input"` - AC5 (Fake-Timer)
6. `> "throttles context reads to 2s per session"` - AC6
7. `> "pinned project survives restart"` - AC7 (Settings-Fake)
8. `> "press on done sets idle"` - AC8

Testbefehl: `npm test`

### Umsetzungsschritte

1. `slot-registry.ts` mit Tests 1 und 2.
2. `status-action.ts` mit injiziertem Store, Kontextleser und `KeyView`, Tests 3 bis 8.
3. Property Inspector `ui/status.html` mit `sdpi-components` aus dem Template.
4. Build, Neustart, manueller Check AC9.

### Out of Scope

- Fenster-Fokus bei Druck (Package 9).

---

## Package 9: Fenster-Fokus

**Ziel:** Ein Druck auf einen Status-Key holt das Fenster der Session in den Vordergrund.

**Abhängigkeiten:** Package 8

**Betroffene Dateien:**
- `src/win/window-match.ts` (neu)
- `src/win/window-match.test.ts` (neu)
- `src/win/focus-window.ts` (neu)
- `src/win/focus-window.test.ts` (neu)
- `com.claudedeck.streamdeck.sdPlugin/scripts/focus-window.ps1` (neu, im Plugin-Ordner mitgeliefert)
- `src/actions/status-action.ts` (ändern)

### Kontext

Zwei Teile: (1) **Welches Fenster?** Eine reine Funktion wählt aus einer Fensterliste (`{ hwnd, processName, title, path }`) das passende. Der Payload unterscheidet Desktop und CLI nicht (Spike AC7). Heuristik: zuerst ein Terminal-Fenster, dessen Titel den Projektnamen enthält, sonst das Claude-Desktop-Fenster (Prozess `claude`, Pfad enthält `WindowsApps\Claude_`). (2) **Fokus setzen:** Windows blockiert `SetForegroundWindow` aus Hintergrundprozessen oft (Foreground Lock). Workaround: vorher einen Alt-Tastendruck per `keybd_event` simulieren, dann `ShowWindow(SW_RESTORE)` und `SetForegroundWindow`. Umsetzung über ein PowerShell-Skript mit `Add-Type` und `user32.dll`, damit keine native Node-Abhängigkeit nötig ist. Der Start von PowerShell kostet etwa 300 ms. Das ist für einen Tastendruck akzeptabel und wird im Code mit einem `ponytail:`-Kommentar markiert (Upgrade-Pfad: `koffi` als FFI).

### Acceptance Criteria

- [ ] AC1: `matchWindow(project, windows)` liefert das Claude-Desktop-Fenster, wenn kein passendes Terminal-Fenster existiert.
- [ ] AC2: Vorrang hat das erste Terminal-Fenster (`WindowsTerminal`, `pwsh`, `powershell`, `cmd`), dessen Titel den Projektnamen enthält, ohne Rücksicht auf Groß- und Kleinschreibung.
- [ ] AC3: Gibt es kein passendes Fenster, liefert sie `null`, und der Key zeigt `showAlert()`.
- [ ] AC4: `focusWindow(hwnd)` übergibt das Handle als Zahl in einem Argument-Array an `execFile`, nie als zusammengesetzten Shell-String (keine Injektion über Fenstertitel).
- [ ] AC5: Druck auf einen Status-Key fokussiert das Fenster und setzt bei `done` zusätzlich `idle` (Package 8 AC8 bleibt erfüllt).
- [ ] AC6: Manueller Check: Claude Desktop minimiert, Status-Key drücken, Desktop erscheint im Vordergrund und hat den Tastaturfokus. Dasselbe mit Desktop hinter einem anderen Fenster und mit einer CLI-Session in Windows Terminal.

### Tests (TDD)

1. `window-match.test.ts > "falls back to Claude Desktop window"` - AC1
2. `> "prefers terminal window with project name"` - AC2
3. `> "returns null when nothing matches"` - AC3
4. `focus-window.test.ts > "passes hwnd as integer argument"` - AC4 (Spy auf `execFile`, prüft das Argument-Array)
5. `status-action.test.ts > "press focuses window and clears done"` - AC5 (Fokus-Funktion als Fake injiziert)

Testbefehl: `npm test`

### Umsetzungsschritte

1. Tests 1 bis 3, `window-match.ts` implementieren.
2. `focus-window.ps1`: Fensterliste als JSON ausgeben (`-List`) und Fokus setzen (`-Focus <hwnd>`).
3. Test 4, `focus-window.ts` mit `execFile("powershell", ["-NoProfile", "-File", script, "-Focus", String(hwnd)])`.
4. Test 5, Verdrahtung in `status-action.ts`.
5. Manueller Check AC6. Schlägt der Fokus trotz Alt-Trick fehl, das Ergebnis in `docs/spike-results.md` nachtragen.

### Out of Scope

- Einen bestimmten Tab in Windows Terminal auswählen (geparkt).
- Eine bestimmte Session in der Desktop-Seitenleiste auswählen (kein Mechanismus bekannt).

---

## Package 10: Interrupt-Key (Go/No-Go)

**Ziel:** Eine laufende Session lässt sich per Tastendruck unterbrechen, oder es ist dokumentiert, warum nicht.

**Abhängigkeiten:** Package 9

**Betroffene Dateien:**
- `docs/spike-results.md` (ändern: Abschnitt Interrupt)
- `src/actions/interrupt-action.ts` (neu, nur bei Go)
- `src/actions/interrupt-action.test.ts` (neu, nur bei Go)
- `com.claudedeck.streamdeck.sdPlugin/scripts/focus-window.ps1` (ändern: `-SendEsc`, nur bei Go)
- `com.claudedeck.streamdeck.sdPlugin/manifest.json` und `src/plugin.test.ts` (ändern, nur bei No-Go)

### Kontext

Für Interrupt gibt es keine dokumentierte Schnittstelle von außen. Einziger Weg: Fenster fokussieren (Package 9) und `Esc` per `SendInput` senden. In Desktop wirkt das nur auf die **gerade sichtbare** Session, im CLI auf die aktive Session im fokussierten Terminal-Tab. Das Package beginnt mit einem manuellen Test von etwa 30 Minuten. Erst bei Go wird die Action gebaut. Der Key bezieht sich auf die Session des ersten Status-Keys im Zustand `working`, oder bei Pinning im Property Inspector auf ein festes Projekt.

### Acceptance Criteria

- [ ] AC1: `docs/spike-results.md` enthält die Go/No-Go-Entscheidung mit Begründung: Bricht `Esc` per `SendInput` in Desktop und im CLI eine laufende Antwort zuverlässig ab (5 von 5 Versuchen)?
- [ ] AC2 (nur bei Go): Druck auf den Interrupt-Key fokussiert das Fenster der Ziel-Session und sendet genau einen `Esc`.
- [ ] AC3 (nur bei Go): Ist keine Session im Zustand `working`, passiert nichts außer `showAlert()`.
- [ ] AC4 (nur bei Go): Der Key zeigt im Ruhezustand gedimmt "Stop" und leuchtet rot, solange mindestens eine Session `working` ist.
- [ ] AC5 (bei No-Go): Die Interrupt-Action wird aus dem Manifest entfernt, der Manifest-Test aus Package 1 wird angepasst.

### Tests (TDD)

1. Manueller Spike (AC1): Langen Prompt starten, aus einem anderen Fenster einen PowerShell-Einzeiler mit Fokus und `SendInput(Esc)` auslösen, Ergebnis notieren. 5-mal Desktop, 5-mal CLI.
2. `interrupt-action.test.ts > "focuses target and sends single Esc"` - AC2 (Fakes für Fokus und Tastendruck)
3. `> "no working session shows alert"` - AC3
4. `> "lit while any session working"` - AC4

Testbefehl: `npm test`

### Umsetzungsschritte

1. Manuellen Spike durchführen, Ergebnis dokumentieren.
2. Bei Go: Tests 2 bis 4, Action implementieren, `-SendEsc` im Skript ergänzen.
3. Bei No-Go: Action aus dem Manifest entfernen, Test anpassen.

### Out of Scope

- Unterbrechen einer Session, die in Desktop gerade nicht sichtbar ist.

---

## Package 11: Permission-Modus-Key (Go/No-Go)

**Ziel:** Der Permission-Modus einer Session lässt sich per Tastendruck wechseln, oder es ist dokumentiert, warum nicht.

**Abhängigkeiten:** Package 7

**Betroffene Dateien:**
- `docs/spike-results.md` (ändern: Abschnitt Modus)
- `src/actions/mode-action.ts` (neu, nur bei Go)
- `src/actions/mode-action.test.ts` (neu, nur bei Go)
- `src/server/pending-approvals.ts` (ändern: `approveWithMode(mode)`, nur bei Go)
- `com.claudedeck.streamdeck.sdPlugin/manifest.json` und `src/plugin.test.ts` (ändern, nur bei No-Go)

### Kontext

Laut Doku kann ein `PermissionRequest`-Hook beim Freigeben `updatedPermissions` mit `{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }` zurückgeben. Ein Moduswechsel von außen **ohne** offene Anfrage ist nicht dokumentiert. Realistisch ist deshalb ein Key "Allow + Modus": Er gibt die aktuelle Anfrage frei und schaltet die Session z. B. auf `acceptEdits`. Welche Modi erlaubt sind, legt der Property Inspector fest (Default `acceptEdits`). `bypassPermissions` wird bewusst **nicht** angeboten, weil ein einzelner Tastendruck damit alle weiteren Sicherheitsabfragen der Session abschaltet. Der aktuelle Modus steht in jedem Payload als `permission_mode` und wird im Session-Store mitgeführt.

### Acceptance Criteria

- [ ] AC1: `docs/spike-results.md` enthält die Go/No-Go-Entscheidung: Wechselt eine `allow`-Antwort mit `setMode` in Desktop und im CLI tatsächlich den Modus (sichtbar in der Oberfläche und im `permission_mode` des nächsten Payloads)?
- [ ] AC2 (nur bei Go): Druck auf den Modus-Key bei offener Freigabe beantwortet die älteste Anfrage mit `allow` und `updatedPermissions` vom Typ `setMode` mit dem konfigurierten Modus und `destination: "session"`.
- [ ] AC3 (nur bei Go): Ohne offene Freigabe ist der Key gedimmt, zeigt den aktuellen Modus der zuletzt aktiven Session und hat beim Drücken keine Wirkung.
- [ ] AC4 (nur bei Go): Der Property Inspector bietet nur `acceptEdits`, `plan` und `default` an, nicht `bypassPermissions`.
- [ ] AC5 (bei No-Go): Die Mode-Action wird aus dem Manifest entfernt, der Manifest-Test aus Package 1 wird angepasst.

### Tests (TDD)

1. Manueller Spike (AC1): Den Spike-Server aus Package 0 so anpassen, dass er `setMode: acceptEdits` zurückgibt, und in Desktop und im CLI prüfen.
2. `pending-approvals.test.ts > "approveWithMode adds session setMode"` - AC2
3. `mode-action.test.ts > "dim without pending and shows current mode"` - AC3
4. `> "inspector offers no bypassPermissions"` - AC4 (prüft die Optionsliste, die an den Property Inspector geht)

Testbefehl: `npm test`

### Umsetzungsschritte

1. Manuellen Spike durchführen, Ergebnis dokumentieren.
2. Bei Go: Test 2 und `approveWithMode`, dann Tests 3 und 4 und `mode-action.ts` samt Property Inspector.
3. Bei No-Go: Action aus dem Manifest entfernen, Test anpassen.

### Out of Scope

- Moduswechsel ohne offene Freigabe (nicht dokumentiert).
- `bypassPermissions` per Tastendruck (bewusst ausgeschlossen).

---

## Package 12: Desktop-Session-Katalog

**Ziel:** Die Session-Metadaten von Claude Desktop (lokale ID, Hook-Session-ID, Ordner, Titel, letzte Aktivität) sind lesbar.

**Abhängigkeiten:** keine

**Betroffene Dateien:**
- `src/desktop/session-catalog.ts` (neu)
- `src/desktop/session-catalog.test.ts` (neu)

### Kontext

Claude Desktop legt pro Code-Session eine Datei `%APPDATA%\Claude\claude-code-sessions\<account>\<org>\local_<uuid>.json` an (gefunden beim Deep-Link-Test, nicht dokumentiert). Relevante Felder: `sessionId` (`local_<uuid>`), `cliSessionId` (= `session_id` der Hook-Payloads), `cwd`, `title`, `lastActivityAt` (ms als String), `isArchived`. Das Format ist intern und kann sich mit Updates ändern; der Katalog überspringt daher jede fehlerhafte Datei, statt abzubrechen.

### Acceptance Criteria

- [ ] AC1: `readDesktopSessions(root)` liefert für jede gültige Datei `{ localId, cliSessionId, cwd, title, lastActivityAt, archived }`, rekursiv unter `root`.
- [ ] AC2: Nur `localId` passend zu `^local_[A-Za-z0-9-]{1,64}$` (dieselbe Regel wie der Desktop-URL-Handler) und `cliSessionId` als UUID werden übernommen; alles andere wird übersprungen.
- [ ] AC3: Ungültiges JSON, fehlende Felder oder nicht lesbare Dateien werden übersprungen, ohne Exception.
- [ ] AC4: Fehlt `root` (Desktop nicht installiert), ist das Ergebnis eine leere Liste.
- [ ] AC5: `lastActivityAt` ist eine Zahl (ms), `archived` ein Boolean, `title` ein String (leer, falls nicht vorhanden).
- [ ] AC6: Der Default-Root ist `%APPDATA%\Claude\claude-code-sessions`.

### Tests (TDD)

1. `session-catalog.test.ts > "reads valid session files recursively"` - AC1, AC5 (temporäre Verzeichnisstruktur in `os.tmpdir()`)
2. `> "skips invalid ids"` - AC2
3. `> "skips broken files"` - AC3
4. `> "returns empty list when root is missing"` - AC4
5. `> "defaults to APPDATA claude-code-sessions"` - AC6

Testbefehl: `npm test`

### Out of Scope

- Schreiben in die Desktop-Dateien (nie).

---

## Package 13: Vorbelegung der Status-Keys

**Ziel:** Status-Keys zeigen Desktop-Sessions sofort beim Start bzw. Hinzufügen, nicht erst nach dem ersten Prompt.

**Abhängigkeiten:** Package 12

**Betroffene Dateien:**
- `src/domain/session-store.ts` (+ Test) (ändern: `seed`)
- `src/actions/status-action.ts` (+ Test) (ändern)
- `src/plugin.ts` (ändern)

### Kontext

Bisher entsteht eine Session erst mit ihrem ersten Hook-Event; nach einem Plugin-Neustart oder beim Hinzufügen einer Kachel bleibt der Key leer. Der Katalog aus Package 12 kennt alle Desktop-Sessions. Damit nicht 50 alte Sessions die Slots belegen, werden nur vorbelegt: Sessions mit Aktivität in den letzten 12 Stunden, plus pro gepinntem Ordner dessen neueste Session unabhängig vom Alter. Vorbelegte Sessions starten als `idle`. Ihr Transkriptpfad wird aus `cwd` und `cliSessionId` abgeleitet (`~/.claude/projects/<cwd, jedes nicht alphanumerische Zeichen durch "-" ersetzt>/<cliSessionId>.jsonl`, z. B. wird `F:\Code\ClaudeDeck` zu `F--Code-ClaudeDeck`), damit der Kontextbalken sofort einen Wert hat. Archivierte Sessions werden nie vorbelegt. CLI-Sessions stehen nicht im Katalog und erscheinen weiterhin erst beim ersten Event.

### Acceptance Criteria

- [ ] AC1: `store.seed(entries)` legt für jede noch unbekannte Session eine Session im Zustand `idle` an (Slot nach den bekannten Regeln, neueste zuerst); bekannte Sessions bleiben unverändert.
- [ ] AC2: Vorbelegt werden nicht archivierte Sessions mit `lastActivityAt` in den letzten 12 h sowie je gepinntem Ordner die neueste nicht archivierte Session.
- [ ] AC3: Der abgeleitete Transkriptpfad folgt der Regel aus dem Kontext (Test mit `F:\Code\ClaudeDeck` und einem Pfad mit Leerzeichen).
- [ ] AC4: Nach dem Vorbelegen wird der Kontext jeder vorbelegten Session einmal gelesen.
- [ ] AC5: Vorbelegt wird beim Plugin-Start, wenn ein Status-Key erscheint oder sich seine Einstellungen ändern, und alle 60 s.
- [ ] AC6: Ein späteres Hook-Event einer vorbelegten Session aktualisiert genau diese Session (gleiche `session_id`), es entsteht keine zweite.
- [ ] AC7: Fehlschläge beim Lesen des Katalogs lassen die Keys im bisherigen Zustand (kein Absturz).

### Tests (TDD)

1. `session-store.test.ts > "seed creates idle sessions newest first and keeps known ones"` - AC1, AC6
2. `status-action.test.ts > "seeds recent and pinned sessions"` - AC2 (Katalog als Fake injiziert, Uhr injiziert)
3. `> "derives transcript path from cwd and cli session id"` - AC3
4. `> "reads context for seeded sessions"` - AC4
5. `> "reseeds on appear, settings change and every 60s"` - AC5 (Fake-Timer)
6. `> "catalog failure keeps keys unchanged"` - AC7

Testbefehl: `npm test`

### Out of Scope

- CLI-Sessions vorbelegen (kein Katalog vorhanden).

---

## Package 14: Session-Titel als Beschriftung

**Ziel:** Status-, Decision- und Modus-Keys beschriften Desktop-Sessions mit ihrem Titel statt dem Ordnernamen.

**Abhängigkeiten:** Package 13

**Betroffene Dateien:**
- `src/domain/session-store.ts` (+ Test), `src/actions/status-action.ts` (+ Test), `src/actions/decision-action.ts` (+ Test), `src/actions/mode-action.ts` (+ Test), `src/server/pending-approvals.ts` (+ Test)
- `src/render/status-key.ts` (+ Test, Snapshots)

### Kontext

Zwei Sessions im selben Ordner sind heute auf den Keys nicht unterscheidbar. Desktop-Sessions haben einen Titel (z. B. "ClaudeDeck Stream Deck Plugin"). Der Titel wird beim Vorbelegen und bei jedem erneuten Lesen des Katalogs übernommen (`session.title`). Für eine Zeile des Status-Keys ist er zu lang; er wird auf bis zu zwei Zeilen umbrochen (Wortgrenzen, je max. 12 Zeichen bei 15 px, Rest mit "…"). Ohne Titel (CLI-Session) bleibt der Ordnername in der bisherigen Darstellung.

### Acceptance Criteria

- [ ] AC1: `store.setTitles(map cliSessionId -> title)` setzt `session.title` und meldet Änderungen über `onChange`.
- [ ] AC2: Der Status-Key zeigt bei vorhandenem Titel diesen in bis zu zwei Zeilen (Wortumbruch, max. 12 Zeichen pro Zeile, Kürzung mit "…"), sonst den Ordnernamen wie bisher.
- [ ] AC3: Allow/Always/Deny und der Modus-Key zeigen als Projektzeile den Titel (gekürzt auf 14 Zeichen), falls bekannt, sonst den Ordnernamen.
- [ ] AC4: Titel werden XML-escaped und nach Code Points gekürzt (Emoji-sicher).
- [ ] AC5: Die Optik bleibt SVG-Tiny-tauglich, alle Schriften mindestens 14 px.

### Tests (TDD)

1. `session-store.test.ts > "setTitles updates titles and notifies"` - AC1
2. `render.test.ts > "status key wraps a title into two lines"` - AC2, AC4, AC5
3. `render.test.ts > "status key without title keeps project name"` - AC2
4. `decision-action.test.ts > "uses session title as project line"` - AC3
5. `mode-action.test.ts > "uses session title as project line"` - AC3

Testbefehl: `npm test`

### Out of Scope

- Titel für CLI-Sessions (nicht verfügbar).

---

## Package 15: Mehrere Sessions pro Ordner

**Ziel:** Mehrere Keys mit demselben Ordner zeigen dessen Sessions nach Aktualität verteilt; optional zeigt ein Key nur die neueste.

**Abhängigkeiten:** Package 13

**Betroffene Dateien:**
- `src/domain/session-store.ts` (+ Test), `src/actions/status-action.ts` (+ Test)
- `com.claudedeck.streamdeck.sdPlugin/ui/status.html`

### Kontext

Heute bekommt bei einem Pin nur die erste Session des Ordners den gepinnten Key; zwei Keys mit demselben Ordner funktionieren nicht (Review Package 8, Hinweis 4). Neu: Alle Keys, die auf denselben Ordner gepinnt sind, bilden eine Gruppe in Key-Reihenfolge. Die Sessions dieses Ordners werden nach Aktualität absteigend auf die Gruppe verteilt (neueste auf den ersten Key). Weitere Sessions des Ordners belegen freie ungepinnte Keys. Option im Property Inspector: "Nur neueste Session" (`latestOnly`). Ein solcher Key zeigt immer die zuletzt aktive Session seines Ordners; wird eine andere Session des Ordners aktiv, wechselt sie auf diesen Key und die vorherige rückt auf den nächsten freien Key.

### Acceptance Criteria

- [ ] AC1: Zwei auf denselben Ordner gepinnte Keys zeigen die beiden neuesten Sessions dieses Ordners, neueste auf dem ersten Key.
- [ ] AC2: Eine dritte Session desselben Ordners belegt einen freien ungepinnten Key oder wird nicht angezeigt, wenn keiner frei ist.
- [ ] AC3: Ein Key mit `latestOnly` zeigt immer die Session seines Ordners mit dem neuesten Event; der Wechsel passiert beim Event, nicht erst beim nächsten Seed.
- [ ] AC4: Nie liegen zwei Sessions auf demselben Slot (auch nicht kurzzeitig für Listener).
- [ ] AC5: Der Property Inspector bietet die Checkbox "Nur neueste Session" (`latestOnly`), gespeichert in den Action-Settings.

### Tests (TDD)

1. `session-store.test.ts > "distributes a folder's sessions over its pinned slots by recency"` - AC1, AC4
2. `> "extra sessions of a pinned folder take free unpinned slots"` - AC2
3. `> "latestOnly slot follows the most recently active session"` - AC3, AC4
4. `status-action.test.ts > "latestOnly setting reaches the store"` - AC5

Testbefehl: `npm test`

### Out of Scope

- Sortieren ungepinnter Keys nach Aktualität (sie bleiben in Start-Reihenfolge).

---

## Package 16: Deep Link in die Desktop-Session

**Ziel:** Ein Druck auf einen Status-Key öffnet die Session direkt im Chatfenster von Claude Desktop.

**Abhängigkeiten:** Package 12

**Betroffene Dateien:**
- `com.claudedeck.streamdeck.sdPlugin/scripts/focus-window.ps1` (ändern: `-OpenSession <localId>`)
- `src/win/focus-window.ts` (+ Test), `src/actions/status-action.ts` (+ Test), `src/plugin.ts`

### Kontext

Claude Desktop registriert das URL-Schema `claude://`. Der Handler akzeptiert `claude://code/continue?session=<localId>` mit `localId` nach `^local_[A-Za-z0-9-]{1,64}$` und navigiert zur Session (Live-Test: `lastFocusedAt` der Ziel-Session änderte sich). Die `localId` kommt aus dem Katalog (Package 12) über `cliSessionId` = Hook-`session_id`. Ohne Katalog-Eintrag (CLI-Session, Desktop-Update mit anderem Format) bleibt das bisherige Verhalten: Fenster fokussieren. Das URL-Schema ist intern und undokumentiert.

### Acceptance Criteria

- [ ] AC1: `openDesktopSession(localId)` startet `claude://code/continue?session=<localId>&source=claudedeck` und holt anschließend das Desktop-Fenster nach vorne.
- [ ] AC2: Eine `localId`, die nicht zur Regel passt, wird weder in TypeScript noch im Skript akzeptiert (keine URL-Injektion).
- [ ] AC3: Ein Druck auf einen Status-Key nutzt den Deep Link, wenn der Katalog die Session kennt, sonst den bisherigen Fenster-Fokus.
- [ ] AC4: Schlägt der Deep Link fehl, folgt der bisherige Fenster-Fokus; erst wenn auch dieser scheitert, zeigt der Key `showAlert()`.
- [ ] AC5: Manueller Check: Status-Key einer anderen Desktop-Session drücken, Desktop springt in diese Session.

### Tests (TDD)

1. `focus-window.test.ts > "opens a desktop session by validated local id"` - AC1, AC2
2. `focus-window.test.ts > "refuses invalid local ids"` - AC2
3. `status-action.test.ts > "press opens desktop session when known"` - AC3
4. `status-action.test.ts > "press falls back to window focus"` - AC3, AC4

Testbefehl: `npm test`

### Out of Scope

- Deep Links für CLI-Sessions (`claude://resume` würde die Session in Desktop importieren, nicht das Terminal öffnen).

---

## Package 17: Claude-Window-Actions

**Ziel:** Je eine Action minimiert/stellt wieder her bzw. maximiert/stellt wieder her das Claude-Desktop-Fenster.

**Abhängigkeiten:** keine

**Betroffene Dateien:**
- `com.claudedeck.streamdeck.sdPlugin/scripts/focus-window.ps1` (ändern: `-Window minimize|maximize|restore`, `-State`)
- `com.claudedeck.streamdeck.sdPlugin/manifest.json`, `imgs/actions/window/`, `imgs/actions/maximize/` (neu)
- `src/win/focus-window.ts` (+ Test), `src/actions/window-action.ts` (+ Test, neu), `src/render/window-key.ts` (+ Test, neu), `src/plugin.ts`, `src/plugin.test.ts`

### Kontext

Live-Test: `ShowWindow` mit `SW_MINIMIZE` (6), `SW_RESTORE` (9) und `SW_MAXIMIZE` (3) auf das Desktop-Fenster funktioniert, `IsIconic`/`IsZoomed` liefern den Zustand. Zwei Actions: "Claude Window" (minimiert, oder stellt wieder her und fokussiert, wenn es minimiert ist) und "Claude Maximize" (maximiert, oder stellt die normale Größe wieder her, wenn es maximiert ist). Das Desktop-Fenster wird wie in Package 9 erkannt (Prozess `claude`, Pfad unter `WindowsApps\Claude_`).

### Acceptance Criteria

- [ ] AC1: `focus-window.ps1 -Window minimize|maximize|restore -Hwnd <n>` setzt den Zustand; `-State -Hwnd <n>` liefert `{"minimized":bool,"maximized":bool}` als JSON.
- [ ] AC2: "Claude Window": minimiert, wenn nicht minimiert; sonst wiederherstellen und fokussieren.
- [ ] AC3: "Claude Maximize": maximiert, wenn nicht maximiert; sonst normale Größe; danach fokussiert.
- [ ] AC4: Ohne Desktop-Fenster zeigt der Key `showAlert()`.
- [ ] AC5: Beide Actions stehen im Manifest mit eigenem Icon und eigener Key-Grafik (SVG, SVG-Tiny-tauglich).
- [ ] AC6: Nur Integer-Handles und die drei festen Befehle erreichen PowerShell.

### Tests (TDD)

1. `focus-window.test.ts > "window commands pass fixed verbs and integer handles"` - AC1, AC6
2. `window-action.test.ts > "window key toggles minimize and restore"` - AC2
3. `window-action.test.ts > "maximize key toggles maximize and normal size"` - AC3
4. `window-action.test.ts > "alerts without desktop window"` - AC4
5. `plugin.test.ts > "manifest declares window actions"` - AC5
6. `window-key` Render-Test - AC5

Testbefehl: `npm test`

### Out of Scope

- Fenstersteuerung für Terminals.
