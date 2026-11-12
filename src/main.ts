import './style.css';
import { stepSimulation } from './simulation';
import { Office } from './scene';
import { countByStatus, formatLastActive, isSampleFeed, parseStatus, resolveFeedUrl } from './status';
import type { Bot, LightMode, OfficeStatus, Status } from './types';
import { ZONE_ORDER } from './zones';

const STATUS_LABEL: Record<Status, string> = {
  working: 'Working',
  idle: 'Idle',
  blocked: 'Blocked',
  offline: 'Offline',
};

function required<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node as T;
}

const canvas = required<HTMLCanvasElement>('#office');
const rosterEl = required<HTMLUListElement>('#roster');
const feedEl = required<HTMLOListElement>('#feed');
const pillsEl = required<HTMLDivElement>('#pills');
const detailEl = required<HTMLElement>('#detail');
const badgeEl = required<HTMLElement>('#mode-badge');
const updatedEl = required<HTMLTimeElement>('#updated');
const bannerEl = required<HTMLParagraphElement>('#banner');
const countEl = required<HTMLElement>('#team-count');
const lightButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-light]')];

let state: OfficeStatus | null = null;
let mode: 'sim' | 'live' = 'sim';
let pinned: string | null = null;
let hovered: string | null = null;
let filter: Status | 'all' = 'all';
let simTimer = 0;
let pollTimer = 0;

const office = new Office(canvas, {
  onHover: (id) => {
    hovered = id;
    paint();
  },
  onSelect: (id) => {
    pinned = id;
    paint();
  },
});

lightButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const next = button.dataset.light as LightMode;
    lightButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    office.setLight(next);
  });
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    pinned = null;
    office.setSelected(null);
    paint();
  }
});

void boot();

async function boot(): Promise<void> {
  const page = window.location.href;
  const requested = new URL(page).searchParams.get('feed');
  try {
    const response = await fetch(resolveFeedUrl(page), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Feed responded ${response.status}`);
    adopt(parseStatus(await response.json()));
    bannerEl.hidden = true;
  } catch (error) {
    const fallback = await fetch(new URL('status.sample.json', page), { cache: 'no-store' });
    adopt(parseStatus(await fallback.json()));
    bannerEl.hidden = false;
    bannerEl.textContent = requested
      ? `Could not read the feed (${message(error)}). Showing sample data.`
      : `Could not read status.json (${message(error)}). Showing sample data.`;
  }
  office.start();
  pollTimer = window.setInterval(() => void poll(), 15000);
  document.body.dataset.ready = 'true';
}

async function poll(): Promise<void> {
  try {
    const response = await fetch(resolveFeedUrl(window.location.href), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Feed responded ${response.status}`);
    adopt(parseStatus(await response.json()));
    bannerEl.hidden = true;
  } catch (error) {
    bannerEl.hidden = false;
    bannerEl.textContent = `Feed update failed (${message(error)}).`;
  }
}

function adopt(next: OfficeStatus): void {
  const sample = isSampleFeed(next);
  if (sample) {
    if (mode !== 'sim' || !state) {
      mode = 'sim';
      state = next;
      startSim();
      commit();
    }
    return;
  }
  stopSim();
  mode = 'live';
  state = next;
  commit();
}

function startSim(): void {
  stopSim();
  simTimer = window.setInterval(() => {
    if (!state) return;
    state = stepSimulation(state);
    commit();
  }, 4500);
}

function stopSim(): void {
  if (simTimer) window.clearInterval(simTimer);
  simTimer = 0;
}

function commit(): void {
  if (!state) return;
  office.setData(state);
  paint();
}

function paint(): void {
  if (!state) return;
  const active = hovered ?? pinned;
  badgeEl.hidden = mode !== 'sim';
  updatedEl.textContent = mode === 'sim' ? 'Sample data' : `Updated ${formatLastActive(state.generated_at)}`;
  countEl.textContent = `${state.bots.length} bots`;
  paintPills(state);
  paintDetail(state.bots.find((bot) => bot.id === active) ?? null);
  paintRoster(state);
  paintFeed(state);
}

function paintPills(current: OfficeStatus): void {
  const counts = countByStatus(current.bots);
  const items: Array<Status | 'all'> = ['all', 'working', 'idle', 'blocked', 'offline'];
  pillsEl.innerHTML = items
    .map((item) => {
      const pressed = item === filter;
      if (item === 'all') {
        return `<button type="button" data-filter="all" aria-pressed="${pressed}">All <em>${current.bots.length}</em></button>`;
      }
      return `<button type="button" data-filter="${item}" aria-pressed="${pressed}"><span class="dot ${item}"></span>${STATUS_LABEL[item]} <em>${counts[item]}</em></button>`;
    })
    .join('');
  pillsEl.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.addEventListener('click', () => {
      filter = button.dataset.filter as Status | 'all';
      paint();
    });
  });
}

function paintDetail(bot: Bot | null): void {
  if (!bot) {
    detailEl.hidden = true;
    detailEl.innerHTML = '';
    return;
  }
  detailEl.hidden = false;
  detailEl.innerHTML = `
    <p class="kicker" style="color:${zoneColor(bot.zone)}">${escapeHtml(bot.zone)}</p>
    <h3>${escapeHtml(bot.name)}</h3>
    <p class="task">${escapeHtml(bot.task)}</p>
    <p class="meta"><span class="dot ${bot.status}"></span>${STATUS_LABEL[bot.status]} · last active ${escapeHtml(formatLastActive(bot.last_active))}</p>
  `;
}

function paintRoster(current: OfficeStatus): void {
  const active = hovered ?? pinned;
  const bots = [...current.bots]
    .filter((bot) => filter === 'all' || bot.status === filter)
    .sort((a, b) => zoneRank(a.zone) - zoneRank(b.zone) || a.name.localeCompare(b.name));
  if (bots.length === 0) {
    rosterEl.innerHTML = '<li class="empty">No bots in this filter.</li>';
    return;
  }
  rosterEl.innerHTML = bots
    .map((bot) => {
      return `<li><button type="button" data-id="${escapeHtml(bot.id)}" aria-pressed="${bot.id === active}">
        <span class="dot ${bot.status}"></span>
        <span class="name">${escapeHtml(bot.name)}</span>
        <span class="sub">${escapeHtml(bot.zone)} · ${STATUS_LABEL[bot.status]}</span>
      </button></li>`;
    })
    .join('');
  rosterEl.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    const id = button.dataset.id ?? null;
    button.addEventListener('mouseenter', () => {
      hovered = id;
      if (id) office.setHovered(id);
      paintDetail(current.bots.find((bot) => bot.id === id) ?? null);
      button.setAttribute('aria-pressed', 'true');
    });
    button.addEventListener('mouseleave', () => {
      hovered = null;
      office.setHovered(null);
      paint();
    });
    button.addEventListener('focus', () => {
      hovered = id;
      if (id) office.setHovered(id);
      paintDetail(current.bots.find((bot) => bot.id === id) ?? null);
    });
    button.addEventListener('click', () => {
      pinned = pinned === id ? null : id;
      office.setSelected(pinned);
      paint();
    });
  });
}

function paintFeed(current: OfficeStatus): void {
  if (current.activity.length === 0) {
    feedEl.innerHTML = '<li class="empty">No activity yet.</li>';
    return;
  }
  const names = new Map(current.bots.map((bot) => [bot.id, bot.name]));
  feedEl.innerHTML = current.activity
    .slice(0, 12)
    .map((item) => {
      const name = names.get(item.bot_id) ?? item.bot_id;
      return `<li><time datetime="${escapeHtml(item.ts)}">${escapeHtml(formatLastActive(item.ts))}</time><strong>${escapeHtml(name)}</strong><span>${escapeHtml(item.text)}</span></li>`;
    })
    .join('');
}

function zoneRank(zone: string): number {
  const index = ZONE_ORDER.indexOf(zone);
  return index === -1 ? ZONE_ORDER.length : index;
}

function zoneColor(zone: string): string {
  if (zone === 'Leadership') return '#3b6cff';
  if (zone === 'Research') return '#7c5cff';
  if (zone === 'Media') return '#e08a2c';
  if (zone === 'Ops & Life') return '#1f9d6a';
  return '#5c6378';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
