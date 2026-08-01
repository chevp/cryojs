# Plan: Echtes `.cryo`-Merging über einen klaren cryojs-API-Service

Status: **verworfen** — Merging ist nicht Aufgabe des Container-*Formats* selbst,
sondern eines Service-/Tool-Layers darüber. Der Ansatz wurde implementiert und
nach Review wieder vollständig zurückgebaut (Format bleibt schlank).
Betrifft Paket: `@cryo/cryojs` (v3.1.1) · Container-Version `2.1.0`

---

## 1. Ziel (das Szenario)

In einer Template-Section gibt es zwei `.cryo`-Plätze (Slots). Zieht jemand
`.cryo B` per Drag & Drop auf `.cryo A` (bzw. „kopiert A nach B"), soll **nicht**
einfach eine Datei die andere überschreiben. Stattdessen entsteht ein **neues
`.cryo C`**, das:

1. **zwei Unterordner** enthält — je einen pro Quelle — mit dem **vollständigen
   vorherigen Inhalt** von A und B (inklusive der jeweils eigenen
   `manifest.json`, damit jeder Unterordner ein in sich gültiges Container-Payload
   bleibt), und
2. **ein gemergtes Top-Level `manifest.json`** trägt, das beide Quellen
   beschreibt — das ist der eigentliche Merge, kein bloßes Aneinanderhängen.

Dieses Verhalten muss durch einen **klaren cryo-API-Service in cryojs erzwungen**
werden (nicht ad hoc im UI nachgebaut). Zusätzlich soll eine **weitere
Example-Page (HTML) in `docs/`** entstehen, die den Merge zeigt und dabei die
**schönen Kacheln** (`.kind-tile` / `.drop-slot`, Quelle: `src/tiles.ts`) wiederverwendet.

---

## 2. Ausgangslage (Ist-Stand, bereits geprüft)

- Container-Kern ist **isomorph** über `RandomAccessSource` (`src/container/`):
  `CryoContainer` (reader), `packFolder` (writer), `MemorySource`, `tar-index`,
  `manifest`, `schema`, `tiles`.
- **Manifest-Schema** (`src/container/manifest.schema.json`) hat
  `additionalProperties: false`. Ein Merge-Manifest mit Zusatzfeldern ist damit
  **nur nach Schema-Erweiterung** gültig.
- **`encodeTar` / `encodeTarEntry`** (`src/container/tar-index.ts`) sind
  **Node-only** (nutzen `Buffer`) und werden von `src/browser.ts` **nicht**
  exportiert. Für einen isomorphen Merge (auch im Browser/Docs-Demo) fehlt ein
  Uint8Array-basierter Tar-Encoder. → **offener Punkt, siehe §6.**
- **Kacheln**: kanonische Quelle ist `src/tiles.ts` (`BUILTIN_TILES`,
  `tileForKind`, `tileGradient`), via `browser.ts` exportiert. `docs/index.html`
  hat `.kind-tile` + `.drop-slot`-CSS und die Drag-Logik bereits inline.
- **Browser-Bundle** `docs/js/cryo-core.js` wird aus `src/browser.ts` per
  `npm run build:browser` (esbuild) erzeugt; Node-Builtins dürfen **nicht**
  leaken (harte Prüfung im Build-Script).
- **CLI** (`src/cli/index.ts`, commander) hat `pack/ls/cat/inspect/verify/unpack`
  — ein `merge`-Command fehlt.

---

## 3. Design-Entscheidungen (Vorschlag, vor Umsetzung bestätigen)

### 3.1 Merge-Semantik
- **Unterordner-Namen**: Default aus dem `name` der jeweiligen Quelle
  (slugifiziert), Fallback `a` / `b`. Bei Kollision deterministisch
  disambiguieren (`name`, `name-2`). Über Optionen überschreibbar.
- **Re-Pathing**: Jeder Content-Eintrag von A → `"<folderA>/<alterPfad>"`, analog
  B. Die **eigene `manifest.json` der Quelle wandert mit** nach
  `"<folderA>/manifest.json"` (bleibt gültiges Sub-Payload).
- **Merge-Manifest (Top-Level)**:
  - `format = "cryo-container"`, `version = CONTAINER_VERSION`
  - `kind = "composite"` (neuer, offener Kind-Wert; **nicht** in `KNOWN_KINDS`,
    damit **kein** `entry` erzwungen wird)
  - `name = opts.name ?? "<A.name> + <B.name>"`
  - `contents` = re-pathe Union aller Einträge, `size`/`sha256`/`type` neu
    berechnet (`inferContentType` auf neuem Pfad)
  - **`sources`** (neues Feld): `[{ folder, name, kind, entry? }, …]` — macht den
    Composite selbstbeschreibend und prüfbar.
  - `entry`: für Composite standardmäßig **weglassen** (kein einzelnes Primär-Payload).
- **Idempotenz/Nesting**: Ist A bereits ein Composite, funktioniert der Merge
  trotzdem (reines Re-Pathing) — verschachtelte Composites sind erlaubt.
- **Reproduzierbar**: Reihenfolge deterministisch (manifest.json zuerst, dann
  folderA-Einträge, dann folderB), mtime=0 (wie im bestehenden Encoder).

### 3.2 Schema-Erweiterung
- Neues optionales Feld **`sources`** in `manifest.schema.json`
  (`$defs/mergeSource`: `folder`, `name`, `kind` required; `entry` optional;
  `additionalProperties:false`).
- `kind`-Beschreibung/`examples` um `composite` ergänzen.
- Spiegel-Datei `docs/schema/manifest.schema.json` via
  `npm run schema:publish` synchron halten.
- `ContainerManifest`-Interface + `parseManifest` (OPTIONAL-Felder) in
  `src/container/manifest.ts` um `sources` erweitern.

### 3.3 API-Oberfläche (der „klare Service")
Neues Modul **`src/container/merge.ts`**:
- `mergeContainers(a: CryoContainer, b: CryoContainer, opts?): Promise<MergeResult>`
  — **isomorpher Kern**, liefert `{ bytes: Uint8Array, manifest }`, ohne fs.
- `mergeCryoFiles(aPath, bPath, outPath, opts?): Promise<ContainerManifest>`
  — Node-Komfort: A & B öffnen, mergen, `outPath` **atomar** schreiben
  (tmp + rename, wie `packFolder`).
- Typen: `MergeOptions { name?, kind?, folders?: [string,string] }`,
  `MergeResult { bytes, manifest }`.
- **Erzwingung**: Ergebnis-Manifest am Ende via `validateManifest` prüfen und bei
  Fehlern hart werfen (Contract by construction).
- Exporte ergänzen in `src/container/index.ts`, `src/index.ts` und — für den
  isomorphen Teil — `src/browser.ts`.

---

## 4. Arbeitspakete

- [ ] **AP1 — Schema**: `sources`/`composite` in `manifest.schema.json`
  ergänzen; `ContainerManifest` + `parseManifest` + `createManifest`-Umfeld
  in `manifest.ts` anpassen; `docs/schema` spiegeln.
- [ ] **AP2 — Isomorpher Tar-Encoder**: Uint8Array-Variante von
  `encodeTar`/`encodeTarEntry` (siehe §6, Option A) — Voraussetzung für einen
  isomorphen Merge & die Browser-Demo.
- [ ] **AP3 — Merge-Kern**: `src/container/merge.ts` (`mergeContainers`,
  `mergeCryoFiles`, Re-Pathing, Manifest-Merge, Validierung).
- [ ] **AP4 — Exporte**: `container/index.ts`, `index.ts`, `browser.ts`.
- [ ] **AP5 — CLI**: `cryojs merge <a> <b> -o <out> [-n name] [--folders x,y]`
  in `src/cli/index.ts`.
- [ ] **AP6 — Tests** (jest): Merge zweier Beispiel-Container aus `examples/`;
  prüfen: zwei Unterordner vorhanden, Sub-Inhalte byte-identisch, Sub-Manifeste
  erhalten, Top-Manifest gültig + `sources` korrekt, `verify` (sha256) grün,
  Round-Trip (öffnen von C, Einträge lesbar), Kollisions-/Nesting-Fall.
- [ ] **AP7 — Docs-Example-Page**: neue HTML-Seite (`docs/merge.html`), die
  - die **Kacheln** (`.kind-tile`, `.drop-slot`, `tileForKind`/`tileGradient`)
    wiederverwendet,
  - **zwei `.cryo`-Slots** anbietet, echtes Drag-&-Drop einer `.cryo`-Datei auf
    einen belegten Slot erlaubt,
  - über `docs/js/cryo-core.js` (Browser-Bundle) real merged und C zum
    Download / zur Inspektion anbietet,
  - von `docs/index.html` aus verlinkt ist.
- [ ] **AP8 — Browser-Bundle bauen**: `npm run build:browser`, Leak-Check grün.
- [ ] **AP9 — Doku**: README-Abschnitt „Merging containers" + kurzer
  Migrationshinweis (neues `sources`-Feld, `composite`-Kind).
- [ ] **AP10 — Versionierung**: `package.json` Bump (Vorschlag `3.2.0`) und ggf.
  `CONTAINER_VERSION`-Diskussion (Schema-Additiv → wohl kein Container-Major).

---

## 5. Akzeptanzkriterien

1. `cryojs merge A.cryo B.cryo -o C.cryo` erzeugt C mit `a/…` und `b/…`
   Unterordnern; `cryojs ls C.cryo` zeigt beide Bäume + `manifest.json`.
2. `cryojs verify C.cryo` ist grün (sha256 aller Einträge stimmt).
3. `cryojs inspect C.cryo` zeigt `kind: composite`, gemergten `name` und das
   `sources`-Array mit beiden Quellen.
4. Öffnet man `a/manifest.json` bzw. `b/manifest.json` in C, sind es die
   **unveränderten** Original-Manifeste von A und B.
5. Der Merge läuft **isomorph**: identisches Ergebnis über Node (`mergeCryoFiles`)
   und Browser-Bundle (Docs-Page) — Byte-gleich bei gleichen Eingaben.
6. Die Docs-Example-Page zeigt den Drag-&-Drop-Merge mit den bestehenden Kacheln
   und bietet C als Download an.
7. Ungültige Merges (z. B. Ergebnis würde Schema verletzen) werfen einen klaren
   Fehler statt eine kaputte Datei zu schreiben.

---

## 6. Offene Punkte / Entscheidungen

- **Tar-Encoder isomorph machen (AP2)** — Optionen:
  - **A (empfohlen)**: `encodeTar`/`encodeTarEntry` auf `Uint8Array` umstellen
    (eigenes `writeAscii`/`concat` statt `Buffer`), Node-Pfad bleibt kompatibel,
    dann in `browser.ts` exportierbar → ein Encoder für Node + Browser.
  - **B**: Merge-Kern bleibt Node-only; die Docs-Page baut den Tar mit einem
    kleinen, separaten Browser-Encoder → doppelte Wahrheit, unerwünscht.
- **Unterordner-Benennung**: `a`/`b` (schlicht, deterministisch) vs.
  slug(name) (sprechend, aber Kollisions-/Sonderzeichen-Handling nötig)?
- **`kind` des Composite**: fix `"composite"` vs. übernommener gemeinsamer Kind,
  wenn A.kind === B.kind?
- **>2 Quellen**: `mergeContainers` auf N Quellen verallgemeinern
  (`mergeAll(containers[])`) oder bewusst auf genau 2 (das Slot-Szenario) begrenzen?
- **Preview**: `preview` aus einer Quelle übernehmen/re-pathen oder weglassen?
- **Version-Bump**: `3.2.0` (Feature-Minor) korrekt? `CONTAINER_VERSION` bleibt
  `2.1.0`, da rein additiv?

---

> **Nachtrag (verworfen):** Der Plan wurde einmal vollständig umgesetzt und nach
> Review wieder zurückgebaut. Begründung: Merging ist **nicht Aufgabe des
> Container-Formats**. Das Format bleibt ein schlanker, seekbarer
> Single-File-Store (wie `asar`/USDZ); Zusammenführen mehrerer Container gehört
> in einen darüberliegenden Service-/Tool-Layer, der die bestehende Reader-/
> Writer-API benutzt — ohne das Manifest-Schema (`composite`/`sources`) oder die
> öffentliche Format-Oberfläche aufzublähen.

---

## 7. Reihenfolge der Umsetzung

AP1 → AP2 → AP3 → AP4 → AP6 (Tests, Kern absichern) → AP5 (CLI) →
AP7 + AP8 (Docs-Page + Bundle) → AP9 (Doku) → AP10 (Version).