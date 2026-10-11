# RTU Troubleshooter

Mobile-first, offline PWA that trains commercial techs to troubleshoot packaged RTUs down to the component. Reference units: Lennox LCH240H4BN4G (M2) and Trane TSC072F3E (Precedent). Honeywell JADE W7220 is the priority economizer platform.

```bash
npm install
npm run dev          # local dev server
npm run validate     # physics/consistency check on all content (build fails on any contradiction)
npm run unverified   # regenerate docs/UNVERIFIED.md
npm run build        # validate → typecheck → production PWA build in dist/
npm run pt           # regenerate the R-410A PT table (needs: pip install CoolProp)
```

## Status (build order)

- [x] 1. Data layer: schemas, R-410A PT table (CoolProp), 6 components, 6 scenarios (2 Honeywell), validator with mutation self-test
- [x] 2. Service Call mode end to end, with simulated JADE + ladder diagram
- [x] 3. Component Lab (23 bench cases)
- [x] 4. JADE Commissioning (3 jobs)
- [ ] 5–9. **Paused for play-test.** Badges/streaks, flashcards, study modes, full content volume, PWA polish

## Accuracy

Every spec that isn't from `/docs` is `verified: false`, shows a ⚠ tag in the UI, and is listed in `docs/UNVERIFIED.md`. **No manuals are in /docs yet**, so unit specs, thresholds, JADE menus, and controller codes are all generic and flagged. The R-410A PT table is the exception: it's generated from CoolProp's equation of state, with the source cited in the file.

The validator (`scripts/validate.ts`, rules in `src/engine/rules.ts`) checks every scenario's readings against generic physics plus fault-specific rules. On every run it also injects 23 known contradictions and fails if it misses any.

## Content

All content is JSON under `src/content/`, discovered by folder: add a file and it shows up in the app. See `docs/SCENARIO_SCHEMA.md` and `docs/COMPONENT_SCHEMA.md`.
