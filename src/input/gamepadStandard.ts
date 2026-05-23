/**
 * Standard Gamepad mapping (W3C) + small helpers.
 *
 * Manual QA: desktop Chrome + Xbox or generic XInput pad; console browsers (Xbox Edge, PS) may
 * differ on mapping, WebGL vs WebGPU, memory, and fullscreen gesture rules. Switch/TV browsers
 * are least predictable.
 */

export const GAMEPAD_AXIS_DEADZONE = 0.22;
export const GAMEPAD_TRIGGER_PRESS = 0.35;

/** Standard layout button indices (https://w3c.github.io/gamepad/#remapping) */
export const StdBtn = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  L3: 10,
  R3: 11,
  DUp: 12,
  DDown: 13,
  DLeft: 14,
  DRight: 15,
} as const;

export function applyAxisDeadzone(v: number, deadzone: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) {
    return 0;
  }
  const s = v < 0 ? -1 : 1;
  return s * ((a - deadzone) / (1 - deadzone));
}

export function readTrigger01(gp: Gamepad, index: 6 | 7): number {
  const b = gp.buttons[index];
  if (b === undefined) {
    return 0;
  }
  const v = typeof b.value === "number" ? b.value : b.pressed ? 1 : 0;
  return Math.max(0, Math.min(1, v));
}

export function readButtonPressed(gp: Gamepad, index: number): boolean {
  const b = gp.buttons[index];
  if (b === undefined) {
    return false;
  }
  if (typeof b.value === "number") {
    return b.value >= GAMEPAD_TRIGGER_PRESS;
  }
  return b.pressed === true;
}

export function readButtonValue(gp: Gamepad, index: number): number {
  const b = gp.buttons[index];
  if (b === undefined) {
    return 0;
  }
  return typeof b.value === "number" ? b.value : b.pressed ? 1 : 0;
}

export function pickPrimaryGamepad(): Gamepad | null {
  const list = navigator.getGamepads?.();
  if (list === undefined) {
    return null;
  }
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (g !== null && g !== undefined && g.connected) {
      return g;
    }
  }
  return null;
}
