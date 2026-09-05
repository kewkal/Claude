/**
 * End-to-end smoke test.
 *
 * Serves the fixture site over real HTTP on loopback, runs the real CLI against
 * it through the fixture discovery adapter, and asserts a well-formed CSV lands
 * in a temporary output directory.
 *
 * This is the only end-to-end path that does not depend on the public internet,
 * so it doubles as a regression test for the whole orchestration layer:
 * discovery -> dedupe -> bounded concurrency -> crawl -> parse -> streaming CSV.
 *
 * Run with: npm run smoke
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

import { main } from '../../src/index.js';
import { CSV_COLUMNS } from '../../src/types/lead.js';

const SITE_ROOT = join(import.meta.dirname, 'fixture-site');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Minimal static file server. Directory requests resolve to index.html. */
function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    // Contain every request inside the fixture directory.
    const resolved = join(SITE_ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!resolved.startsWith(SITE_ROOT)) {
      response.writeHead(403).end('forbidden');
      return;
    }

    let file = resolved;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404</h1>');
      return;
    }

    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function fail(message: string): never {
  console.error(`\n[SMOKE] FAILED: ${message}`);
  process.exit(1);
}

function check(condition: boolean, message: string): void {
  if (!condition) fail(message);
  console.log(`[SMOKE] ok — ${message}`);
}

/** Split one CSV line, respecting quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

async function run(): Promise<void> {
  const { server, baseUrl } = await startServer();
  const outputDir = mkdtempSync(join(tmpdir(), 'lead-smoke-'));
  console.log(`[SMOKE] fixture site at ${baseUrl}, output to ${outputDir}\n`);

  try {
    const exitCode = await main([
      '--vertical', 'HVAC Contractors',
      '--location', 'Houston, TX',
      '--limit', '10',
      '--concurrency', '2',
      '--headless', 'true',
      '--max-pages-per-site', '4',
      '--source', 'fixture',
      '--fixture-manifest', join(SITE_ROOT, 'manifest.json'),
      '--fixture-base-url', baseUrl,
      '--output-dir', outputDir,
    ]);

    console.log('');
    check(exitCode === 0, `CLI exited cleanly (code ${exitCode})`);

    const files = readdirSync(outputDir).filter((name) => name.endsWith('.csv'));
    check(files.length === 1, `exactly one CSV was written (${files.join(', ')})`);

    const csvPath = join(outputDir, files[0] ?? '');
    check(
      /^leads-hvac-contractors-houston-tx-\d{8}-\d{6}\.csv$/.test(files[0] ?? ''),
      `filename is slugged and timestamped: ${files[0] ?? ''}`,
    );

    const content = readFileSync(csvPath, 'utf8');
    const lines = content.trimEnd().split('\n');
    const header = splitCsvLine(lines[0] ?? '');
    check(
      JSON.stringify(header) === JSON.stringify([...CSV_COLUMNS]),
      'header has exactly the required columns in order',
    );
    check(content.match(/business_name/g)?.length === 1, 'header appears exactly once');

    // The manifest holds 6 entries, one of which duplicates Smith Roofing.
    const dataRows = lines.slice(1);
    check(dataRows.length === 5, `5 rows written after de-duplication (got ${dataRows.length})`);

    const byName = new Map<string, string[]>();
    for (const line of dataRows) {
      const fields = splitCsvLine(line);
      byName.set(fields[0] ?? '', fields);
    }

    const smith = byName.get('Smith Roofing');
    check(smith !== undefined, 'Smith Roofing is present');
    if (smith) {
      const services = JSON.parse(smith[3] || '[]') as string[];
      check(services.includes('Roof Replacement'), `services include Roof Replacement (${services.join(', ')})`);
      check(!services.includes('Quality Solutions'), 'generic marketing did not become a service');
      check(smith[4] === '{"rating":4.8,"count":127}', 'reviews carried through from the discovery source');
      check(smith[8] === 'James Smith', `owner identified as James Smith (got "${smith[8] ?? ''}")`);
      check(smith[9] === 'office@smithroofing.com', `general contact email used (got "${smith[9] ?? ''}")`);
      check(
        !content.includes('james@smithroofing.com'),
        'no email was fabricated from the owner name and domain',
      );
      check(smith[5] === 'https://www.instagram.com/smithroofing', 'Instagram profile captured');
      check(smith[7] === 'https://www.linkedin.com/company/smith-roofing', 'LinkedIn company page captured');
      check(smith[2] === '+15125550142', `phone normalised to E.164 (got "${smith[2] ?? ''}")`);
    }

    const dental = byName.get('Bluebonnet Dental');
    check(dental !== undefined, 'Bluebonnet Dental is present');
    if (dental) {
      check(dental[8] === 'Priya Raman', `founder identified (got "${dental[8] ?? ''}")`);
      check(dental[10] === '$1m-$5m', `revenue bracket estimated from headcount (got "${dental[10] ?? ''}")`);
    }

    const northside = byName.get('Northside Air');
    check(northside !== undefined, 'a site with nothing to extract still produced a row');
    if (northside) {
      check(northside[8] === '', 'no owner invented from a name without a title');
      check(northside[10] === '', 'no revenue invented without evidence');
    }

    check(byName.has('Ghost Plumbing'), 'a business with an unreachable website still produced a row');
    check(byName.has('No Website Co'), 'a business with no website at all still produced a row');

    console.log(`\n[SMOKE] PASSED — CSV at ${csvPath}\n`);
    console.log(content);
  } finally {
    server.close();
    rmSync(outputDir, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
