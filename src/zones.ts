export type ZoneLayout = {
  name: string;
  color: string;
  rug: number;
  /** Desk grid origin (x, z) and how many columns before wrapping. */
  origin: [number, number];
  cols: number;
  spacing: [number, number];
};

/**
 * Four roomy zones sized for the default roster of 10.
 * Extra bots in a zone wrap onto further rows; the rug grows with them.
 */
export const ZONE_LAYOUTS: ZoneLayout[] = [
  {
    name: 'Leadership',
    color: '#3b6cff',
    rug: 0xd5e2ff,
    origin: [-7.6, -5.2],
    cols: 2,
    spacing: [3.2, 2.6],
  },
  {
    name: 'Research',
    color: '#7c5cff',
    rug: 0xe4defc,
    origin: [-8.2, 2.4],
    cols: 3,
    spacing: [2.8, 2.6],
  },
  {
    name: 'Media',
    color: '#e08a2c',
    rug: 0xffe4c4,
    origin: [4.6, -5.2],
    cols: 2,
    spacing: [3.2, 2.6],
  },
  {
    name: 'Ops & Life',
    color: '#1f9d6a',
    rug: 0xd3f3e4,
    origin: [3.6, 2.4],
    cols: 3,
    spacing: [2.8, 2.6],
  },
];

export const ZONE_ORDER = ZONE_LAYOUTS.map((zone) => zone.name);

export const MEETING = { x: 0, z: -1.15 };

export const LOUNGE = { x: 0, z: 6.15 };

export function zoneLayout(name: string): ZoneLayout {
  return (
    ZONE_LAYOUTS.find((zone) => zone.name === name) ?? {
      name,
      color: '#5c6378',
      rug: 0xe4e7f0,
      origin: [-2, 8.2],
      cols: 4,
      spacing: [2.4, 2.4],
    }
  );
}

export function slotPosition(zone: ZoneLayout, index: number): { x: number; z: number } {
  const col = index % zone.cols;
  const row = Math.floor(index / zone.cols);
  return {
    x: zone.origin[0] + col * zone.spacing[0],
    z: zone.origin[1] + row * zone.spacing[1],
  };
}
