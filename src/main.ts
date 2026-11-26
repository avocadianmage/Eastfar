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

  // The game runs while the mouse is captured (or always, in automated runs). The pack
  // screen lets go of the mouse on purpose, so that is not a pause.
  const refresh = () => {
    const menu = game.gameplay.mode === 'menu';
    const running = params.autostart || game.input.locked;
    game.playing = running || menu;
    overlay.classList.toggle('hidden', running || menu);
    crosshair.hidden = !running || menu;
  };

  const capture = () => {
    game.audio.start();
    game.input.requestLock();
    // If the browser refuses (it can, straight after Esc), fall back to the pause screen.
    window.setTimeout(refresh, 400);
  };
  game.onRecapture = capture;

  overlay.classList.remove('loading');
  status.textContent = '';
  begin.hidden = false;
  begin.textContent = game.resumed ? 'Continue' : 'Begin';
  begin.addEventListener('click', capture);
  canvas.addEventListener('click', () => {
    if (!game.input.locked && game.gameplay.mode !== 'menu') capture();
  });
  game.input.onLockChange = (locked) => {
    refresh();
    if (!locked && game.gameplay.mode !== 'menu') {
      begin.textContent = 'Resume';
      game.gameplay.saveNow();
    }
  };

  // Settings: shown on the title and pause screens.
  const settingsBox = document.getElementById('settings') as HTMLElement;
  const quality = document.getElementById('set-quality') as HTMLSelectElement;
  const volume = document.getElementById('set-volume') as HTMLInputElement;
  const sensitivity = document.getElementById('set-sensitivity') as HTMLInputElement;
  const note = document.getElementById('set-note') as HTMLElement;
  settingsBox.hidden = false;
  quality.value = game.settings.quality;
  volume.value = String(game.settings.volume);
  sensitivity.value = String(game.settings.sensitivity);
  quality.addEventListener('change', () => {
    game.applySettings({ quality: quality.value as typeof game.settings.quality });
    note.hidden = quality.value === game.quality.name;
  });
  volume.addEventListener('input', () => game.applySettings({ volume: Number(volume.value) }));
  sensitivity.addEventListener('input', () => game.applySettings({ sensitivity: Number(sensitivity.value) }));
  const music = document.getElementById('set-music') as HTMLInputElement;
  music.checked = game.settings.music;
  music.addEventListener('change', () => game.applySettings({ music: music.checked }));
  (document.getElementById('set-reload') as HTMLButtonElement).addEventListener('click', () => {
    game.gameplay.saveNow();
    location.reload();
  });

  if (game.resumed) {
    // Offer a fresh start to anyone with a saved game.
    const fresh = document.createElement('button');
    fresh.className = 'new-game';
    fresh.textContent = 'Start a new game';
    fresh.addEventListener('click', () => {
      if (fresh.dataset.armed !== '1') {
        fresh.dataset.armed = '1';
        fresh.textContent = 'Erase your saved game and start over? Click again to confirm.';
        return;
      }
      game.gameplay.newGame();
      game.gameplay.saveNow();
      fresh.remove();
      begin.textContent = 'Begin';
    });
    begin.insertAdjacentElement('afterend', fresh);
  }

  game.start();
  if (params.autostart) overlay.style.transition = 'none';
  refresh();
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
