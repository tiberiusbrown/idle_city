import { Engine } from '@babylonjs/core/Engines/engine';
import { createCityScene } from '@idle-city/renderer';
import { createSimulation } from '@idle-city/simulation';
import { registerSW } from 'virtual:pwa-register';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (canvas === null) throw new Error('The game canvas is missing.');
const dataValue = document.querySelector<HTMLElement>('#data-value');
const populationValue = document.querySelector<HTMLElement>('#population-value');
const tickValue = document.querySelector<HTMLElement>('#tick-value');
if (dataValue === null || populationValue === null || tickValue === null) {
  throw new Error('The Idle City status HUD is missing.');
}

const simulation = createSimulation();
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
const city = createCityScene(engine, simulation.getSnapshot());

const updateHud = (snapshot: ReturnType<typeof simulation.getSnapshot>): void => {
  dataValue.textContent = String(snapshot.data);
  populationValue.textContent = String(snapshot.population);
  tickValue.textContent = String(snapshot.tick);
};

const resize = (): void => city.resize();
window.addEventListener('resize', resize);

engine.runRenderLoop(() => {
  const snapshot = simulation.getSnapshot();
  city.update(snapshot);
  updateHud(snapshot);
  city.scene.render();
});

window.addEventListener('pagehide', () => {
  window.removeEventListener('resize', resize);
  city.dispose();
  engine.dispose();
});

registerSW({ immediate: true });
