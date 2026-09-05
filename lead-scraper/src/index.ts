#!/usr/bin/env node
/**
 * CLI entry point: parse and validate arguments, wire the source registry,
 * install signal handlers, run, report.
 *
 * Validation happens before any network call, so a typo costs nothing.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Command, InvalidArgumentError } from 'commander';

import { DEFAULTS } from './config.js';
import { printSummary, runScrape } from './scraper.js';
import { FixtureSource } from './sources/fixture.js';
import { GooglePlacesSource } from './sources/googlePlaces.js';
import { OverpassSource } from './sources/overpass.js';
import { SourceRegistry } from './sources/sourceAdapter.js';
import type { RunOptions } from './types/lead.js';
import { describeError, log, setDebug } from './utils/logger.js';

interface RawOptions {
  vertical: string;
  location: string;
  limit: number;
  concurrency: number;
  headless: boolean;
  maxPagesPerSite: number;
  source: string;
  outputDir: string;
  debug: boolean;
  fixtureManifest?: string;
  fixtureBaseUrl?: string;
}

function integerInRange(label: string, min: number, max: number): (value: string) => number {
  return (value: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new InvalidArgumentError(`${label} must be a whole number between ${min} and ${max} (got "${value}")`);
    }
    return parsed;
  };
}

/** `--headless`, `--headless true`, `--headless=false` all behave sensibly. */
function parseBoolean(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', ''].includes(normalised)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalised)) return false;
  throw new InvalidArgumentError(`expected true or false, got "${value}"`);
}

function requireNonEmpty(label: string): (value: string) => string {
  return (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length < 2) throw new InvalidArgumentError(`${label} must be at least 2 characters`);
    if (trimmed.length > 120) throw new InvalidArgumentError(`${label} must be at most 120 characters`);
    return trimmed;
  };
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('scrape')
    .description('Discover and enrich B2B leads for a vertical in a location, streaming results to CSV.')
    .requiredOption('--vertical <string>', 'business vertical, e.g. "HVAC Contractors"', requireNonEmpty('--vertical'))
    .requiredOption('--location <string>', 'location, e.g. "Houston, TX"', requireNonEmpty('--location'))
    .option('--limit <number>', 'maximum businesses to process', integerInRange('--limit', 1, 5_000), DEFAULTS.limit)
    .option('--concurrency <number>', 'businesses enriched in parallel', integerInRange('--concurrency', 1, 20), DEFAULTS.concurrency)
    .option('--headless [boolean]', 'run the browser headless', parseBoolean, DEFAULTS.headless)
    .option('--max-pages-per-site <number>', 'pages crawled per business website', integerInRange('--max-pages-per-site', 1, 50), DEFAULTS.maxPagesPerSite)
    .option('--source <name>', 'discovery source: auto, overpass, google-places, fixture', DEFAULTS.source)
    .option('--output-dir <path>', 'directory for CSV output', DEFAULTS.outputDir)
    .option('--debug', 'verbose diagnostics on stderr', false)
    .option('--fixture-manifest <path>', 'JSON manifest for --source fixture')
    .option('--fixture-base-url <url>', 'base URL for relative fixture websites');
  return program;
}

export function buildRegistry(options: { fixtureManifest?: string; fixtureBaseUrl?: string }): SourceRegistry {
  // Registration order is `auto` precedence: Places first (it has ratings),
  // falling through to OpenStreetMap when no API key is configured.
  return new SourceRegistry()
    .register(new GooglePlacesSource())
    .register(new OverpassSource())
    .register(
      new FixtureSource(
        options.fixtureManifest ?? process.env['FIXTURE_MANIFEST'] ?? null,
        options.fixtureBaseUrl ?? process.env['FIXTURE_BASE_URL'] ?? null,
      ),
    );
}

export async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram();
  program.parse([...argv], { from: 'user' });
  const raw = program.opts<RawOptions>();

  setDebug(raw.debug);

  const options: RunOptions = {
    vertical: raw.vertical,
    location: raw.location,
    limit: raw.limit,
    concurrency: raw.concurrency,
    headless: raw.headless,
    maxPagesPerSite: raw.maxPagesPerSite,
    source: raw.source,
    debug: raw.debug,
    outputDir: raw.outputDir,
  };

  const registry = buildRegistry(raw);
  const controller = new AbortController();

  let shuttingDown = false;
  const onSignal = (signalName: string): void => {
    if (shuttingDown) {
      log.warn('second interrupt — exiting immediately');
      process.exit(130);
    }
    shuttingDown = true;
    log.warn(`${signalName} received — finishing in-flight work, then writing the CSV. Interrupt again to force quit.`);
    controller.abort(new Error(signalName));
  };
  const sigint = (): void => onSignal('SIGINT');
  const sigterm = (): void => onSignal('SIGTERM');
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);

  // An unhandled rejection anywhere should be visible, not silently fatal.
  const onUnhandled = (reason: unknown): void => {
    log.error(`unhandled rejection: ${describeError(reason)}`);
  };
  process.on('unhandledRejection', onUnhandled);

  try {
    log.stage('RUN', `${options.vertical} in ${options.location} (limit ${options.limit}, concurrency ${options.concurrency})`);
    const result = await runScrape(options, registry, controller.signal);
    printSummary(result);
    return controller.signal.aborted ? 130 : 0;
  } catch (error) {
    log.error(describeError(error));
    if (raw.debug && error instanceof Error && error.stack) log.error(error.stack);
    return 1;
  } finally {
    process.off('SIGINT', sigint);
    process.off('SIGTERM', sigterm);
    process.off('unhandledRejection', onUnhandled);
  }
}

/** True when this file is the process entry point (rather than an import in a test). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      log.error(describeError(error));
      process.exitCode = 1;
    });
}
