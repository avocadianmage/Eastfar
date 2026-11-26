import { parseParams } from './core/params';
import { Game } from './game';
import { REGION_LABELS } from './world/layout';

declare global {
  interface Window {
    __eastfar?: ReturnType<Game['debugApi']> | { ready: false; error?: string };
  }
}

/** Estimate the monitor's refresh rate from a run of cheap frames. */
function measureDisplayHz(frames = 40): Promise<number> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let last = 0;
    const step = (now: number) => {
      if (last) deltas.push(now - last);
      last = now;
      if (deltas.length < frames) requestAnimationFrame(step);
      else {
        deltas.sort((a, b) => a - b);
        const median = deltas[Math.floor(deltas.length / 2)]!;
        resolve(median > 0 ? 1000 / median : 60);
      }
    };
    requestAnimationFrame(step);
  });
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const overlay = document.getElementById('overlay') as HTMLElement;
  const status = document.getElementById('status') as HTMLElement;
  const begin = document.getElementById('begin') as HTMLButtonElement;
  const crosshair = document.getElementById('crosshair') as HTMLElement;

  window.__eastfar = { ready: false };
  overlay.classList.add('loading');

  const params = parseParams(location.search);
  const hzPromise = params.autostart ? Promise.resolve(60) : measureDisplayHz();
  const game = new Game(canvas, ui, params);

  await game.init((msg) => {
    status.textContent = msg;
  });
  game.setDisplayHz(await hzPromise);

  // Area name fades in when crossing into a new place.
  const banner = document.createElement('div');
  banner.id = 'region-banner';
  ui.appendChild(banner);
  let bannerTimer = 0;
  game.onRegionChange = (region) => {
    if (region === 'wilds') return;
    banner.textContent = REGION_LABELS[region];
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => banner.classList.remove('show'), 3800);
  };

  const setPlaying = (playing: boolean) => {
    game.playing = playing;
    overlay.classList.toggle('hidden', playing);
    crosshair.hidden = !playing;
  };

  overlay.classList.remove('loading');
  status.textContent = '';
  begin.hidden = false;
  begin.textContent = 'Begin';
  begin.addEventListener('click', () => game.input.requestLock());
  canvas.addEventListener('click', () => {
    if (!game.input.locked) game.input.requestLock();
  });
  game.input.onLockChange = (locked) => {
    setPlaying(locked);
    if (!locked) begin.textContent = 'Resume';
  };

  game.start();
  if (params.autostart) {
    overlay.style.transition = 'none';
    setPlaying(true);
  }
  window.__eastfar = game.debugApi();
}

boot().catch((err: unknown) => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) {
    status.textContent = 'Eastfar could not start. Your browser may not support WebGL2 or WebGPU.';
  }
  window.__eastfar = { ready: false, error: String(err) };
});
