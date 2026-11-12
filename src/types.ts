export const STATUSES = ['working', 'idle', 'blocked', 'offline'] as const;

export type Status = (typeof STATUSES)[number];

export type Bot = {
  id: string;
  name: string;
  zone: string;
  status: Status;
  task: string;
  last_active: string;
};

export type Activity = {
  ts: string;
  bot_id: string;
  text: string;
};

export type OfficeStatus = {
  generated_at: string;
  bots: Bot[];
  activity: Activity[];
  source?: string;
  notice?: string;
};

export type LightMode = 'day' | 'evening' | 'night';

export type Destination = 'desk' | 'break' | 'meeting';

export type Behaviour = {
  destination: Destination;
  pose: 'seated' | 'standing';
  typing: boolean;
  monitorGlow: boolean;
  lampOn: boolean;
  greyed: boolean;
  alert: boolean;
};
