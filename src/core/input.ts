// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Keyboard and mouse input with pointer lock.
 *
 * Browser notes: Esc always releases the mouse (so it doubles as pause), and
 * Tab is captured only while the mouse is locked.
 */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'interact'
  | 'attack'
  | 'inventory'
  | 'perfHud'
  | 'mute'
  | 'confirm'
  | 'choice1'
  | 'choice2'
  | 'choice3'
  | 'choice4'
  | 'flyUp'
  | 'flyDown';

const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'interact',
  Tab: 'inventory',
  Backquote: 'perfHud',
  F3: 'perfHud',
  KeyM: 'mute',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Digit1: 'choice1',
  Digit2: 'choice2',
  Digit3: 'choice3',
  Digit4: 'choice4',
  KeyQ: 'flyDown',
  KeyR: 'flyUp',
};

export class Input {
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private dx = 0;
  private dy = 0;
  locked = false;
  /** Called when pointer lock is gained or lost. */
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Ask the browser to capture the mouse. Must be called from a user gesture. */
  requestLock(): void {
    if (this.locked) return;
    // Unadjusted movement removes OS mouse acceleration where supported.
    const req = this.target.requestPointerLock as (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    try {
      const p = req.call(this.target, { unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          const p2 = req.call(this.target);
          if (p2 && typeof p2.catch === 'function') p2.catch(() => {});
        });
      }
    } catch {
      /* pointer lock unavailable (headless tests) */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(a: Action): boolean {
    return this.held.has(a);
  }

  /** True only on the frame the action was first pressed. */
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }

  /** Mouse movement since the last call, in pixels. */
  consumeMouse(out: { x: number; y: number }): void {
    out.x = this.dx;
    out.y = this.dy;
    this.dx = 0;
    this.dy = 0;
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  /** Test hook: simulate an action being held or released. */
  setHeld(a: Action, down: boolean): void {
    if (down) {
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
    } else {
      this.held.delete(a);
    }
  }

  private clear = (): void => {
    this.held.clear();
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const a = KEY_BINDINGS[e.code];
    if (!a) return;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (typing) return;
    // Keep Tab/Space/arrows from moving focus or scrolling the page while playing.
    if (this.locked || a === 'inventory' || a === 'perfHud') e.preventDefault();
    if (e.repeat) return;
    this.setHeld(a, true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const a = KEY_BINDINGS[e.code];
    if (a) this.held.delete(a);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    if (e.button === 0) this.setHeld('attack', true);
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.held.delete('attack');
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.target;
    if (!this.locked) this.clear();
    this.onLockChange(this.locked);
  };
}
