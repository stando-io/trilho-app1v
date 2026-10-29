export const SCREENS = [
  'home',
  'dashboard',
  'base',
  'kanban',
  'reports',
  'settings',
] as const;

export type Screen = (typeof SCREENS)[number];

export function isValidScreens(value: unknown): value is Screen[] {
  return (
    Array.isArray(value) &&
    value.every((item) => SCREENS.includes(item as Screen))
  );
}
