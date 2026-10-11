# /docs

Drop the manuals here (text-based PDFs preferred over scans):

- Lennox LCH installation / service / unit information, M2 controller guide, wiring diagrams
- Trane Precedent (TSC072F) IOM / service facts / wiring diagrams
- Honeywell JADE W7220 (63-2700 and related), W7212 / Series 72
- Honeywell datasheets: C7250A, C7660, C7400S, C7232/C7632, MS7503, MS3103J, MS3105J

Then work through `UNVERIFIED.md`: correct each value in the JSON, set `"verified": true` with a `"source"`, and run `npm run unverified`.

- `UNVERIFIED.md`: generated list of every unsourced value. Don't hand-edit it.
- `SCENARIO_SCHEMA.md` / `COMPONENT_SCHEMA.md`: how to write new content.
