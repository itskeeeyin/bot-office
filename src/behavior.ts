import type { Behaviour, Destination, Status } from './types';

const MEETING = /\b(meet|meeting|sync|huddle|table)\b/i;

/** Where a bot should go, and how the desk should look, for a status. */
export function behaviourFor(status: Status, task = ''): Behaviour {
  const destination = destinationFor(status, task);
  switch (status) {
    case 'working':
      return {
        destination,
        pose: destination === 'meeting' ? 'standing' : 'seated',
        typing: destination === 'desk',
        monitorGlow: true,
        lampOn: true,
        greyed: false,
        alert: false,
      };
    case 'idle':
      return {
        destination: 'break',
        pose: 'standing',
        typing: false,
        monitorGlow: false,
        lampOn: true,
        greyed: false,
        alert: false,
      };
    case 'blocked':
      return {
        destination: 'desk',
        pose: 'standing',
        typing: false,
        monitorGlow: false,
        lampOn: true,
        greyed: false,
        alert: true,
      };
    case 'offline':
      return {
        destination: 'desk',
        pose: 'seated',
        typing: false,
        monitorGlow: false,
        lampOn: false,
        greyed: true,
        alert: false,
      };
  }
}

export function destinationFor(status: Status, task = ''): Destination {
  if (status === 'idle') return 'break';
  if (status === 'blocked' || status === 'offline') return 'desk';
  if (MEETING.test(task)) return 'meeting';
  return 'desk';
}
