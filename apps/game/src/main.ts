import { Engine } from '@babylonjs/core/Engines/engine';
import { createCityScene } from '@idle-city/renderer';
import { createSimulation } from '@idle-city/simulation';
import { registerSW } from 'virtual:pwa-register';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const dataValue = document.querySelector<HTMLElement>('#data-value');
const populationValue = document.querySelector<HTMLElement>('#population-value');
const tickValue = document.querySelector<HTMLElement>('#tick-value');
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-button');
const normalButton = document.querySelector<HTMLButtonElement>('#normal-button');
const fastButton = document.querySelector<HTMLButtonElement>('#fast-button');
if (
  canvas === null ||
  dataValue === null ||
  populationValue === null ||
  tickValue === null ||
  pauseButton === null ||
  normalButton === null ||
  fastButton === null
) {
  throw new Error('The Idle City interface is missing required elements.');
}

const TARGET_TICKS_PER_SECOND = 5;
const FAST_SPEED_MULTIPLIER = 4;
const SIMULATION_WORK_BUDGET = 64;
const FRAME_WORK_ALLOWANCE_MS = 4;

type SimulationSpeed = 'paused' | 'normal' | 'fast';

const simulation = createSimulation();
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
const city = createCityScene(engine, simulation.getSnapshot());

const updateHud = (snapshot: ReturnType<typeof simulation.getSnapshot>): void => {
  dataValue.textContent = String(snapshot.data);
  populationValue.textContent = String(snapshot.population);
  tickValue.textContent = String(snapshot.tick);
};

let speed: SimulationSpeed = 'normal';
let requestedTicks = 0;
let lastFrameTime: number | null = null;
let animationFrameId = 0;
let disposed = false;

const speedMultiplier = (value: SimulationSpeed): number => {
  if (value === 'fast') return FAST_SPEED_MULTIPLIER;
  if (value === 'normal') return 1;
  return 0;
};

const updateSpeedControls = (): void => {
  pauseButton.setAttribute('aria-pressed', String(speed === 'paused'));
  normalButton.setAttribute('aria-pressed', String(speed === 'normal'));
  fastButton.setAttribute('aria-pressed', String(speed === 'fast'));
};

const setSpeed = (nextSpeed: SimulationSpeed): void => {
  speed = nextSpeed;
  updateSpeedControls();
};

pauseButton.addEventListener('click', () => setSpeed('paused'));
normalButton.addEventListener('click', () => setSpeed('normal'));
fastButton.addEventListener('click', () => setSpeed('fast'));
updateSpeedControls();

const resize = (): void => city.resize();
window.addEventListener('resize', resize);

const advanceSimulationForFrame = (elapsedSeconds: number): void => {
  const multiplier = speedMultiplier(speed);
  if (multiplier === 0) return;

  requestedTicks += elapsedSeconds * TARGET_TICKS_PER_SECOND * multiplier;
  const frameDeadline = performance.now() + FRAME_WORK_ALLOWANCE_MS;

  while (requestedTicks >= 1 && performance.now() < frameDeadline) {
    const result = simulation.advanceTickWork(SIMULATION_WORK_BUDGET);
    if (result.status === 'committed') requestedTicks -= 1;
  }
};

const renderFrame = (frameTime: number): void => {
  if (disposed) return;

  const elapsedSeconds =
    lastFrameTime === null ? 0 : Math.min(0.25, Math.max(0, (frameTime - lastFrameTime) / 1_000));
  lastFrameTime = frameTime;

  advanceSimulationForFrame(elapsedSeconds);

  const snapshot = simulation.getSnapshot();
  const interpolationAlpha = Math.min(1, Math.max(0, requestedTicks));
  city.update(snapshot, interpolationAlpha);
  updateHud(snapshot);
  city.scene.render();

  animationFrameId = window.requestAnimationFrame(renderFrame);
};

updateHud(simulation.getSnapshot());
animationFrameId = window.requestAnimationFrame(renderFrame);

window.addEventListener('pagehide', () => {
  if (disposed) return;
  disposed = true;
  window.cancelAnimationFrame(animationFrameId);
  window.removeEventListener('resize', resize);
  city.dispose();
  engine.dispose();
});

registerSW({ immediate: true });
