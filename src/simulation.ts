import type { OfficeStatus, Status } from './types';

const STATUSES: Status[] = ['working', 'idle', 'blocked', 'offline'];

const TASKS: Record<Status, string[]> = {
  working: [
    'Sample: Working at the desk',
    'Sample: Drafting a short note',
    'Sample: In a meeting at the table',
    'Sample: Reviewing notes',
  ],
  idle: ['Sample: In the lounge', 'Sample: Taking a break'],
  blocked: ['Sample: Waiting on input', 'Sample: Blocked on a decision'],
  offline: ['Sample: Offline'],
};

const LINES = [
  'Sample: started a short task at the desk',
  'Sample: walked over to the lounge',
  'Sample: waiting on input',
  'Sample: stepped away',
  'Sample: back at the desk',
  'Sample: joined a sync at the table',
];

export type Rng = () => number;

/** Rotate one bot's coarse status and append a generic sample activity line. */
export function stepSimulation(state: OfficeStatus, rng: Rng = Math.random, now = new Date()): OfficeStatus {
  if (state.bots.length === 0) return state;
  const index = Math.floor(rng() * state.bots.length);
  const current = state.bots[index];
  const options = STATUSES.filter((status) => status !== current.status);
  const nextStatus = options[Math.floor(rng() * options.length)];
  const choices = TASKS[nextStatus];
  const task = choices[Math.floor(rng() * choices.length)];
  const iso = now.toISOString();
  const bots = state.bots.map((bot, i) => (i === index ? { ...bot, status: nextStatus, task, last_active: iso } : bot));
  const text = LINES[Math.floor(rng() * LINES.length)];
  const activity = [{ ts: iso, bot_id: current.id, text }, ...state.activity].slice(0, 40);
  return {
    ...state,
    generated_at: iso,
    source: 'sample',
    notice: state.notice ?? 'SAMPLE DATA — not a live feed',
    bots,
    activity,
  };
}
