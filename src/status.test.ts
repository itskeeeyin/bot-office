import { describe, expect, it } from 'vitest';
import shipped from '../public/status.json';
import sampleFile from '../public/status.sample.json';
import { countByStatus, formatLastActive, isSampleFeed, parseStatus, resolveFeedUrl } from './status';

const NAMES = [
  'Chief · Chief of Staff',
  'One-Person Company',
  'Scout',
  'Competitor Mapper',
  'Behavior Reverser',
  'Explainer Video bot',
  'Video Director',
  'Selling',
  'Tax Desk',
  'Get Hired 2027',
];

describe('parseStatus', () => {
  it('parses the sample roster of 10 bots', () => {
    const status = parseStatus(sampleFile);
    expect(status.bots).toHaveLength(10);
    expect(status.bots.map((bot) => bot.name)).toEqual(NAMES);
    expect(new Set(status.bots.map((bot) => bot.zone))).toEqual(
      new Set(['Leadership', 'Research', 'Media', 'Ops & Life']),
    );
    expect(isSampleFeed(status)).toBe(true);
    expect(status.notice).toMatch(/sample/i);
    expect(status.activity.length).toBeGreaterThan(0);
    expect(countByStatus(status.bots)).toEqual({ working: 5, idle: 2, blocked: 2, offline: 1 });
  });

  it('keeps the shipped status.json labelled as sample data', () => {
    expect(isSampleFeed(parseStatus(shipped))).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(() =>
      parseStatus({
        generated_at: '2026-11-12T00:00:00Z',
        bots: [
          {
            id: 'scout',
            name: 'Scout',
            zone: 'Research',
            status: 'asleep',
            task: 'Sample: napping',
            last_active: '2026-11-12T00:00:00Z',
          },
        ],
        activity: [],
      }),
    ).toThrow(/unknown status/i);
  });

  it('rejects duplicate ids and missing fields', () => {
    const bot = {
      id: 'scout',
      name: 'Scout',
      zone: 'Research',
      status: 'idle',
      task: 'Sample: In the lounge',
      last_active: '2026-11-12T00:00:00Z',
    };
    expect(() =>
      parseStatus({ generated_at: '2026-11-12T00:00:00Z', bots: [bot, bot], activity: [] }),
    ).toThrow(/duplicate/i);
    expect(() => parseStatus({ bots: [], activity: [] })).toThrow(/generated_at/);
    expect(() =>
      parseStatus({
        generated_at: '2026-11-12T00:00:00Z',
        bots: [{ ...bot, task: '  ' }],
        activity: [],
      }),
    ).toThrow(/task/);
  });
});

describe('resolveFeedUrl', () => {
  it('uses the feed query when present', () => {
    expect(resolveFeedUrl('http://localhost:5173/?feed=https%3A%2F%2Fexample.com%2Fstatus.json')).toBe(
      'https://example.com/status.json',
    );
  });

  it('defaults to status.json beside the page', () => {
    expect(resolveFeedUrl('http://localhost:5173/')).toBe('http://localhost:5173/status.json');
    expect(resolveFeedUrl('http://localhost:5173/index.html')).toBe('http://localhost:5173/status.json');
  });
});

describe('formatLastActive', () => {
  const now = Date.parse('2026-11-12T00:10:00Z');

  it('formats recent timestamps', () => {
    expect(formatLastActive('2026-11-12T00:10:00Z', now)).toBe('just now');
    expect(formatLastActive('2026-11-12T00:09:20Z', now)).toBe('40s ago');
    expect(formatLastActive('2026-11-12T00:02:00Z', now)).toBe('8m ago');
    expect(formatLastActive('2026-11-11T20:10:00Z', now)).toBe('4h ago');
  });
});
