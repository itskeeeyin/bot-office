import { STATUSES, type Activity, type Bot, type OfficeStatus, type Status } from './types';

const STATUS_SET = new Set<string>(STATUSES);

export function parseStatus(input: unknown): OfficeStatus {
  if (!isRecord(input)) throw new Error('Status feed must be an object');
  const generated_at = requiredString(input, 'generated_at');
  if (!Array.isArray(input.bots)) throw new Error('Status feed is missing bots');
  if (!Array.isArray(input.activity)) throw new Error('Status feed is missing activity');

  const seen = new Set<string>();
  const bots = input.bots.map((raw, index) => parseBot(raw, index, seen));
  const activity = input.activity.map((raw, index) => parseActivity(raw, index));

  const status: OfficeStatus = { generated_at, bots, activity };
  if (typeof input.source === 'string') status.source = input.source;
  if (typeof input.notice === 'string') status.notice = input.notice;
  return status;
}

export function isSampleFeed(status: OfficeStatus): boolean {
  if (status.source === 'sample') return true;
  return Boolean(status.notice && /sample/i.test(status.notice));
}

/** `?feed=` wins. Otherwise status.json is resolved next to the current page URL. */
export function resolveFeedUrl(href: string): string {
  const url = new URL(href);
  const feed = url.searchParams.get('feed');
  if (feed && feed.trim()) return feed.trim();
  return new URL('status.json', url).toString();
}

export function formatLastActive(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const seconds = Math.round((now - t) / 1000);
  if (Math.abs(seconds) < 10) return 'just now';
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return new Date(t).toLocaleString();
}

export function countByStatus(bots: Bot[]): Record<Status, number> {
  const counts: Record<Status, number> = { working: 0, idle: 0, blocked: 0, offline: 0 };
  for (const bot of bots) counts[bot.status] += 1;
  return counts;
}

function parseBot(raw: unknown, index: number, seen: Set<string>): Bot {
  if (!isRecord(raw)) throw new Error(`Bot ${index} is not an object`);
  const id = requiredString(raw, 'id', `bots[${index}]`);
  if (seen.has(id)) throw new Error(`Duplicate bot id ${id}`);
  seen.add(id);
  const status = requiredString(raw, 'status', `bots[${index}]`);
  if (!STATUS_SET.has(status)) {
    throw new Error(`Bot ${id} has unknown status "${status}"`);
  }
  return {
    id,
    name: requiredString(raw, 'name', `bots[${index}]`),
    zone: requiredString(raw, 'zone', `bots[${index}]`),
    status: status as Status,
    task: requiredString(raw, 'task', `bots[${index}]`),
    last_active: requiredString(raw, 'last_active', `bots[${index}]`),
  };
}

function parseActivity(raw: unknown, index: number): Activity {
  if (!isRecord(raw)) throw new Error(`Activity ${index} is not an object`);
  return {
    ts: requiredString(raw, 'ts', `activity[${index}]`),
    bot_id: requiredString(raw, 'bot_id', `activity[${index}]`),
    text: requiredString(raw, 'text', `activity[${index}]`),
  };
}

function requiredString(obj: Record<string, unknown>, key: string, where = 'feed'): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
