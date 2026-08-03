import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene } from '@babylonjs/core/scene';
import type { SimulationSnapshot } from '@idle-city/simulation';

export interface CityScene {
  readonly scene: Scene;
  update(snapshot: SimulationSnapshot): void;
  resize(): void;
  dispose(): void;
}

export function createCityScene(
  engine: AbstractEngine,
  initialSnapshot: SimulationSnapshot,
): CityScene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.035, 0.047, 0.075, 1);

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 3,
    Math.PI / 3.2,
    28,
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 160;
  camera.wheelPrecision = 35;
  camera.pinchPrecision = 90;
  camera.panningSensibility = 0;

  const canvas = engine.getRenderingCanvas();
  if (canvas !== null) camera.attachControl(canvas, true);

  const light = new HemisphericLight('sky-light', new Vector3(0.2, 1, 0.1), scene);
  light.intensity = 1.1;
  light.groundColor = new Color3(0.08, 0.1, 0.15);

  const ground = MeshBuilder.CreateGround('ground', { width: 2_000, height: 2_000 }, scene);
  const groundMaterial = new StandardMaterial('ground-material', scene);
  groundMaterial.diffuseColor = new Color3(0.16, 0.19, 0.24);
  groundMaterial.specularColor = new Color3(0.03, 0.04, 0.06);
  ground.material = groundMaterial;

  let disposed = false;
  const update = (snapshot: SimulationSnapshot): void => {
    if (disposed) throw new Error('Cannot update a disposed city scene.');
    void snapshot;
  };

  update(initialSnapshot);

  return {
    scene,
    update,
    resize(): void {
      if (disposed) return;
      engine.resize();
    },
    dispose(): void {
      if (disposed) return;
      camera.detachControl();
      scene.dispose();
      disposed = true;
    },
  };
}
