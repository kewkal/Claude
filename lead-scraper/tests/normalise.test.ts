import { describe, expect, it } from 'vitest';

import {
  backoffDelay,
  canonicaliseUrl,
  classifyEmail,
  deobfuscateEmails,
  isGenericEmail,
  isPublicHost,
  isSameRegistrableDomain,
  isValidEmail,
  normaliseBusinessName,
  normalisePhone,
  normaliseSocialUrl,
  normaliseWhitespace,
  phoneDedupeKey,
  regionFromLocation,
  registrableDomain,
  slugify,
  tidyServiceLabel,
  timestampSlug,
  toAbsoluteUrl,
  uniqueCaseInsensitive,
} from '../src/utils/normalise.js';

describe('normaliseWhitespace', () => {
  it('collapses newlines, tabs and non-breaking spaces', () => {
    expect(normaliseWhitespace('  Smith\n\tRoofing Co.  ')).toBe('Smith Roofing Co.');
  });
});

describe('slugify / timestampSlug', () => {
  it('produces filesystem-safe slugs', () => {
    expect(slugify('HVAC Contractors')).toBe('hvac-contractors');
    expect(slugify('Houston, TX')).toBe('houston-tx');
    expect(slugify('Café & Grill')).toBe('cafe-grill');
  });

  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('unknown');
  });

  it('formats timestamps as YYYYMMDD-HHmmss', () => {
    expect(timestampSlug(new Date(2026, 8, 4, 13, 5, 2))).toBe('20260904-130502');
  });
});

describe('toAbsoluteUrl', () => {
  it('accepts bare hosts and protocol-relative URLs', () => {
    expect(toAbsoluteUrl('smithroofing.com')).toBe('https://smithroofing.com/');
    expect(toAbsoluteUrl('//cdn.example.org/a')).toBe('https://cdn.example.org/a');
  });

  it('resolves relative paths against a base', () => {
    expect(toAbsoluteUrl('/about', 'https://acme.com/services')).toBe('https://acme.com/about');
  });

  it('rejects non-http schemes and junk', () => {
    expect(toAbsoluteUrl('mailto:a@b.com')).toBeNull();
    expect(toAbsoluteUrl('tel:+15125550142')).toBeNull();
    expect(toAbsoluteUrl('javascript:void(0)')).toBeNull();
    expect(toAbsoluteUrl('#top')).toBeNull();
    expect(toAbsoluteUrl('')).toBeNull();
    expect(toAbsoluteUrl(null)).toBeNull();
  });
});

describe('canonicaliseUrl', () => {
  it('normalises scheme, www, trailing slash and fragment', () => {
    expect(canonicaliseUrl('http://WWW.Acme.com/About/#team')).toBe('https://acme.com/About');
  });

  it('strips tracking parameters but keeps meaningful ones', () => {
    expect(canonicaliseUrl('https://acme.com/p?utm_source=google&id=7&fbclid=xyz')).toBe(
      'https://acme.com/p?id=7',
    );
  });

  it('sorts remaining query parameters so duplicates collapse', () => {
    expect(canonicaliseUrl('https://acme.com/p?b=2&a=1')).toBe(canonicaliseUrl('https://acme.com/p?a=1&b=2'));
  });

  it('collapses duplicate slashes', () => {
    expect(canonicaliseUrl('https://acme.com//a//b/')).toBe('https://acme.com/a/b');
  });
});

describe('registrableDomain / isSameRegistrableDomain', () => {
  it('handles multi-part public suffixes', () => {
    expect(registrableDomain('https://shop.acme.co.uk/x')).toBe('acme.co.uk');
    expect(registrableDomain('www.acme.com')).toBe('acme.com');
  });

  it('treats subdomains as the same site', () => {
    expect(isSameRegistrableDomain('https://acme.com/a', 'https://blog.acme.com/b')).toBe(true);
    expect(isSameRegistrableDomain('https://acme.com', 'https://acme.net')).toBe(false);
    // acme.co.uk and other.co.uk share a public suffix but are different businesses.
    expect(isSameRegistrableDomain('https://acme.co.uk', 'https://other.co.uk')).toBe(false);
  });

  it('rejects IP addresses as public hosts', () => {
    expect(isPublicHost('https://192.168.0.1/')).toBe(false);
    expect(isPublicHost('https://acme.com/')).toBe(true);
  });
});

describe('normalisePhone', () => {
  it('normalises US numbers to E.164 given a region', () => {
    expect(normalisePhone('(512) 555-0142', 'US')).toBe('+15125550142');
    expect(normalisePhone('512.555.0142', 'US')).toBe('+15125550142');
    expect(normalisePhone('tel:+1-512-555-0142', 'US')).toBe('+15125550142');
  });

  it('preserves international numbers without a matching region', () => {
    expect(normalisePhone('+44 20 7946 0958', 'US')).toBe('+442079460958');
    expect(normalisePhone('+61 2 9374 4000', null)).toBe('+61293744000');
  });

  it('drops extensions and rejects non-numbers', () => {
    expect(normalisePhone('(512) 555-0142 ext. 12', 'US')).toBe('+15125550142');
    expect(normalisePhone('call us today', 'US')).toBeNull();
    expect(normalisePhone('123', 'US')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });

  it('still yields a stable dedupe key for the same line in different formats', () => {
    expect(phoneDedupeKey(normalisePhone('(512) 555-0142', 'US'))).toBe(
      phoneDedupeKey(normalisePhone('+1 512 555 0142', 'US')),
    );
  });
});

describe('regionFromLocation', () => {
  it('recognises US states and countries', () => {
    expect(regionFromLocation('Houston, TX')).toBe('US');
    expect(regionFromLocation('Dallas, Texas, USA')).toBe('US');
    expect(regionFromLocation('Manchester, United Kingdom')).toBe('GB');
    expect(regionFromLocation('Toronto, Canada')).toBe('CA');
  });

  it('returns null when it genuinely cannot tell', () => {
    expect(regionFromLocation('Springfield')).toBeNull();
  });
});

describe('email helpers', () => {
  it('validates syntax and rejects placeholders', () => {
    expect(isValidEmail('office@smithroofing.com')).toBe(true);
    expect(isValidEmail('a.b+c@sub.domain.co.uk')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a@@b.com')).toBe(false);
    expect(isValidEmail('someone@example.com')).toBe(false);
    expect(isValidEmail('logo@2x.png')).toBe(false);
  });

  it('recognises shared inboxes', () => {
    expect(isGenericEmail('info@acme.com')).toBe(true);
    expect(isGenericEmail('front.desk@acme.com')).toBe(true);
    expect(isGenericEmail('sales@acme.com')).toBe(true);
    expect(isGenericEmail('james@acme.com')).toBe(false);
  });

  it('only calls an address personal when it really matches the person', () => {
    expect(classifyEmail('james@smithroofing.com', 'James Smith')).toBe('personal');
    expect(classifyEmail('jsmith@smithroofing.com', 'James Smith')).toBe('personal');
    expect(classifyEmail('smith@smithroofing.com', 'James Smith')).toBe('personal');
    expect(classifyEmail('office@smithroofing.com', 'James Smith')).toBe('role');
    expect(classifyEmail('bob@smithroofing.com', 'James Smith')).toBe('unknown');
    expect(classifyEmail('james@smithroofing.com', null)).toBe('unknown');
  });

  it('recovers obfuscated addresses without inventing any', () => {
    expect(deobfuscateEmails('write to office [at] smithroofing [dot] com today')).toEqual([
      'office@smithroofing.com',
    ]);
    expect(deobfuscateEmails('ray (at) gulfcoastplumbing (dot) com')).toEqual([
      'ray@gulfcoastplumbing.com',
    ]);
    expect(deobfuscateEmails('Contact James Smith at Smith Roofing')).toEqual([]);
  });
});

describe('normaliseSocialUrl', () => {
  it('normalises real profile URLs', () => {
    expect(normaliseSocialUrl('https://instagram.com/SmithRoofing', 'instagram')).toBe(
      'https://www.instagram.com/smithroofing',
    );
    expect(normaliseSocialUrl('https://www.instagram.com/smithroofing/?hl=en', 'instagram')).toBe(
      'https://www.instagram.com/smithroofing',
    );
    expect(normaliseSocialUrl('https://facebook.com/SmithRoofing', 'facebook')).toBe(
      'https://www.facebook.com/SmithRoofing',
    );
    expect(normaliseSocialUrl('https://uk.linkedin.com/company/smith-roofing', 'linkedin')).toBe(
      'https://www.linkedin.com/company/smith-roofing',
    );
  });

  it('rejects share widgets, logins and platform homepages', () => {
    expect(
      normaliseSocialUrl('https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Facme.com', 'facebook'),
    ).toBeNull();
    expect(normaliseSocialUrl('https://www.facebook.com/login.php', 'facebook')).toBeNull();
    expect(normaliseSocialUrl('https://www.instagram.com/', 'instagram')).toBeNull();
    expect(normaliseSocialUrl('https://www.linkedin.com/shareArticle?url=x', 'linkedin')).toBeNull();
    expect(normaliseSocialUrl('https://www.instagram.com/p/Cabc123/', 'instagram')).toBeNull();
  });

  it('rejects personal LinkedIn profiles as a company page', () => {
    expect(normaliseSocialUrl('https://www.linkedin.com/in/james-smith-1234', 'linkedin')).toBeNull();
  });

  it('rejects a URL from the wrong platform', () => {
    expect(normaliseSocialUrl('https://instagram.com/smithroofing', 'facebook')).toBeNull();
  });
});

describe('normaliseBusinessName', () => {
  it('strips legal suffixes and punctuation for comparison', () => {
    expect(normaliseBusinessName('Smith Roofing, LLC')).toBe('smith roofing');
    expect(normaliseBusinessName('Smith Roofing Inc.')).toBe('smith roofing');
    expect(normaliseBusinessName('Smith & Sons Roofing')).toBe('smith and sons roofing');
  });
});

describe('uniqueCaseInsensitive / tidyServiceLabel', () => {
  it('deduplicates case-insensitively while keeping the first form', () => {
    expect(uniqueCaseInsensitive(['Roof Repair', 'roof repair', 'ROOF REPAIR', 'Gutters'])).toEqual([
      'Roof Repair',
      'Gutters',
    ]);
  });

  it('tidies bullet characters and title-cases shouty labels', () => {
    expect(tidyServiceLabel('  • Roof Replacement  ')).toBe('Roof Replacement');
    expect(tidyServiceLabel('EMERGENCY ROOF REPAIR')).toBe('Emergency Roof Repair');
    expect(tidyServiceLabel('Roof Repair | Learn more')).toBe('Roof Repair');
  });
});

describe('backoffDelay', () => {
  it('grows with attempts and stays inside the cap', () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const delay = backoffDelay(attempt, 800, 10_000);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(10_000);
    }
    const early = backoffDelay(0, 800, 10_000);
    expect(early).toBeLessThanOrEqual(800);
  });
});
