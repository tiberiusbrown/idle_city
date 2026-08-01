import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';
import type { SimulationSnapshot } from '@idle-city/simulation';

export interface CityScene {
  readonly scene: Scene;
  update(snapshot: SimulationSnapshot, interpolation: number): void;
  dispose(): void;
}

function material(scene: Scene, name: string, color: Color3, emissive = 0): PBRMaterial {
  const result = new PBRMaterial(name, scene);
  result.albedoColor = color;
  result.emissiveColor = color.scale(emissive);
  result.metallic = 0.2;
  result.roughness = 0.75;
  return result;
}

function worldPosition(snapshot: SimulationSnapshot, x: number, y: number): Vector3 {
  return new Vector3(x - snapshot.width / 2 + 0.5, 0, y - snapshot.height / 2 + 0.5);
}

export function createCityScene(engine: AbstractEngine, initial: SimulationSnapshot): CityScene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.018, 0.027, 0.065, 1);
  scene.ambientColor = new Color3(0.08, 0.1, 0.18);

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 3,
    Math.PI / 3.2,
    18,
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 30;
  camera.wheelPrecision = 35;
  camera.pinchPrecision = 90;
  camera.panningSensibility = 0;
  const canvas = engine.getRenderingCanvas();
  if (canvas !== null) camera.attachControl(canvas, true);

  const skyLight = new HemisphericLight('sky-light', new Vector3(0.2, 1, 0.1), scene);
  skyLight.intensity = 1.25;
  skyLight.groundColor = new Color3(0.08, 0.12, 0.2);
  const keyLight = new DirectionalLight('key-light', new Vector3(-0.5, -1, 0.4), scene);
  keyLight.intensity = 1.5;

  const groundMaterial = material(scene, 'ground-material', new Color3(0.035, 0.07, 0.11), 0.05);
  const alternateMaterial = material(
    scene,
    'alternate-ground-material',
    new Color3(0.04, 0.095, 0.13),
    0.08,
  );
  for (let y = 0; y < initial.height; y += 1) {
    for (let x = 0; x < initial.width; x += 1) {
      const tile = CreateBox(
        `tile-${String(x)}-${String(y)}`,
        { width: 0.94, depth: 0.94, height: 0.08 },
        scene,
      );
      tile.position = worldPosition(initial, x, y);
      tile.position.y = -0.08;
      tile.material = (x + y) % 2 === 0 ? groundMaterial : alternateMaterial;
      tile.isPickable = false;
    }
  }

  const homeMaterial = material(scene, 'home-material', new Color3(0.26, 0.45, 0.86), 0.1);
  const workMaterial = material(scene, 'work-material', new Color3(0.59, 0.28, 0.8), 0.12);
  const windowMaterial = material(scene, 'window-material', new Color3(0.33, 0.95, 0.82), 0.7);
  for (const building of initial.buildings) {
    const root = new TransformNode(`building-${building.id}`, scene);
    root.position = worldPosition(initial, building.position.x, building.position.y);
    const floors = building.type === 'home' ? 2 : 4;
    const body = CreateBox(
      `${building.id}-body`,
      { width: 0.8, depth: 0.8, height: floors * 0.45 },
      scene,
    );
    body.parent = root;
    body.position.y = (floors * 0.45) / 2;
    body.material = building.type === 'home' ? homeMaterial : workMaterial;
    const beacon = CreateBox(`${building.id}-beacon`, { size: 0.2 }, scene);
    beacon.parent = root;
    beacon.position.y = floors * 0.45 + 0.15;
    beacon.material = windowMaterial;
  }

  const citizenMaterial = material(scene, 'citizen-material', new Color3(0.98, 0.65, 0.27), 0.18);
  const citizenAccent = material(scene, 'citizen-accent', new Color3(0.33, 0.95, 0.82), 0.3);
  const citizenNodes = new Map<string, TransformNode>();
  for (const citizen of initial.citizens) {
    const root = new TransformNode(`render-${citizen.id}`, scene);
    const body = CreateBox(`${citizen.id}-body`, { width: 0.22, height: 0.38, depth: 0.18 }, scene);
    body.parent = root;
    body.position.y = 0.3;
    body.material = citizenMaterial;
    const head = CreateBox(`${citizen.id}-head`, { size: 0.18 }, scene);
    head.parent = root;
    head.position.y = 0.58;
    head.material = citizenAccent;
    citizenNodes.set(citizen.id, root);
  }

  const update = (snapshot: SimulationSnapshot, interpolation: number): void => {
    const alpha = Math.max(0, Math.min(1, interpolation));
    for (const citizen of snapshot.citizens) {
      const node = citizenNodes.get(citizen.id);
      if (node === undefined) throw new Error(`Missing render entity for ${citizen.id}.`);
      const x =
        citizen.previousPosition.x + (citizen.position.x - citizen.previousPosition.x) * alpha;
      const y =
        citizen.previousPosition.y + (citizen.position.y - citizen.previousPosition.y) * alpha;
      node.position = worldPosition(snapshot, x, y);
      node.position.y = 0.04;
    }
  };
  update(initial, 1);

  return {
    scene,
    update,
    dispose(): void {
      scene.dispose();
    },
  };
}
