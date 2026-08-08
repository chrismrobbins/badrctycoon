/**
 * Staff kinds are content data, same reasoning as content/awards.ts: the wage
 * is read by sim/staff.ts, the label/color/icon/blurb are read by the
 * management UI and the canvas renderer, and having two copies is how they'd
 * drift.
 */

export type StaffKindId = 'janitor' | 'mechanic' | 'entertainer';

export interface StaffKindDef {
  label: string;
  wage: number;
  color: string;
  icon: string;
  blurb: string;
}

export const STAFF_KINDS: Record<StaffKindId, StaffKindDef> = {
  janitor: { label: 'Janitor', wage: 30, color: '#22c55e', icon: 'fa-broom', blurb: 'Sweeps litter off your paths' },
  mechanic: { label: 'Mechanic', wage: 48, color: '#f59e0b', icon: 'fa-wrench', blurb: 'Repairs breakdowns far faster' },
  entertainer: {
    label: 'Entertainer',
    wage: 36,
    color: '#ec4899',
    icon: 'fa-masks-theater',
    blurb: 'Cheers up guests stuck in queues',
  },
};

export const STAFF_NAMES = ['Dana', 'Kwame', 'Rosa', 'Ivan', 'Mei', 'Tariq', 'Nora', 'Luis', 'Ada', 'Omar', 'Zoe', 'Pete'];
