/**
 * Unified keyboard + mouse + gamepad; sole module that attaches to window/canvas for input.
 *
 * Gamepad: standard mapping; right-stick aim; known gaps — Switch/TV browsers may differ;
 * fullscreen/audio still need user gestures on some platforms.
 */
import {
  BLOCK_SIZE,
  PLAYER_HEIGHT,
  REACH_BLOCKS,
} from "../core/constants";
import type { Camera } from "../renderer/Camera";
import { type InputAction, type KeybindableAction } from "./bindings";
import {
  applyAxisDeadzone,
  GAMEPAD_AXIS_DEADZONE,
  GAMEPAD_TRIGGER_PRESS,
  pickPrimaryGamepad,
  readButtonPressed,
  readButtonValue,
  readTrigger01,
  StdBtn,
} from "./gamepadStandard";
import { mergeStoredKeyBindings, snapshotKeyBindings } from "./keyBindingMerge";

const MOUSE_PLACE = 2;
const MOUSE_BREAK = 0;
const MOUSE_PICK = 1;

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function gamepadHasPhysicalInput(gp: Gamepad): boolean {
  for (let i = 0; i < gp.buttons.length; i++) {
    const b = gp.buttons[i];
    if (b === undefined) {
      continue;
    }
    if (b.pressed) {
      return true;
    }
    if (typeof b.value === "number" && b.value > 0.12) {
      return true;
    }
  }
  for (let i = 0; i < gp.axes.length; i++) {
    if (Math.abs(gp.axes[i] ?? 0) > 0.12) {
      return true;
    }
  }
  return false;
}

/** True when the focused DOM node is typing-oriented (inventory search, chat field, etc.). */
function isEditableDocumentFocus(el: Element | null): boolean {
  if (el === null || !(el instanceof HTMLElement)) {
    return false;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    return (
      t !== "button" &&
      t !== "submit" &&
      t !== "reset" &&
      t !== "checkbox" &&
      t !== "radio" &&
      t !== "file" &&
      t !== "range" &&
      t !== "color" &&
      t !== "hidden"
    );
  }
  return false;
}

function isBrowserShortcutKey(code: string): boolean {
  switch (code) {
    case "KeyA":
    case "KeyD":
    case "KeyE":
    case "KeyF":
    case "KeyG":
    case "KeyH":
    case "KeyI":
    case "KeyJ":
    case "KeyL":
    case "KeyN":
    case "KeyO":
    case "KeyP":
    case "KeyR":
    case "KeyS":
    case "KeyT":
    case "KeyU":
    case "KeyW":
    case "Equal":
    case "Minus":
    case "Digit0":
    case "BracketLeft":
    case "BracketRight":
    case "Tab":
    case "Slash":
    case "F5":
      return true;
    default:
      return false;
  }
}

export class InputManager {
  readonly mouseWorldPos = { x: 0, y: 0 };

  /** Accumulated wheel deltaY since last {@link postUpdate} (read in Player.update). */
  wheelDelta = 0;

  /** When true (e.g. inventory overlay open), block world break/place input. */
  private worldInputBlocked = false;

  /** When true (chat input focused), block game actions; {@link InputAction.pause} still passes for Escape. */
  private chatOpen = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly downCodes = new Set<string>();
  private readonly justPressed = new Set<InputAction>();
  private readonly mouseDown = new Set<number>();
  private readonly mouseJustDown = new Set<number>();
  /**
   * When true, suppress world "break" while LMB remains held.
   * Used so clicking an entity to melee doesn't also start mining the block behind it.
   */
  private suppressBreakWhileHeld = false;

  /** Effective keyboard codes per action (mouse still handles place/break). */
  private keyBindings: Record<KeybindableAction, readonly string[]> =
    snapshotKeyBindings(mergeStoredKeyBindings(undefined));

  private mouseClientX = 0;
  private mouseClientY = 0;
  private canvasRectLeft = 0;
  private canvasRectTop = 0;
  private canvasCssW = 1;
  private canvasCssH = 1;
  private canvasMetricsDirty = true;
  private canvasResizeObserver: ResizeObserver | null = null;

  private readonly gpJustPressed = new Set<InputAction>();
  private readonly gpKeybindDown = new Set<KeybindableAction>();
  private gpBreakHeld = false;
  private gpBreakJust = false;
  private gpPlaceHeld = false;
  private gpPlaceJust = false;
  private suppressGamepadBreak = false;

  private aimOffX = 0;
  private aimOffY = 0;
  private gamepadAimActive = false;

  private prevGpLb = false;
  private prevGpRb = false;
  private prevGpDl = false;
  private prevGpDr = false;
  private gpHotbarHoldT = 0;

  private prevStickJump = false;
  private prevGpStart = false;
  private prevGpB = false;
  private prevGpA = false;
  private prevGpY = false;
  private prevGpBk = false;
  private prevGpX = false;
  private prevGpDdown = false;
  private prevGpRt = 0;
  private prevGpLt = 0;

  /** Standard B / Circle edge this tick (cleared in {@link postUpdate}). */
  gamepadBackJustEdge = false;

  /**
   * `gamepad`: mouse movement does not drive world aim until the pointer moves far enough to
   * reclaim (see {@link armGamepadPointerDriver}). While `gamepad`, canvas LMB/RMB are ignored for
   * break/place and the hardware mouse wheel does not advance hotbar.
   */
  pointerDriver: "mouse" | "gamepad" = "mouse";
  private mouseReclaimAnchorX = 0;
  private mouseReclaimAnchorY = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const editableFocus = isEditableDocumentFocus(document.activeElement);
    const gameplayInputActive = !this.worldInputBlocked && !this.chatOpen;
    if (
      gameplayInputActive &&
      !editableFocus &&
      (e.ctrlKey || e.metaKey) &&
      isBrowserShortcutKey(e.code)
    ) {
      // Keep browser shortcuts from stealing focus / closing tabs while in-game.
      e.preventDefault();
    }
    if (
      (e.code === "Space" || e.code === "Tab") &&
      !editableFocus
    ) {
      e.preventDefault();
    }
    if (e.repeat) {
      return;
    }
    const f3HeldBeforeEvent = this.downCodes.has("F3");
    this.downCodes.add(e.code);
    this.edgeForCode(e.code);
    if (f3HeldBeforeEvent || e.code === "F3") {
      if (e.code === "Digit1") {
        this.justPressed.add("toggleGpuDebugProfiler");
        e.preventDefault();
      } else if (e.code === "Digit2") {
        this.justPressed.add("toggleGpuDebugPerfGraphs");
        e.preventDefault();
      } else if (e.code === "Digit3") {
        this.justPressed.add("toggleGpuDebugNetGraphs");
        e.preventDefault();
      } else if (e.code === "F6") {
        this.justPressed.add("cycleGpuDebugProfile");
        e.preventDefault();
      }
    }
    if (e.code === "F3" && !editableFocus) {
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.downCodes.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouseClientX = e.clientX;
    this.mouseClientY = e.clientY;
    if (this.pointerDriver === "gamepad") {
      if (
        Math.hypot(
          e.clientX - this.mouseReclaimAnchorX,
          e.clientY - this.mouseReclaimAnchorY,
        ) > 8
      ) {
        this.pointerDriver = "mouse";
        this.gamepadAimActive = false;
        this.aimOffX = 0;
        this.aimOffY = 0;
      }
    }
  };

  private readonly onCanvasMetricsInvalidated = (): void => {
    this.canvasMetricsDirty = true;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (
      this.pointerDriver === "gamepad" &&
      e.target === this.canvas &&
      (e.button === MOUSE_BREAK || e.button === MOUSE_PLACE)
    ) {
      e.preventDefault();
      return;
    }
    if (e.button === MOUSE_PICK && e.target === this.canvas) {
      e.preventDefault();
    }
    if (!this.mouseDown.has(e.button)) {
      this.mouseJustDown.add(e.button);
    }
    this.mouseDown.add(e.button);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.mouseDown.delete(e.button);
    if (e.button === MOUSE_BREAK) {
      this.suppressBreakWhileHeld = false;
    }
  };

  private readonly onBlur = (): void => {
    this.downCodes.clear();
    this.mouseDown.clear();
    this.gamepadAimActive = false;
    this.aimOffX = 0;
    this.aimOffY = 0;
    this.pointerDriver = "mouse";
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly onAuxClick = (e: MouseEvent): void => {
    if (e.button === MOUSE_PICK) {
      e.preventDefault();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.pointerDriver === "gamepad") {
      return;
    }
    this.wheelDelta += e.deltaY;
  };

  private readonly updateCanvasMetrics = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.canvasRectLeft = rect.left;
    this.canvasRectTop = rect.top;
    /**
     * Prefer `getBoundingClientRect()` over `clientWidth/Height` because rect includes
     * CSS transforms/zoom; using client metrics can skew pointer ↔ canvas mapping
     * (commonly on HiDPI laptops / browser zoom / transformed mounts).
     */
    this.canvasCssW = Math.max(1, rect.width || this.canvas.clientWidth || 1);
    this.canvasCssH = Math.max(1, rect.height || this.canvas.clientHeight || 1);
    this.canvasMetricsDirty = false;
  };

  constructor(
    canvas: HTMLCanvasElement,
    storedOverrides?: Partial<Record<KeybindableAction, readonly string[]>>,
  ) {
    this.canvas = canvas;
    this.keyBindings = snapshotKeyBindings(
      mergeStoredKeyBindings(storedOverrides),
    );
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onCanvasMetricsInvalidated);
    window.addEventListener("scroll", this.onCanvasMetricsInvalidated, true);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    canvas.addEventListener("auxclick", this.onAuxClick);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    if (typeof ResizeObserver !== "undefined") {
      this.canvasResizeObserver = new ResizeObserver(this.onCanvasMetricsInvalidated);
      this.canvasResizeObserver.observe(canvas);
    }
    this.updateCanvasMetrics();
    this.mouseReclaimAnchorX = this.mouseClientX;
    this.mouseReclaimAnchorY = this.mouseClientY;
  }

  setWorldInputBlocked(blocked: boolean): void {
    this.worldInputBlocked = blocked;
  }

  /** Suspend movement, hotbar, inventory, etc. while chat is open; Escape still registers as pause. */
  setChatOpen(open: boolean): void {
    this.chatOpen = open;
  }

  isWorldInputBlocked(): boolean {
    return this.worldInputBlocked;
  }

  /** While a blocked UI (inventory, pause, etc.) is up and a text field is focused, suppress chat/inventory hotkeys. */
  private uiTypingSuppressesOverlayHotkeys(): boolean {
    return this.worldInputBlocked && isEditableDocumentFocus(document.activeElement);
  }

  /**
   * RMB pressed this frame, ignoring {@link setWorldInputBlocked} (still false while chat open).
   * Used to open chest / crafting table while the inventory overlay has world input blocked.
   */
  isJustPressedPlaceIgnoreWorldBlock(): boolean {
    if (this.chatOpen) {
      return false;
    }
    return this.mouseJustDown.has(MOUSE_PLACE) || this.gpPlaceJust;
  }

  /**
   * Replace keyboard bindings (e.g. from settings). Does not affect mouse
   * break/place.
   */
  setKeyBindings(
    next: Record<KeybindableAction, readonly string[]>,
  ): void {
    this.keyBindings = snapshotKeyBindings(
      mergeStoredKeyBindings(next as Partial<Record<KeybindableAction, readonly string[]>>),
    );
  }

  getKeyBindingsForAction(action: KeybindableAction): readonly string[] {
    return this.keyBindings[action] ?? [];
  }

  destroy(): void {
    this.worldInputBlocked = false;
    this.chatOpen = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onCanvasMetricsInvalidated);
    window.removeEventListener("scroll", this.onCanvasMetricsInvalidated, true);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("auxclick", this.onAuxClick);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvasResizeObserver?.disconnect();
    this.canvasResizeObserver = null;
  }

  isDown(action: InputAction): boolean {
    if (
      this.chatOpen &&
      action !== "pause" &&
      action !== "toggleGpuDebug" &&
      action !== "toggleGpuDebugProfiler" &&
      action !== "toggleGpuDebugPerfGraphs" &&
      action !== "toggleGpuDebugNetGraphs" &&
      action !== "cycleGpuDebugProfile"
    ) {
      return false;
    }
    if (
      this.worldInputBlocked &&
      action !== "inventory" &&
      action !== "pause" &&
      action !== "chat" &&
      action !== "dropItem" &&
      action !== "toggleGpuDebug" &&
      action !== "toggleGpuDebugProfiler" &&
      action !== "toggleGpuDebugPerfGraphs" &&
      action !== "toggleGpuDebugNetGraphs" &&
      action !== "cycleGpuDebugProfile"
    ) {
      return false;
    }
    if (
      this.uiTypingSuppressesOverlayHotkeys() &&
      (action === "inventory" || action === "chat")
    ) {
      return false;
    }
    if (action === "toggleGpuDebug") {
      return this.downCodes.has("F3");
    }
    if (
      action === "toggleGpuDebugProfiler" ||
      action === "toggleGpuDebugPerfGraphs" ||
      action === "toggleGpuDebugNetGraphs" ||
      action === "cycleGpuDebugProfile"
    ) {
      return false;
    }
    if (action === "place") {
      const mouseOk = this.pointerDriver === "mouse" && this.mouseDown.has(MOUSE_PLACE);
      return mouseOk || this.gpPlaceHeld;
    }
    if (action === "break") {
      if (this.suppressBreakWhileHeld && this.mouseDown.has(MOUSE_BREAK)) {
        return false;
      }
      if (this.suppressGamepadBreak && this.gpBreakHeld) {
        return false;
      }
      const mouseOk =
        this.pointerDriver === "mouse" && this.mouseDown.has(MOUSE_BREAK);
      return mouseOk || this.gpBreakHeld;
    }
    const keys = this.keyBindings[action as KeybindableAction];
    if (!keys) {
      return false;
    }
    for (const code of keys) {
      if (this.downCodes.has(code)) {
        return true;
      }
    }
    if (this.gpKeybindDown.has(action as KeybindableAction)) {
      return true;
    }
    return false;
  }

  isJustPressed(action: InputAction): boolean {
    if (
      this.chatOpen &&
      action !== "pause" &&
      action !== "toggleGpuDebug" &&
      action !== "toggleGpuDebugProfiler" &&
      action !== "toggleGpuDebugPerfGraphs" &&
      action !== "toggleGpuDebugNetGraphs" &&
      action !== "cycleGpuDebugProfile"
    ) {
      return false;
    }
    if (
      this.worldInputBlocked &&
      action !== "inventory" &&
      action !== "pause" &&
      action !== "chat" &&
      action !== "dropItem" &&
      action !== "toggleGpuDebug" &&
      action !== "toggleGpuDebugProfiler" &&
      action !== "toggleGpuDebugPerfGraphs" &&
      action !== "toggleGpuDebugNetGraphs" &&
      action !== "cycleGpuDebugProfile"
    ) {
      return false;
    }
    if (action === "toggleGpuDebug") {
      return this.justPressed.has("toggleGpuDebug");
    }
    if (action === "toggleGpuDebugProfiler") {
      return this.justPressed.has("toggleGpuDebugProfiler");
    }
    if (action === "toggleGpuDebugPerfGraphs") {
      return this.justPressed.has("toggleGpuDebugPerfGraphs");
    }
    if (action === "toggleGpuDebugNetGraphs") {
      return this.justPressed.has("toggleGpuDebugNetGraphs");
    }
    if (action === "cycleGpuDebugProfile") {
      return this.justPressed.has("cycleGpuDebugProfile");
    }
    if (
      this.uiTypingSuppressesOverlayHotkeys() &&
      (action === "inventory" || action === "chat")
    ) {
      return false;
    }
    if (action === "place") {
      const mouseOk =
        this.pointerDriver === "mouse" && this.mouseJustDown.has(MOUSE_PLACE);
      return mouseOk || this.gpPlaceJust;
    }
    if (action === "break") {
      if (this.suppressBreakWhileHeld) {
        return false;
      }
      if (this.suppressGamepadBreak) {
        return false;
      }
      const mouseOk =
        this.pointerDriver === "mouse" && this.mouseJustDown.has(MOUSE_BREAK);
      return mouseOk || this.gpBreakJust;
    }
    if (this.gpJustPressed.has(action)) {
      return true;
    }
    return this.justPressed.has(action);
  }

  mouseButton(btn: 0 | 1 | 2): boolean {
    if (this.pointerDriver === "gamepad" && (btn === MOUSE_BREAK || btn === MOUSE_PLACE)) {
      return false;
    }
    return this.mouseDown.has(btn);
  }

  mouseButtonJustPressed(btn: 0 | 1 | 2): boolean {
    if (this.chatOpen) {
      return false;
    }
    if (this.pointerDriver === "gamepad" && (btn === MOUSE_BREAK || btn === MOUSE_PLACE)) {
      return false;
    }
    return this.mouseJustDown.has(btn);
  }

  /** Raw keyboard code state (e.g. `ControlLeft`) for mode-specific controls. */
  isKeyCodeDown(code: string): boolean {
    if (this.chatOpen) {
      return false;
    }
    return this.downCodes.has(code);
  }

  /** Call once per fixed tick after all systems have read input. */
  postUpdate(): void {
    this.justPressed.clear();
    this.gpJustPressed.clear();
    this.mouseJustDown.clear();
    this.gpBreakJust = false;
    this.gpPlaceJust = false;
    this.gamepadBackJustEdge = false;
    this.wheelDelta = 0;
    // If LMB is no longer held, clear suppression (covers missed mouseup events).
    if (!this.mouseDown.has(MOUSE_BREAK)) {
      this.suppressBreakWhileHeld = false;
    }
    if (!this.gpBreakHeld) {
      this.suppressGamepadBreak = false;
    }
  }

  /**
   * Suppress world mining ("break") until LMB is released.
   * Safe to call even if the mouse isn't down.
   */
  suppressBreakUntilMouseUp(): void {
    this.suppressBreakWhileHeld = true;
    this.suppressGamepadBreak = true;
    // Prevent this frame from also registering as "just pressed break".
    this.mouseJustDown.delete(MOUSE_BREAK);
    this.gpBreakJust = false;
  }

  /**
   * Suppress world "place" for the current frame.
   * Useful when RMB is repurposed for tools that should not also place blocks.
   */
  suppressPlaceThisFrame(): void {
    this.mouseJustDown.delete(MOUSE_PLACE);
    this.gpPlaceJust = false;
  }

  updateMouseWorldPos(camera: Camera): void {
    if (this.canvasMetricsDirty) {
      this.updateCanvasMetrics();
    }
    /**
     * Pixi v8 `renderer.width` / {@link Camera} screen space are **logical** pixels (CSS layout
     * size). `canvas.width` is the backing-store size (`logical × resolution`). Map pointer into
     * logical space so `screenToWorld` matches `worldToScreen` and DOM overlays.
     */
    const logicalW = Math.max(1, this.canvas.clientWidth || this.canvasCssW);
    const logicalH = Math.max(1, this.canvas.clientHeight || this.canvasCssH);
    const scaleX = logicalW / this.canvasCssW;
    const scaleY = logicalH / this.canvasCssH;
    const cssX = this.mouseClientX - this.canvasRectLeft;
    const cssY = this.mouseClientY - this.canvasRectTop;
    const sx = cssX * scaleX;
    const sy = cssY * scaleY;
    const w = camera.screenToWorld(sx, sy);
    if (this.pointerDriver === "mouse") {
      this.mouseWorldPos.x = w.x;
      this.mouseWorldPos.y = w.y;
    }
  }

  /**
   * Poll primary gamepad; merges into {@link isDown} / {@link isJustPressed}. Call each fixed
   * tick after {@link updateMouseWorldPos}, then {@link applyGamepadAimToMouseWorldPos}.
   */
  pollGamepads(
    dtSec: number,
    ctx: {
      paused: boolean;
      feetX: number;
      feetY: number;
      facingRight: boolean;
      sandbox: boolean;
    },
  ): void {
    this.gpKeybindDown.clear();
    this.gpBreakHeld = false;
    this.gpBreakJust = false;
    this.gpPlaceHeld = false;
    this.gpPlaceJust = false;
    this.gamepadBackJustEdge = false;

    if (this.worldInputBlocked) {
      this.gamepadAimActive = false;
    }

    const gp = pickPrimaryGamepad();
    if (gp === null) {
      this.prevGpLb = this.prevGpRb = this.prevGpDl = this.prevGpDr = false;
      this.prevGpStart = false;
      this.prevStickJump = false;
      this.prevGpB = false;
      this.prevGpA = false;
      this.prevGpY = false;
      this.prevGpBk = false;
      this.prevGpX = false;
      this.prevGpDdown = false;
      this.prevGpRt = 0;
      this.prevGpLt = 0;
      this.gpHotbarHoldT = 0;
      return;
    }

    if (gamepadHasPhysicalInput(gp)) {
      this.armGamepadPointerDriver();
    }

    const startDown = readButtonPressed(gp, StdBtn.Start);
    if (startDown && !this.prevGpStart) {
      this.gpJustPressed.add("pause");
    }
    this.prevGpStart = startDown;

    const bNow = readButtonValue(gp, StdBtn.B) >= 0.5;
    if (bNow && !this.prevGpB) {
      this.gamepadBackJustEdge = true;
    }
    this.prevGpB = bNow;

    if (ctx.paused || this.chatOpen || this.worldInputBlocked) {
      this.prevGpLb = readButtonPressed(gp, StdBtn.LB);
      this.prevGpRb = readButtonPressed(gp, StdBtn.RB);
      this.prevGpDl = readButtonPressed(gp, StdBtn.DLeft);
      this.prevGpDr = readButtonPressed(gp, StdBtn.DRight);
      this.prevStickJump = false;
      this.prevGpA = readButtonPressed(gp, StdBtn.A);
      this.prevGpY = readButtonPressed(gp, StdBtn.Y);
      this.prevGpBk = readButtonPressed(gp, StdBtn.Back);
      this.prevGpX = readButtonPressed(gp, StdBtn.X);
      this.prevGpDdown = readButtonPressed(gp, StdBtn.DDown);
      this.prevGpRt = readTrigger01(gp, StdBtn.RT);
      this.prevGpLt = readTrigger01(gp, StdBtn.LT);
      this.gpHotbarHoldT = 0;
      return;
    }

    const lsX = applyAxisDeadzone(gp.axes[0] ?? 0, GAMEPAD_AXIS_DEADZONE);
    const lsY = applyAxisDeadzone(gp.axes[1] ?? 0, GAMEPAD_AXIS_DEADZONE);
    if (lsX < -0.25) {
      this.gpKeybindDown.add("left");
    } else if (lsX > 0.25) {
      this.gpKeybindDown.add("right");
    }

    const stickJump = lsY < -0.42;
    if (stickJump) {
      this.gpKeybindDown.add("jump");
    }
    if (stickJump && !this.prevStickJump) {
      this.gpJustPressed.add("jump");
    }
    this.prevStickJump = stickJump;

    const aPress = readButtonPressed(gp, StdBtn.A);
    if (aPress) {
      this.gpKeybindDown.add("jump");
    }
    if (aPress && !this.prevGpA) {
      this.gpJustPressed.add("jump");
    }
    this.prevGpA = aPress;

    if (readButtonPressed(gp, StdBtn.L3)) {
      this.gpKeybindDown.add("sprint");
    }

    const yPress = readButtonPressed(gp, StdBtn.Y);
    if (yPress) {
      this.gpKeybindDown.add("inventory");
    }
    if (yPress && !this.prevGpY) {
      this.gpJustPressed.add("inventory");
    }
    this.prevGpY = yPress;

    const bkPress = readButtonPressed(gp, StdBtn.Back);
    if (bkPress) {
      this.gpKeybindDown.add("chat");
    }
    if (bkPress && !this.prevGpBk) {
      this.gpJustPressed.add("chat");
    }
    this.prevGpBk = bkPress;

    const xPress = readButtonPressed(gp, StdBtn.X);
    if (xPress) {
      this.gpKeybindDown.add("toggleBackgroundMode");
    }
    if (xPress && !this.prevGpX) {
      this.gpJustPressed.add("toggleBackgroundMode");
    }
    this.prevGpX = xPress;

    const dDown = readButtonPressed(gp, StdBtn.DDown);
    if (dDown) {
      this.gpKeybindDown.add("dropItem");
    }
    if (dDown && !this.prevGpDdown) {
      this.gpJustPressed.add("dropItem");
    }
    this.prevGpDdown = dDown;

    const rt = readTrigger01(gp, StdBtn.RT);
    const lt = readTrigger01(gp, StdBtn.LT);
    this.gpBreakHeld = rt >= GAMEPAD_TRIGGER_PRESS;
    this.gpPlaceHeld = lt >= GAMEPAD_TRIGGER_PRESS;
    this.gpBreakJust = this.gpBreakHeld && this.prevGpRt < GAMEPAD_TRIGGER_PRESS;
    this.gpPlaceJust = this.gpPlaceHeld && this.prevGpLt < GAMEPAD_TRIGGER_PRESS;
    this.prevGpRt = rt;
    this.prevGpLt = lt;

    if (!this.worldInputBlocked) {
      const lb = readButtonPressed(gp, StdBtn.LB);
      const rb = readButtonPressed(gp, StdBtn.RB);
      const dl = readButtonPressed(gp, StdBtn.DLeft);
      const dr = readButtonPressed(gp, StdBtn.DRight);

      let wheelStep = 0;
      if (lb && !this.prevGpLb) {
        wheelStep -= 1;
      }
      if (rb && !this.prevGpRb) {
        wheelStep += 1;
      }
      if (dl && !this.prevGpDl) {
        wheelStep -= 1;
      }
      if (dr && !this.prevGpDr) {
        wheelStep += 1;
      }

      if (lb && this.prevGpLb) {
        this.gpHotbarHoldT += dtSec;
      } else if (rb && this.prevGpRb) {
        this.gpHotbarHoldT += dtSec;
      } else if (dl && this.prevGpDl) {
        this.gpHotbarHoldT += dtSec;
      } else if (dr && this.prevGpDr) {
        this.gpHotbarHoldT += dtSec;
      } else {
        this.gpHotbarHoldT = 0;
      }

      const repeatEvery = 0.12;
      const repeatAfter = 0.32;
      if (
        (lb || rb || dl || dr) &&
        (lb === this.prevGpLb ||
          rb === this.prevGpRb ||
          dl === this.prevGpDl ||
          dr === this.prevGpDr) &&
        wheelStep === 0
      ) {
        if (this.gpHotbarHoldT >= repeatAfter) {
          const phase = this.gpHotbarHoldT - repeatAfter;
          const prevPhase = phase - dtSec;
          const curN = Math.floor(phase / repeatEvery);
          const prevN = Math.floor(prevPhase / repeatEvery);
          if (curN > prevN) {
            if (lb || dl) {
              wheelStep -= 1;
            }
            if (rb || dr) {
              wheelStep += 1;
            }
          }
        }
      }

      this.wheelDelta += wheelStep * 120;

      this.prevGpLb = lb;
      this.prevGpRb = rb;
      this.prevGpDl = dl;
      this.prevGpDr = dr;

      const rsx = applyAxisDeadzone(gp.axes[2] ?? 0, GAMEPAD_AXIS_DEADZONE);
      const rsy = applyAxisDeadzone(gp.axes[3] ?? 0, GAMEPAD_AXIS_DEADZONE);
      const rsMag = Math.hypot(rsx, rsy);
      const anchorMx = ctx.feetX;
      const anchorMy = -ctx.feetY - PLAYER_HEIGHT * 0.5;

      if (readButtonPressed(gp, StdBtn.R3)) {
        this.gamepadAimActive = true;
        this.aimOffX = ctx.facingRight ? 56 : -56;
        this.aimOffY = -24;
        const c = this.clampAimOffset(this.aimOffX, this.aimOffY, ctx.feetX, ctx.feetY, ctx.sandbox);
        this.aimOffX = c.x;
        this.aimOffY = c.y;
      } else if (rsMag > 0.12) {
        if (!this.gamepadAimActive) {
          this.gamepadAimActive = true;
          this.aimOffX = this.mouseWorldPos.x - anchorMx;
          this.aimOffY = this.mouseWorldPos.y - anchorMy;
        }
        const speed = 400;
        this.aimOffX += rsx * speed * dtSec;
        this.aimOffY += -rsy * speed * dtSec;
        const c = this.clampAimOffset(this.aimOffX, this.aimOffY, ctx.feetX, ctx.feetY, ctx.sandbox);
        this.aimOffX = c.x;
        this.aimOffY = c.y;
      }
    } else {
      this.prevGpLb = readButtonPressed(gp, StdBtn.LB);
      this.prevGpRb = readButtonPressed(gp, StdBtn.RB);
      this.prevGpDl = readButtonPressed(gp, StdBtn.DLeft);
      this.prevGpDr = readButtonPressed(gp, StdBtn.DRight);
      this.gpHotbarHoldT = 0;
    }
  }

  applyGamepadAimToMouseWorldPos(feetX: number, feetY: number): void {
    if (this.pointerDriver !== "gamepad" && !this.gamepadAimActive) {
      return;
    }
    const anchorMx = feetX;
    const anchorMy = -feetY - PLAYER_HEIGHT * 0.5;
    this.mouseWorldPos.x = anchorMx + this.aimOffX;
    this.mouseWorldPos.y = anchorMy + this.aimOffY;
  }

  private clampAimOffset(
    offX: number,
    offY: number,
    feetX: number,
    feetY: number,
    sandbox: boolean,
  ): { x: number; y: number } {
    if (sandbox) {
      return { x: offX, y: offY };
    }
    const anchorMx = feetX;
    const anchorMy = -feetY - PLAYER_HEIGHT * 0.5;
    const pcx = Math.floor(feetX / BLOCK_SIZE);
    const pcy = Math.floor(feetY / BLOCK_SIZE);
    let ox = offX;
    let oy = offY;
    for (let k = 0; k < 14; k++) {
      const mx = anchorMx + ox;
      const my = anchorMy + oy;
      const wx = Math.floor(mx / BLOCK_SIZE);
      const wy = Math.floor(-my / BLOCK_SIZE);
      if (chebyshev(pcx, pcy, wx, wy) <= REACH_BLOCKS) {
        return { x: ox, y: oy };
      }
      ox *= 0.84;
      oy *= 0.84;
    }
    return { x: 0, y: 0 };
  }

  private armGamepadPointerDriver(): void {
    if (this.pointerDriver === "gamepad") {
      return;
    }
    this.pointerDriver = "gamepad";
    this.mouseReclaimAnchorX = this.mouseClientX;
    this.mouseReclaimAnchorY = this.mouseClientY;
  }

  private edgeForCode(code: string): void {
    for (const action of Object.keys(this.keyBindings) as KeybindableAction[]) {
      const keys = this.keyBindings[action];
      if (keys.includes(code)) {
        this.justPressed.add(action as InputAction);
      }
    }
    if (code === "F3") {
      this.justPressed.add("toggleGpuDebug");
    }
  }
}
