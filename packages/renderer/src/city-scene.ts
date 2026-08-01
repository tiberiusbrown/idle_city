import type { ChunkCoordinate, GridPosition } from '@idle-city/shared';
import { chunkCoordinateForPosition, chunkKey } from '@idle-city/simulation';
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

export const DEFAULT_LOGICAL_CELL_WORLD_SCALE = 0.25;

export interface CitySceneOptions {
  readonly visibleChunks?: readonly ChunkCoordinate[];
  readonly visibleChunkRadius?: number;
  readonly cellWorldScale?: number;
}

export interface CitySceneStructuralCounters {
  readonly visibleChunks: number;
  readonly renderedChunks: number;
  readonly chunkRebuilds: number;
  readonly meshCount: number;
}

export interface CityScene {
  readonly scene: Scene;
  update(snapshot: SimulationSnapshot, interpolation: number): void;
  setVisibleChunks(chunks: readonly ChunkCoordinate[]): void;
  getStructuralCounters(): CitySceneStructuralCounters;
  dispose(): void;
}

interface GroundChunk {
  readonly chunk: ChunkCoordinate;
  readonly revision: number;
  readonly mesh: ReturnType<typeof CreateBox>;
}

function material(scene: Scene, name: string, color: Color3, emissive = 0): PBRMaterial {
  const result = new PBRMaterial(name, scene);
  result.albedoColor = color;
  result.emissiveColor = color.scale(emissive);
  result.metallic = 0.2;
  result.roughness = 0.75;
  return result;
}

export function logicalToWorld(
  position: GridPosition,
  cellWorldScale = DEFAULT_LOGICAL_CELL_WORLD_SCALE,
): Vector3 {
  return new Vector3((position.x + 0.5) * cellWorldScale, 0, (position.y + 0.5) * cellWorldScale);
}

function chunkToWorldCenter(
  chunk: ChunkCoordinate,
  chunkSize: number,
  cellWorldScale: number,
): Vector3 {
  return new Vector3(
    (chunk.x * chunkSize + chunkSize / 2) * cellWorldScale,
    -0.08,
    (chunk.y * chunkSize + chunkSize / 2) * cellWorldScale,
  );
}

function footprintToWorldCenter(
  footprint: SimulationSnapshot['buildings'][number]['footprint'],
  cellWorldScale: number,
): Vector3 {
  return new Vector3(
    (footprint.x + footprint.width / 2) * cellWorldScale,
    0,
    (footprint.y + footprint.height / 2) * cellWorldScale,
  );
}

function validateVisibleRadius(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `visibleChunkRadius must be a non-negative safe integer; received ${String(value)}.`,
    );
  }
  return value;
}

export function createCityScene(
  engine: AbstractEngine,
  initial: SimulationSnapshot,
  options: CitySceneOptions = {},
): CityScene {
  const cellWorldScale = options.cellWorldScale ?? DEFAULT_LOGICAL_CELL_WORLD_SCALE;
  if (!Number.isFinite(cellWorldScale) || cellWorldScale <= 0) {
    throw new Error(`cellWorldScale must be positive; received ${String(cellWorldScale)}.`);
  }
  const visibleRadius = validateVisibleRadius(options.visibleChunkRadius ?? 1);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.018, 0.027, 0.065, 1);
  scene.ambientColor = new Color3(0.08, 0.1, 0.18);

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 3,
    Math.PI / 3.2,
    Math.max(18, initial.chunkSize * cellWorldScale * 1.4),
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 80;
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
  const homeMaterial = material(scene, 'home-material', new Color3(0.26, 0.45, 0.86), 0.1);
  const workMaterial = material(scene, 'work-material', new Color3(0.59, 0.28, 0.8), 0.12);
  const windowMaterial = material(scene, 'window-material', new Color3(0.33, 0.95, 0.82), 0.7);
  const citizenMaterial = material(scene, 'citizen-material', new Color3(0.98, 0.65, 0.27), 0.18);
  const citizenAccent = material(scene, 'citizen-accent', new Color3(0.33, 0.95, 0.82), 0.3);
  const groundChunks = new Map<string, GroundChunk>();
  const citizenNodes = new Map<string, TransformNode>();
  let explicitVisibleChunks = options.visibleChunks?.map((chunk) => ({ ...chunk }));
  let chunkRebuilds = 0;

  const createGroundChunk = (
    snapshot: SimulationSnapshot,
    summary: SimulationSnapshot['activeChunks'][number],
  ): GroundChunk => {
    const mesh = CreateBox(
      `ground-chunk-${summary.key}`,
      {
        width: snapshot.chunkSize * cellWorldScale,
        depth: snapshot.chunkSize * cellWorldScale,
        height: 0.08,
      },
      scene,
    );
    mesh.position = chunkToWorldCenter(summary.chunk, snapshot.chunkSize, cellWorldScale);
    mesh.material =
      (summary.chunk.x + summary.chunk.y) % 2 === 0 ? groundMaterial : alternateMaterial;
    mesh.isPickable = false;
    chunkRebuilds += 1;
    return { chunk: { ...summary.chunk }, revision: summary.occupancyRevision, mesh };
  };

  const visibleChunkCoordinates = (snapshot: SimulationSnapshot): readonly ChunkCoordinate[] => {
    const active = snapshot.activeChunks.map((summary) => summary.chunk);
    if (explicitVisibleChunks !== undefined) {
      const activeKeys = new Set(snapshot.activeChunks.map((summary) => summary.key));
      return explicitVisibleChunks
        .filter((chunk) => activeKeys.has(chunkKey(chunk)))
        .map((chunk) => ({ ...chunk }));
    }
    const targetLogical = {
      x: Math.floor(camera.target.x / cellWorldScale),
      y: Math.floor(camera.target.z / cellWorldScale),
    };
    const center = chunkCoordinateForPosition(targetLogical, snapshot.chunkSize);
    return active
      .filter(
        (chunk) =>
          Math.abs(chunk.x - center.x) <= visibleRadius &&
          Math.abs(chunk.y - center.y) <= visibleRadius,
      )
      .map((chunk) => ({ ...chunk }));
  };

  const reconcileGround = (snapshot: SimulationSnapshot): void => {
    const visible = visibleChunkCoordinates(snapshot);
    const summariesByKey = new Map(snapshot.activeChunks.map((summary) => [summary.key, summary]));
    const desiredKeys = new Set(visible.map(chunkKey));
    for (const [key, ground] of groundChunks) {
      if (desiredKeys.has(key)) continue;
      ground.mesh.dispose();
      groundChunks.delete(key);
    }
    for (const chunk of visible) {
      const key = chunkKey(chunk);
      const summary = summariesByKey.get(key);
      if (summary === undefined) continue;
      const current = groundChunks.get(key);
      if (current?.revision === summary.occupancyRevision) continue;
      current?.mesh.dispose();
      groundChunks.set(key, createGroundChunk(snapshot, summary));
    }
  };

  for (const building of initial.buildings) {
    const root = new TransformNode(`building-${building.id}`, scene);
    root.position = footprintToWorldCenter(building.footprint, cellWorldScale);
    const floors = building.type === 'home' ? 2 : 4;
    const body = CreateBox(
      `${building.id}-body`,
      {
        width: Math.max(0.5, building.footprint.width * cellWorldScale * 0.82),
        depth: Math.max(0.5, building.footprint.height * cellWorldScale * 0.82),
        height: floors * 0.45,
      },
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
    reconcileGround(snapshot);
    const alpha = Math.max(0, Math.min(1, interpolation));
    for (const citizen of snapshot.citizens) {
      const node = citizenNodes.get(citizen.id);
      if (node === undefined) throw new Error(`Missing render entity for ${citizen.id}.`);
      const logicalPosition = {
        x: citizen.previousPosition.x + (citizen.position.x - citizen.previousPosition.x) * alpha,
        y: citizen.previousPosition.y + (citizen.position.y - citizen.previousPosition.y) * alpha,
      };
      node.position = logicalToWorld(logicalPosition, cellWorldScale);
      node.position.y = 0.04;
    }
  };

  update(initial, 1);

  return {
    scene,
    update,
    setVisibleChunks(chunks: readonly ChunkCoordinate[]): void {
      explicitVisibleChunks = chunks.map((chunk) => ({ ...chunk }));
    },
    getStructuralCounters(): CitySceneStructuralCounters {
      return {
        visibleChunks: explicitVisibleChunks?.length ?? groundChunks.size,
        renderedChunks: groundChunks.size,
        chunkRebuilds,
        meshCount: scene.meshes.length,
      };
    },
    dispose(): void {
      scene.dispose();
    },
  };
}
