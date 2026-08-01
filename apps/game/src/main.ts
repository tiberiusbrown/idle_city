import { Engine } from '@babylonjs/core/Engines/engine';
import { createCityScene } from '@idle-city/renderer';
import { createSimulation } from '@idle-city/simulation';
import { registerSW } from 'virtual:pwa-register';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const tickElement = document.querySelector<HTMLElement>('[data-testid="tick"]');
const citizenElement = document.querySelector<HTMLElement>('[data-testid="citizen-count"]');
const statusElement = document.querySelector<HTMLElement>('[data-testid="status"]');
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-speed]')];
const resetButton = document.querySelector<HTMLButtonElement>('[data-action="reset"]');
if (
  canvas === null ||
  tickElement === null ||
  citizenElement === null ||
  statusElement === null ||
  resetButton === null
) {
  throw new Error('Required game shell elements are missing.');
}
const tickDisplay = tickElement;
const citizenDisplay = citizenElement;
const statusDisplay = statusElement;

const configuration = { width: 12, height: 10, seed: 1234, citizenCount: 10 } as const;
let simulation = createSimulation(configuration);
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
const city = createCityScene(engine, simulation.getSnapshot());
const stepMilliseconds = 200;
let accumulator = 0;
let previousTime = performance.now();
let speed = 1;

function renderHud(): void {
  const snapshot = simulation.getSnapshot();
  tickDisplay.textContent = String(snapshot.tick);
  citizenDisplay.textContent = String(snapshot.citizens.length);
}

function setSpeed(nextSpeed: number): void {
  speed = nextSpeed;
  const label =
    speed === 0 ? 'paused' : speed === 1 ? 'running at normal speed' : 'running at fast speed';
  statusDisplay.textContent = `Simulation ${label}`;
  speedButtons.forEach((button) => {
    const buttonSpeed =
      button.dataset.speed === 'pause' ? 0 : button.dataset.speed === 'normal' ? 1 : 4;
    button.classList.toggle('active', buttonSpeed === speed);
    button.setAttribute('aria-pressed', String(buttonSpeed === speed));
  });
}

speedButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setSpeed(button.dataset.speed === 'pause' ? 0 : button.dataset.speed === 'normal' ? 1 : 4);
  });
});
resetButton.addEventListener('click', () => {
  simulation = createSimulation(configuration);
  accumulator = 0;
  previousTime = performance.now();
  city.update(simulation.getSnapshot(), 1);
  renderHud();
});

engine.runRenderLoop(() => {
  const now = performance.now();
  const elapsed = Math.min(now - previousTime, 1000);
  previousTime = now;
  accumulator += elapsed * speed;
  while (accumulator >= stepMilliseconds) {
    simulation.step();
    accumulator -= stepMilliseconds;
  }
  const snapshot = simulation.getSnapshot();
  city.update(snapshot, accumulator / stepMilliseconds);
  renderHud();
  city.scene.render();
});
window.addEventListener('resize', () => engine.resize());
window.addEventListener('beforeunload', () => {
  city.dispose();
  engine.dispose();
});

renderHud();
setSpeed(1);
registerSW({ immediate: true });
