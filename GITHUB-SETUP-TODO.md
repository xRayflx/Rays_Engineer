# TODO: GitHub-Einstellungen für das neue Repo

> Persönliche Checkliste – **nicht committen**, nach dem Einrichten löschen.
> Alle Dateien (Workflows, LICENSE, CLA, CONTRIBUTING, Vorlagen) liegen schon lokal bereit.

## 1. Repo anlegen & Code hochladen
- [ ] Altes Repo `xRayflx/Rays_Engineer` löschen (Settings → General → ganz unten *Delete this repository*)
- [ ] Neues Repo anlegen: Name `Rays_Engineer`, **Public**, **ohne** README/LICENSE/.gitignore (sonst Konflikt mit dem lokalen Stand)
- [ ] Wenn der Username **nicht** mehr `xRayflx` ist: in `CLA.md` (Abschnitt 1) den Usernamen anpassen
- [ ] Lokal: alles committen, dann auf `main` pushen
  ```
  git checkout -B main
  git push -u origin main
  ```
  (`git remote set-url origin https://github.com/<user>/Rays_Engineer.git`, falls sich die URL ändert)

## 2. Settings → General
- [ ] **Features → Issues** aktiviert
- [ ] **Pull Requests:** nur **Allow squash merging** an, *merge commits* und *rebase merging* aus
- [ ] **Automatically delete head branches** an
- [ ] Unter **Collaborators** niemanden mit Write-Rechten hinzufügen

## 3. Settings → Actions → General
- [ ] **Fork pull request workflows from outside collaborators:** „Require approval for first-time contributors" (oder strenger: „…for all outside collaborators")
- [ ] **Workflow permissions:** „Read repository contents and packages permissions"
- [ ] „Allow GitHub Actions to create and approve pull requests" **aus**

## 4. Einmal einen Test-PR machen (damit die Checks existieren)
- [ ] Issue #1 „CI testen" anlegen
- [ ] Branch `chore/1-ci-test` erstellen, Kleinigkeit ändern, PR auf `main` mit `Closes #1`
- [ ] Checks laufen: **Tests / test**, **PR rules / issue-link**, **PR rules / cla** (cla ist bei dir grün)
- [ ] Nach den Tests erscheint im PR der Kommentar „✅ Checks passed" (Tests laufen auf Windows inkl. Installer + Smoke-Test, ca. 10 min)
- [ ] Gegentest: `Closes #1` aus der Beschreibung entfernen → `issue-link` wird rot
- [ ] Gegentest: einen Test absichtlich kaputt machen, pushen → `test` rot, Kommentar wechselt auf „❌ Checks failed"
- [ ] Optional: CLA-Test mit zweitem Account (Fork, PR ohne Haken → `cla` rot, Haken setzen → grün)
- [ ] PR wieder aufräumen (kaputten Test zurücknehmen, mergen oder schließen)

## 5. Settings → Rules → Rulesets → New branch ruleset: `main-protection`
- [ ] Enforcement: **Active**
- [ ] Target branches: **Include default branch**
- [ ] Bypass list: Role **Repository admin** (für Notfälle, optional)
- [ ] ☑ Restrict deletions
- [ ] ☑ Block force pushes
- [ ] ☑ Require a pull request before merging – Required approvals: **0**, Allowed merge methods: **Squash**
- [ ] ☑ Require status checks to pass – Checks `test`, `issue-link`, `cla` hinzufügen (Quelle: GitHub Actions)
  - [ ] ☑ Require branches to be up to date before merging

## 6. Neues branch ruleset: `release-protection`
- [ ] Enforcement: **Active**
- [ ] Target branches: **Include by pattern** → `release/**`
- [ ] Bypass list: Role **Repository admin**
- [ ] ☑ Restrict creations
- [ ] ☑ Restrict updates
- [ ] ☑ Restrict deletions
- [ ] ☑ Block force pushes

## 7. Release testen
- [ ] Von `main` den Branch `release/0.2.0` erstellen (Branches → New branch, Source: `main`)
- [ ] Unter **Actions** läuft „Release"
- [ ] Unter **Releases** erscheint `v0.2.0` mit `Rays Engineer Setup 0.2.0.exe`

## 8. Optional
- [ ] Repo-Beschreibung + Topics setzen (z. B. `le-mans-ultimate`, `telemetry`, `sim-racing`, `electron`)
- [ ] Labels `bug` und `enhancement` prüfen (werden von den Issue-Vorlagen verwendet, existieren standardmäßig)
- [ ] Diese Datei löschen
