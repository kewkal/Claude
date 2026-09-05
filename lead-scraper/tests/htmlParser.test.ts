import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  cleanPersonName,
  extractBusinessName,
  extractEmails,
  extractLinks,
  extractOwner,
  extractPhones,
  extractRevenueSignals,
  extractServices,
  extractSocials,
  isLikelyService,
  isPersonName,
  looksLikeSpaShell,
  matchOwnerTitle,
  parseHtml,
} from '../src/parsers/htmlParser.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const load = (name: string): ReturnType<typeof parseHtml> =>
  parseHtml(readFileSync(join(FIXTURES, `${name}.html`), 'utf8'));

const PAGE = 'https://smithroofing.com/';

describe('business name', () => {
  it('prefers structured data over the page title', () => {
    expect(extractBusinessName(load('wellFormed'))).toBe('Smith Roofing');
  });

  it('does not swallow a whole page when markup is malformed', () => {
    const name = extractBusinessName(load('malformed'));
    expect(name).toBe('Gulf Coast Plumbing');
  });
});

describe('email extraction', () => {
  it('reads mailto links and structured data', () => {
    const emails = extractEmails(load('wellFormed'), PAGE);
    expect(emails.map((e) => e.address)).toEqual(['office@smithroofing.com']);
    expect(emails[0]?.isGeneric).toBe(true);
  });

  it('finds every published address on a team page', () => {
    const emails = extractEmails(load('teamPage'), PAGE).map((e) => e.address);
    expect(emails).toContain('priya@bluebonnetdental.com');
    expect(emails).toContain('alan@bluebonnetdental.com');
    expect(emails).toContain('info@bluebonnetdental.com');
    expect(emails).toHaveLength(3);
  });

  it('decodes human obfuscation in body text', () => {
    expect(extractEmails(load('aboutPage'), PAGE).map((e) => e.address)).toEqual([
      'office@smithroofing.com',
    ]);
    expect(extractEmails(load('malformed'), PAGE).map((e) => e.address)).toEqual([
      'ray@gulfcoastplumbing.com',
    ]);
  });

  it('never invents an address when none is published', () => {
    expect(extractEmails(load('missingFields'), PAGE)).toEqual([]);
  });
});

describe('social extraction', () => {
  it('takes profile links and ignores share widgets', () => {
    const socials = extractSocials(load('wellFormed'));
    expect(socials).toEqual({
      instagram: 'https://www.instagram.com/smithroofing',
      facebook: 'https://www.facebook.com/smithroofing',
      linkedin: 'https://www.linkedin.com/company/smith-roofing',
    });
  });

  it('collapses duplicate links to a single profile per platform', () => {
    const socials = extractSocials(load('malformed'));
    expect(socials.instagram).toBe('https://www.instagram.com/gulfcoastplumbing');
    expect(socials.facebook).toBe('https://www.facebook.com/gulfcoastplumbing');
    expect(socials.linkedin).toBeUndefined();
  });

  it('returns nothing when the site has no socials', () => {
    expect(extractSocials(load('missingFields'))).toEqual({});
  });
});

describe('phone extraction', () => {
  it('normalises tel links and structured data to one number', () => {
    expect(extractPhones(load('wellFormed'), 'US')).toEqual(['+15125550142']);
  });

  it('returns nothing when no number is published', () => {
    expect(extractPhones(load('missingFields'), 'US')).toEqual([]);
  });
});

describe('owner extraction', () => {
  it('requires a qualifying title alongside the name', () => {
    const owner = extractOwner(load('aboutPage'), PAGE, 'Smith Roofing');
    expect(owner?.name).toBe('James Smith');
    expect(owner?.title.toLowerCase()).toContain('owner');
  });

  it('picks the founder over other staff on a team page', () => {
    const owner = extractOwner(load('teamPage'), PAGE, 'Bluebonnet Dental');
    expect(owner?.name).toBe('Priya Raman');
  });

  it('never promotes a non-owner title to owner', () => {
    const owner = extractOwner(load('aboutPage'), PAGE, 'Smith Roofing');
    expect(owner?.name).not.toBe('Maria Gonzalez'); // Office Manager
    expect(owner?.name).not.toBe('Danny Brooks'); // Lead Technician
  });

  it('returns null when names appear without ownership titles', () => {
    expect(extractOwner(load('missingFields'), PAGE, 'Northside Air')).toBeNull();
  });

  it('reads an owner out of malformed markup', () => {
    expect(extractOwner(load('malformed'), PAGE, 'Gulf Coast Plumbing')?.name).toBe('Ray Delacroix');
  });

  it('records the evidence it used', () => {
    expect(extractOwner(load('aboutPage'), PAGE, 'Smith Roofing')?.evidence).toBeTruthy();
  });
});

describe('matchOwnerTitle', () => {
  it('accepts ownership titles and scores stronger ones higher', () => {
    expect(matchOwnerTitle('Founder & Owner')?.confidence).toBe(100);
    expect(matchOwnerTitle('CEO')?.confidence).toBeGreaterThan(0);
    expect(matchOwnerTitle('President')?.confidence).toBeGreaterThan(0);
  });

  it('rejects titles that do not confer ownership', () => {
    expect(matchOwnerTitle('Office Manager')).toBeNull();
    expect(matchOwnerTitle('Lead Technician')).toBeNull();
    expect(matchOwnerTitle('Associate Dentist')).toBeNull();
    expect(matchOwnerTitle('Dental Hygienist')).toBeNull();
    expect(matchOwnerTitle('')).toBeNull();
  });
});

describe('isPersonName / cleanPersonName', () => {
  it('accepts real names and strips honorifics and credentials', () => {
    expect(isPersonName('James Smith')).toBe(true);
    expect(isPersonName('Dr. Priya Raman')).toBe(true);
    expect(cleanPersonName('Dr. Priya Raman, DDS')).toBe('Priya Raman');
    expect(cleanPersonName('Jane Doe, DDS, MBA')).toBe('Jane Doe');
    expect(isPersonName('Ludwig van Beethoven')).toBe(true);
  });

  it('rejects single words, service phrases and company names', () => {
    expect(isPersonName('James')).toBe(false);
    expect(isPersonName('Roof Replacement')).toBe(false);
    expect(isPersonName('Drain Cleaning')).toBe(false);
    expect(isPersonName('Smith Roofing')).toBe(false);
    expect(isPersonName('Contact Us')).toBe(false);
    expect(isPersonName('Call 512-555-0142')).toBe(false);
  });
});

describe('service extraction', () => {
  it('pulls concrete services from cards and navigation', () => {
    const services = extractServices(load('wellFormed'));
    expect(services).toContain('Residential Roofing');
    expect(services).toContain('Commercial Roofing');
    expect(services).toContain('Storm Damage Repair');
    expect(services).toContain('Roof Replacement');
    expect(services).toContain('Emergency Roof Repair');
  });

  it('rejects generic marketing phrases', () => {
    const services = extractServices(load('wellFormed'));
    expect(services).not.toContain('Quality Solutions');
    expect(services.some((s) => s.toLowerCase().includes('serving'))).toBe(false);
    expect(services).not.toContain('What We Do');
    expect(services).not.toContain('Home');
    expect(services).not.toContain('About Us');
    expect(services).not.toContain('Privacy Policy');
  });

  it('returns nothing for a site that is all marketing filler', () => {
    expect(extractServices(load('missingFields'), { isServicePage: true })).toEqual([]);
  });

  it('never turns staff names into services', () => {
    expect(extractServices(load('teamPage'), { isServicePage: true })).toEqual([]);
    expect(extractServices(load('aboutPage'), { isServicePage: true })).toEqual([]);
  });

  it('copes with malformed markup', () => {
    expect(extractServices(load('malformed'))).toEqual([
      'Drain Cleaning',
      'Water Heater Installation',
      'Slab Leak Detection',
    ]);
  });

  it('deduplicates case-insensitively', () => {
    const $ = parseHtml(`
      <div class="services">
        <h2>Roof Repair</h2><h2>ROOF REPAIR</h2><h2>roof repair</h2><h2>Gutter Installation</h2>
      </div>`);
    expect(extractServices($)).toEqual(['Roof Repair', 'Gutter Installation']);
  });
});

describe('isLikelyService', () => {
  it('accepts specific services', () => {
    expect(isLikelyService('Emergency Roof Repair')).toBe(true);
    expect(isLikelyService('Commercial Roofing')).toBe(true);
    expect(isLikelyService('Teeth Whitening')).toBe(true);
  });

  it('rejects filler, CTAs and contact details', () => {
    expect(isLikelyService('Quality Solutions')).toBe(false);
    expect(isLikelyService('Professional Services')).toBe(false);
    expect(isLikelyService('Serving Austin')).toBe(false);
    expect(isLikelyService('Learn More')).toBe(false);
    expect(isLikelyService('Get a Quote')).toBe(false);
    expect(isLikelyService('info@acme.com')).toBe(false);
    expect(isLikelyService('512-555-0142')).toBe(false);
    expect(isLikelyService('Why Choose Us')).toBe(false);
    expect(isLikelyService('')).toBe(false);
  });

  it('rejects the business name itself', () => {
    expect(isLikelyService('Smith Roofing', 'Smith Roofing')).toBe(false);
  });
});

describe('revenue signal extraction', () => {
  it('reads explicit headcount and location counts', () => {
    const signals = extractRevenueSignals(load('revenueSignals'));
    expect(signals.employeeCount).toBe(60);
    expect(signals.locationCount).toBe(3);
    expect(signals.publishedRevenueUsd).toBeNull();
  });

  it('does not mistake customer counts for employees', () => {
    const $ = parseHtml('<p>We have served over 25,000 happy customers since 1998.</p>');
    expect(extractRevenueSignals($).employeeCount).toBeNull();
  });

  it('reads a published revenue figure in either word order', () => {
    expect(
      extractRevenueSignals(parseHtml('<p>Annual revenue of $4.2 million in 2025.</p>')).publishedRevenueUsd,
    ).toBe(4_200_000);
    expect(
      extractRevenueSignals(parseHtml('<p>We did $12M in annual revenue last year.</p>')).publishedRevenueUsd,
    ).toBe(12_000_000);
  });

  it('reads numberOfEmployees from JSON-LD', () => {
    expect(extractRevenueSignals(load('teamPage')).employeeCount).toBe(24);
  });
});

describe('link extraction', () => {
  it('resolves relative links and drops non-HTML targets', () => {
    const links = extractLinks(load('wellFormed'), PAGE).map((l) => l.url);
    expect(links).toContain('https://smithroofing.com/about');
    expect(links).toContain('https://smithroofing.com/services');
    expect(links.some((l) => l.startsWith('mailto:'))).toBe(false);
    expect(links.some((l) => l.startsWith('tel:'))).toBe(false);
  });
});

describe('looksLikeSpaShell', () => {
  it('flags an empty mount point', () => {
    expect(looksLikeSpaShell('<html><body><div id="root"></div></body></html>')).toBe(true);
    expect(looksLikeSpaShell('')).toBe(true);
  });

  it('does not flag a real server-rendered page', () => {
    expect(looksLikeSpaShell(readFileSync(join(FIXTURES, 'wellFormed.html'), 'utf8'))).toBe(false);
  });
});
