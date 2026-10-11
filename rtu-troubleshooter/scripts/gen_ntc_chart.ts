// Generic 20k NTC approximation (Beta model). PLACEHOLDER until the Honeywell C7250A
// resistance chart from /docs replaces it. Run: npx tsx scripts/gen_ntc_chart.ts > src/content/honeywell/c7250a-chart.json
const R25 = 20000;
const BETA = 3950;
const toK = (f: number) => ((f - 32) * 5) / 9 + 273.15;
const rows = [];
for (let f = -40; f <= 150; f += 5) rows.push({ tempF: f, ohms: Math.round(R25 * Math.exp(BETA * (1 / toK(f) - 1 / toK(77)))) });
console.log(JSON.stringify({
  sensor: 'C7250A',
  verified: false,
  basis: 'generic',
  note: 'Generic 20k-at-77°F NTC, Beta 3950 approximation. NOT the Honeywell chart. Replace rows with the C7250A resistance-vs-temperature table from the datasheet in /docs and set verified:true with the page cite.',
  rows,
}, null, 1));
