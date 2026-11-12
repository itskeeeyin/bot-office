import { describe, expect, it } from 'vitest';
import { behaviourFor, destinationFor } from './behavior';
import type { Status } from './types';

describe('behaviourFor', () => {
  it('seats a working bot at the desk with a glowing monitor', () => {
    expect(behaviourFor('working', 'Writing notes')).toEqual({
      destination: 'desk',
      pose: 'seated',
      typing: true,
      monitorGlow: true,
      lampOn: true,
      greyed: false,
      alert: false,
    });
  });

  it('sends a working bot to the meeting table when the task says so', () => {
    const behaviour = behaviourFor('working', 'Sample: In a meeting at the table');
    expect(behaviour.destination).toBe('meeting');
    expect(behaviour.pose).toBe('standing');
    expect(behaviour.typing).toBe(false);
    expect(behaviour.monitorGlow).toBe(true);
  });

  it('sends an idle bot to the lounge', () => {
    expect(behaviourFor('idle').destination).toBe('break');
    expect(behaviourFor('idle').pose).toBe('standing');
    expect(behaviourFor('idle').lampOn).toBe(true);
    expect(behaviourFor('idle').monitorGlow).toBe(false);
  });

  it('stands a blocked bot at the desk with an alert', () => {
    const behaviour = behaviourFor('blocked', 'Waiting on input');
    expect(behaviour).toMatchObject({
      destination: 'desk',
      pose: 'standing',
      alert: true,
      typing: false,
      lampOn: true,
      greyed: false,
    });
  });

  it('greys out an offline bot and switches the desk lamp off', () => {
    expect(behaviourFor('offline')).toEqual({
      destination: 'desk',
      pose: 'seated',
      typing: false,
      monitorGlow: false,
      lampOn: false,
      greyed: true,
      alert: false,
    });
  });
});

describe('destinationFor', () => {
  it.each<[Status, string, string]>([
    ['working', 'sync at the table', 'meeting'],
    ['working', 'huddle', 'meeting'],
    ['idle', 'In a meeting at the table', 'break'],
    ['blocked', 'meet', 'desk'],
    ['offline', '', 'desk'],
  ])('%s + %j -> %s', (status, task, destination) => {
    expect(destinationFor(status, task)).toBe(destination);
  });
});
