# Spike-Ergebnisse (Package 0)

Datum: 2026-10-07. Claude Code CLI 2.1.282, Claude Desktop 2.19675.1.0 (Code-Tab nutzt intern `claude.exe` 2.1.288), Windows 11.

Getestet mit `spike/echo-server.mjs` und dem Spike-Plugin `spike/claudedeck-spike`, geladen per `claude -p ... --plugin-dir spike/claudedeck-spike`. `~/.claude/settings.json` wurde nicht verändert.

## Ergebnis-Übersicht

| AC | Frage | CLI | Desktop |
|----|-------|-----|---------|
| AC0 | `type: "http"` in Plugin-`hooks.json` | **Ja**, außer `SessionStart` | offen (manuell) |
| AC1 | `allow` per Hook führt Tool ohne Dialog aus | **Ja** (Verzeichnis wurde angelegt) | offen (manuell) |
| AC2 | Verhalten des Dialogs während der Wartezeit | n/a (`-p`-Modus) | offen (manuell) |
| AC3 | Verbindung wird geschlossen, wenn der Client aufgibt | **Ja**, Server sieht `close` (getestet durch Beenden des Prozesses) | offen: Dialog in Desktop bedienen, während der Hook wartet |
| AC4 | Server aus (Connection refused) | Fehler nach ca. 50 ms, danach normale Abfrage | offen: ob Desktop die Fehlermeldung sichtbar anzeigt |
| AC5/5b | Payloads und Header | siehe unten | gleiche Engine, vermutlich identisch |
| AC6 | `session_id`, `cwd`, `transcript_path` gesetzt | **Ja**, Transkript unter `~/.claude/projects/<cwd-slug>/<session>.jsonl` | teilweise offen: Transkripte von Desktop-Sessions liegen dort, ein Desktop-Hook-Payload wurde nicht erfasst (manuell, Package 7 AC8) |
| AC7 | Fenster | siehe unten | siehe unten |

Zusätzlich getestet:
- `deny` mit `message`: Tool wird abgelehnt, die Nachricht ("Denied via spike") erreicht das Modell.
- Antwort `{}` (keine Entscheidung): normale Abfrage greift (im `-p`-Modus: Tool nicht ausgeführt, Modell wartet auf Freigabe).

## AC0: HTTP-Hooks in Plugins

Funktionieren für `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`.

**Nicht für `SessionStart`.** Debug-Log:

```
Skipping HTTP hook http://127.0.0.1:37419/hook/SessionStart - HTTP hooks are not supported for SessionStart
```

Konsequenz: `SessionStart` wird nicht registriert. Sessions entstehen implizit beim ersten Event (Package 2 AC4), in der Regel `UserPromptSubmit`. Ein Command-Hook (`forward.mjs`) wird damit nicht gebraucht.

### Nachtrag Package 28: `StopFailure` (2026-10-08)

HTTP wird für `StopFailure` unterstützt. Geprüft mit `claude -p "say ok" --model claude-nonexistent-model-xyz --plugin-dir claude-plugin --debug` in einem leeren Temp-Verzeichnis: das unbekannte Modell beendet den Turn mit einem echten `StopFailure` (`error: "model_not_found"`). Debug-Log (der laufende Hook-Server kannte die Route da noch nicht, daher 404):

```
Hooks: HTTP hook POST to http://127.0.0.1:37419/hook/StopFailure
StopFailure:model_not_found [http://127.0.0.1:37419/hook/StopFailure] failed: HTTP 404 from http://127.0.0.1:37419/hook/StopFailure
```

Keine "Skipping HTTP hook"-Zeile. Konsequenz: `StopFailure` wird wie die anderen Events als HTTP-Hook registriert, ein Command-Hook ist nicht nötig. Ein normaler Lauf (`say ok`) feuert nur `Stop`, kein `StopFailure`.

## AC4: Server offline

```
[ERROR] Hooks: HTTP hook error: connect ECONNREFUSED 127.0.0.1:37419
SessionEnd hook [http://127.0.0.1:37419/hook/SessionEnd] failed: connect ECONNREFUSED 127.0.0.1:37419
```

Kein Abbruch, die normale Abfrage greift. Im CLI erscheint die `SessionEnd`-Fehlerzeile auf stderr.

## AC5b: Header

```json
{"accept":"application/json, text/plain, */*","content-type":"application/json","user-agent":"axios/1.15.2","host":"127.0.0.1:37419","connection":"keep-alive"}
```

`Content-Type: application/json`, **kein `Origin`**. Package 4 AC2b passt.

## AC5: Payloads (gekürzt)

Gemeinsame Felder aller Events: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode`, `hook_event_name`.

`PermissionRequest`:

```json
{
  "hook_event_name": "PermissionRequest",
  "permission_mode": "default",
  "tool_name": "Bash",
  "tool_input": { "command": "mkdir spike_probe_dir && echo created", "description": "Create directory and echo confirmation" },
  "permission_suggestions": [
    { "type": "addDirectories", "directories": ["C:\\...\\cdspike"], "destination": "session" },
    { "type": "setMode", "mode": "acceptEdits", "destination": "session" }
  ]
}
```

Wichtig für "Always Allow": `permission_suggestions` kann `setMode` enthalten. Always Allow darf **nur** `addRules` und `addDirectories` übernehmen, nie `setMode`, sonst wechselt die Session ungewollt den Modus.

- `UserPromptSubmit`: zusätzlich `prompt`.
- `PreToolUse`: zusätzlich `tool_name`, `tool_input`, `tool_use_id`.
- `PostToolUse`: zusätzlich `tool_response`, `tool_use_id`, `duration_ms`.
- `Stop`: zusätzlich `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`.
- `SessionEnd`: zusätzlich `reason` (z. B. `"other"`), kein `permission_mode`.
- `Notification`: im `-p`-Modus nicht ausgelöst. Typen laut Doku: `permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input` und weitere. Package 2 liest den Typ defensiv aus `notification_type`.

## AC7: Fenster

```
ProcessName  MainWindowTitle
claude       Claude                       <- Claude Desktop (C:\Program Files\WindowsApps\Claude_...\app\Claude.exe)
StreamDeck   Stream Deck
```

- Desktop: Prozess `claude` mit Fenstertitel `Claude`, Pfad unter `WindowsApps\Claude_*`.
- Desktop-Code-Sessions laufen als `claude.exe` unter `%APPDATA%\Claude\claude-code\<version>\`, ohne eigenes Fenster.
- Fenstertitel eines Terminals mit CLI-Session: **offen (manuell)**, zum Zeitpunkt des Spikes lief kein interaktives CLI. Wird in Package 9 AC6 geprüft. Annahme: Windows Terminal zeigt den von Claude Code gesetzten Titel bzw. den Ordnernamen.
- Der Payload unterscheidet Desktop und CLI **nicht**.
- Grenze der Fensterliste (Package 9): `focus-window.ps1` liefert pro Prozess nur das Hauptfenster (`MainWindowHandle`). Ein zweites Windows-Terminal-Fenster oder ein inaktiver Tab wird nicht gefunden; `pwsh` oder `cmd` innerhalb von Windows Terminal haben kein eigenes Fenster. Package 9 nutzt deshalb eine Heuristik: zuerst ein Terminal-Fenster suchen, dessen Titel den Projektnamen enthält, sonst das Desktop-Fenster.

## AC8: Go/No-Go

- **CLI: Go.** Freigabe, Ablehnung, Fallback und Close-Erkennung funktionieren.
- **Desktop: vorläufig Go, manuelle Bestätigung offen.** Desktop nutzt dieselbe Engine (`claude.exe`), und Plugin-Hooks laufen dort nachweislich. Offen ist nur die Interaktion mit dem Desktop-Dialog (Desktop-Spalte AC1 bis AC4). Geprüft wird das im End-to-End-Check von Package 7 (AC8). Fällt er negativ aus: Allow, Always und Deny nur für das CLI, in Desktop nur Status.

## AC9: Aufräumen

Das Spike-Plugin wurde nur per `--plugin-dir` für einzelne `-p`-Läufe geladen, nie installiert. Es gibt nichts zu deinstallieren. `~/.claude/settings.json` wurde nicht angefasst.

## Package 10: Interrupt (Go/No-Go)

**Entscheidung: No-Go.**

Einziger Weg von außen wäre: Fenster fokussieren und `Esc` per `SendInput` senden. Der Test von AC1 (5 von 5 Abbrüchen) wurde bewusst **nicht** in Desktop durchgeführt, weil die ClaudeDeck-Entwicklung selbst in einer Desktop-Session lief und ein `Esc` diese Session abgebrochen hätte. Das zeigt das Grundproblem:

- Claude Desktop hat ein Fenster für alle Sessions. `Esc` trifft die **gerade sichtbare** Session, nicht die Session des gedrückten Keys. Wer gerade Session B liest und den Interrupt für Session A drückt, bricht B ab.
- Im CLI trifft `Esc` den aktiven Tab von Windows Terminal, ebenfalls nicht zwingend die gemeinte Session.
- Es gibt keine dokumentierte Schnittstelle, eine bestimmte Session zu unterbrechen.

Der CLI-Teil des Tests wurde ebenfalls nicht durchgeführt: Die Entscheidung beruht auf dem Zielproblem, nicht auf der Frage, ob `Esc` technisch ankommt.

Ein Key, der zuverlässig die falsche Session abbrechen kann, ist schlechter als kein Key. Die Interrupt-Action wurde deshalb aus dem Manifest entfernt (AC5). Neu bewerten, sobald Claude Code einen Interrupt per Session-ID anbietet.

## Package 11: Permission-Modus (Go/No-Go)

Test: Spike-Server auf Port 37420 antwortet auf `PermissionRequest` mit `allow` plus `updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }]`.

```
/hook/PermissionRequest Bash default
answered setMode
/hook/PostToolUse Bash acceptEdits
/hook/PreToolUse Write acceptEdits     <- Write lief ohne Rückfrage
/hook/Stop  acceptEdits
```

- **CLI: Go.** Der Modus wechselt sofort, sichtbar am `permission_mode` aller folgenden Events.
- **Desktop: offen (manuell).** Ob die Desktop-Oberfläche den neuen Modus anzeigt, prüft der Nutzer zusammen mit Package 7 AC8.
- Ein Moduswechsel ohne offene Anfrage bleibt nicht möglich (nicht dokumentiert).


## Package 20: Plugin-Module (Spike)

Test: Modul `scratchpad/spike-module` (`hooks/hooks.json` mit `"modules": ["./register.ts"]`), geladen per `claude -p --plugin-dir`, sendet an einen Spike-Server auf Port 37420.

- **Ohne Freischaltung lädt kein Modul.** Debug-Log: `hooks module claudedeck-module-spike@inline not loaded: hooks modules are not turned on for installed plugins in this process (early access: set CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 ...)`. Das gilt auch für `--plugin-dir`.
- **Mit `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (CLI): Go.** `hooks module claudedeck-module-spike@inline loaded (worker, environment 1, tier user)`. Beim Server kamen an:
  - `/module/start` mit Session-ID (gleich der Hook-`session_id`), `cwd`, `context: { window: 200000 }`, `rateLimits: []` (im `-p`-Modus vor dem ersten API-Aufruf leer)
  - `/module/turn` mit der `turnId` des laufenden Turns (Voraussetzung für `$.turn.abort`)
  - drei `/module/tick` im 2-s-Takt (`$.clock.every` funktioniert)
- **Desktop: Go.** Mit Zustimmung des Nutzers kurzzeitig `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` und `CLAUDE_CODE_PLUGIN_DIRS=<Spike-Ordner>` in die `env` von `~/.claude/settings.json` eingetragen; der Nutzer startete eine neue Desktop-Session. Das Modul lud in jeder neu gestarteten Desktop-Session (drei Sessions beobachtet). Angekommen:
  - `/module/start`, `/module/turn` (mit `turnId`), drei `/module/tick`
  - `/module/usage` nach jedem Turn, z. B. `context: { tokens: 92399, window: 1000000, percent: 9 }` (das 1M-Fenster wird korrekt erkannt; die Transkript-Schätzung aus Package 3 hätte gegen 200k gerechnet) und `rateLimits: [{ kind: "five_hour", percentUsed: 85, resetsAt }, { kind: "seven_day", percentUsed: 56, resetsAt }]`
- **Aufgeräumt (AC5):** Beide Variablen wieder entfernt; `settings.json` ist inhaltsgleich mit dem Stand vor dem Spike, das Backup wurde danach gelöscht.
- **Bewertung: Go (CLI und Desktop).** Risiko: Early-Access-Schalter, API kann sich ändern; ClaudeDeck muss ohne Modul weiter funktionieren (Hooks bleiben die Basis, das Modul ergänzt Interrupt, exakten Kontext, Rate Limits).

**Weg zur dauerhaften Nutzung:** Installierte Plugins laden Module derzeit nicht (Rollout-Flag). ClaudeDeck müsste das Modul daher aus einem Ordner laden lassen: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` und `CLAUDE_CODE_PLUGIN_DIRS=<ClaudeDeck-Modulordner>` in der `env` von `~/.claude/settings.json`. Folgen: ein Early-Access-Schalter gilt für alle Plugins mit Modulen; die Hooks aus Package 5 bleiben die Basis, damit ClaudeDeck ohne Modul weiter funktioniert. Neue Möglichkeiten: exakter Kontext, Plan-Usage-Key ohne Token (Rate Limits), Interrupt genau einer Session über `$.turn.abort`.
