/**
 * Roving focus for couch play: D-pad / stick + A to activate focused control.
 * Main menu: left column (nav) vs right column (content) — stick right jumps into content;
 * stick left from first content focus returns to the active tab in nav.
 */

import {
  applyAxisDeadzone,
  GAMEPAD_AXIS_DEADZONE,
  pickPrimaryGamepad,
  readButtonPressed,
  readButtonValue,
  StdBtn,
} from "../input/gamepadStandard";

export type GamepadMenuEdges = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
};

let prevDUp = false;
let prevDDown = false;
let prevDLeft = false;
let prevDRight = false;
let prevA = false;
let prevB = false;

const FOCUS_SEL = [
  'button:not([disabled])',
  'a[href]:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  "select:not([disabled])",
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
  'div[role="button"][tabindex]:not([aria-disabled="true"])',
].join(",");

function collectFocusablesIn(container: HTMLElement | null): HTMLElement[] {
  if (container === null) {
    return [];
  }
  const nodes = container.querySelectorAll<HTMLElement>(FOCUS_SEL);
  const out: HTMLElement[] = [];
  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    if (!container.contains(el)) {
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) {
      continue;
    }
    const h = el.getAttribute("aria-hidden");
    if (h === "true") {
      continue;
    }
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") {
      continue;
    }
    out.push(el);
  }
  return out;
}

export function sampleGamepadMenuEdges(): GamepadMenuEdges {
  const gp = pickPrimaryGamepad();
  if (gp === null) {
    prevDUp = prevDDown = prevDLeft = prevDRight = prevA = prevB = false;
    return {
      up: false,
      down: false,
      left: false,
      right: false,
      confirm: false,
      back: false,
    };
  }

  const dUp = readButtonPressed(gp, StdBtn.DUp);
  const dDown = readButtonPressed(gp, StdBtn.DDown);
  const dLeft = readButtonPressed(gp, StdBtn.DLeft);
  const dRight = readButtonPressed(gp, StdBtn.DRight);
  const a = readButtonValue(gp, StdBtn.A) >= 0.5;
  const b = readButtonValue(gp, StdBtn.B) >= 0.5;

  const stickX = applyAxisDeadzone(gp.axes[0] ?? 0, GAMEPAD_AXIS_DEADZONE);
  const stickY = applyAxisDeadzone(gp.axes[1] ?? 0, GAMEPAD_AXIS_DEADZONE);
  const navUp = dUp || stickY < -0.55;
  const navDown = dDown || stickY > 0.55;
  const navLeft = dLeft || stickX < -0.55;
  const navRight = dRight || stickX > 0.55;

  const edges: GamepadMenuEdges = {
    up: navUp && !prevDUp,
    down: navDown && !prevDDown,
    left: navLeft && !prevDLeft,
    right: navRight && !prevDRight,
    confirm: a && !prevA,
    back: b && !prevB,
  };

  prevDUp = navUp;
  prevDDown = navDown;
  prevDLeft = navLeft;
  prevDRight = navRight;
  prevA = a;
  prevB = b;

  return edges;
}

/** @param focusIndexRef mutable index; updated when roving */
export function tickGamepadRovingFocus(
  root: HTMLElement,
  focusIndexRef: { i: number },
  edges: GamepadMenuEdges,
  opts?: { wrap?: boolean },
): void {
  const wrap = opts?.wrap !== false;
  const list = collectFocusablesIn(root);
  if (list.length === 0) {
    return;
  }

  let i = focusIndexRef.i;
  const cur = document.activeElement;
  if (cur instanceof HTMLElement && list.includes(cur)) {
    i = list.indexOf(cur);
  } else if (i < 0 || i >= list.length) {
    i = 0;
  }

  let dir = 0;
  if (edges.down || edges.right) {
    dir = 1;
  } else if (edges.up || edges.left) {
    dir = -1;
  }

  if (dir !== 0) {
    const next = wrap
      ? (i + dir + list.length) % list.length
      : Math.max(0, Math.min(list.length - 1, i + dir));
    i = next;
    list[i]?.focus();
  }

  if (edges.confirm) {
    const el = list[i];
    if (el !== undefined) {
      el.click();
    }
  }

  focusIndexRef.i = Math.max(0, Math.min(list.length - 1, i));
}

type MainMenuGpRegion = "nav" | "content";

const mainMenuSplit = {
  region: "nav" as MainMenuGpRegion,
  index: 0,
};

/** Reset roving index when leaving the main menu. */
export function resetMainMenuGamepadFocusIndex(): void {
  mainMenuSplit.region = "nav";
  mainMenuSplit.index = 0;
}

export function tickMainMenuGamepad(root: HTMLElement): void {
  const nav = root.querySelector(".mm-nav") as HTMLElement | null;
  const content = root.querySelector(".mm-content") as HTMLElement | null;
  if (nav === null || content === null) {
    const edges = sampleGamepadMenuEdges();
    if (!edges.up && !edges.down && !edges.left && !edges.right && !edges.confirm && !edges.back) {
      return;
    }
    tickGamepadRovingFocus(root, { i: mainMenuSplit.index }, edges, { wrap: true });
    return;
  }

  const edges = sampleGamepadMenuEdges();
  if (!edges.up && !edges.down && !edges.left && !edges.right && !edges.confirm && !edges.back) {
    return;
  }

  const navList = collectFocusablesIn(nav);
  const contentList = collectFocusablesIn(content);

  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    if (nav.contains(active)) {
      const ix = navList.indexOf(active);
      if (ix >= 0) {
        mainMenuSplit.region = "nav";
        mainMenuSplit.index = ix;
      }
    } else if (content.contains(active)) {
      const ix = contentList.indexOf(active);
      if (ix >= 0) {
        mainMenuSplit.region = "content";
        mainMenuSplit.index = ix;
      }
    }
  }

  const curList = mainMenuSplit.region === "nav" ? navList : contentList;

  if (edges.right && mainMenuSplit.region === "nav" && contentList.length > 0) {
    mainMenuSplit.region = "content";
    mainMenuSplit.index = 0;
    contentList[0]?.focus();
    return;
  }

  if (
    edges.left &&
    mainMenuSplit.region === "content" &&
    mainMenuSplit.index <= 0 &&
    navList.length > 0
  ) {
    const activeTab = nav.querySelector(".mm-nav-btn-active") as HTMLElement | null;
    const tabIdx =
      activeTab !== null && navList.includes(activeTab)
        ? navList.indexOf(activeTab)
        : 0;
    mainMenuSplit.region = "nav";
    mainMenuSplit.index = Math.max(0, tabIdx);
    navList[mainMenuSplit.index]?.focus();
    return;
  }

  let dir = 0;
  if (edges.down || (edges.right && mainMenuSplit.region === "content")) {
    dir = 1;
  } else if (edges.up || (edges.left && mainMenuSplit.region === "nav")) {
    dir = -1;
  }

  if (dir !== 0 && curList.length > 0) {
    let i = mainMenuSplit.index;
    if (i < 0 || i >= curList.length) {
      i = 0;
    }
    const next = (i + dir + curList.length) % curList.length;
    mainMenuSplit.index = next;
    curList[next]?.focus();
  }

  if (edges.confirm && curList.length > 0) {
    const el = curList[mainMenuSplit.index];
    if (el !== undefined) {
      el.click();
    }
  }
}
