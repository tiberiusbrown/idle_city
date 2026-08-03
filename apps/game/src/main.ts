import { Engine } from '@babylonjs/core/Engines/engine';
import { createCityScene } from '@idle-city/renderer';
import { createSimulation } from '@idle-city/simulation';
import { registerSW } from 'virtual:pwa-register';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (canvas === null) throw new Error('The game canvas is missing.');

const simulation = createSimulation();
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
const city = createCityScene(engine, simulation.getSnapshot());

const resize = (): void => city.resize();
window.addEventListener('resize', resize);

engine.runRenderLoop(() => {
  city.update(simulation.getSnapshot());
  city.scene.render();
});

window.addEventListener('pagehide', () => {
  window.removeEventListener('resize', resize);
  city.dispose();
  engine.dispose();
});

registerSW({ immediate: true });
