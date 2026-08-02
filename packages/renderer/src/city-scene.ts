import type { ChunkCoordinate, GridPosition } from '@idle-city/shared';
import '@babylonjs/core/Culling/ray';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import type {
  DistrictSeedDefinition,
  DistrictSeedKind,
  DistrictSeedPlacementInfo,
  SimulationSnapshot,
} from '@idle-city/simulation';
import { createBuildingLayer } from './buildings';
import { createCitizenLayer } from './citizens';
import { createChunkGroundLayer } from './chunk-ground';
import { DEFAULT_LOGICAL_CELL_WORLD_SCALE } from './coordinates';
import { createCityMaterials } from './materials';
import { createSeedLayer, type SeedVisibilityOptions } from './seeds';
import { createConstructionLayer } from './construction';
import { logicalCellToChunk, pointerToCanvasPosition, worldToLogicalCell } from './coordinates';
import { createPlacementPreviewLayer, type PlacementPreview } from './placement-preview';

export {
  DEFAULT_LOGICAL_CELL_WORLD_SCALE,
  footprintToWorldCenter,
  logicalCellToChunk,
  logicalToWorld,
  pointerToCanvasPosition,
  worldToChunk,
  worldToLogicalCell,
} from './coordinates';

export interface CitySceneOptions {
  readonly visibleChunks?: readonly ChunkCoordinate[];
  readonly visibleChunkRadius?: number;
  readonly cellWorldScale?: number;
  /** Renderer-only visual radius; simulation demand uses its own authoritative radius. */
  readonly seedInfluenceRadius?: number;
}

export interface CitySceneStructuralCounters {
  readonly visibleChunks: number;
  readonly renderedChunks: number;
  readonly chunkRebuilds: number;
  readonly visibleCitizens: number;
  readonly renderedCitizens: number;
  readonly meshCount: number;
}

export interface PickedLogicalCell {
  readonly position: GridPosition;
  readonly chunk: ChunkCoordinate;
}

export interface CityScene {
  readonly scene: Scene;
  update(snapshot: SimulationSnapshot, interpolation: number): void;
  pickLogicalCell(clientX: number, clientY: number): PickedLogicalCell | undefined;
  setPlacementPreview(preview: PlacementPreview | DistrictSeedPlacementInfo | undefined): void;
  setSeedInfluenceVisibility(options: SeedVisibilityOptions): void;
  setVisibleChunks(chunks: readonly ChunkCoordinate[]): void;
  getStructuralCounters(): CitySceneStructuralCounters;
  dispose(): void;
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

  const materials = createCityMaterials(scene);
  const ground = createChunkGroundLayer(scene, camera, materials, {
    visibleChunkRadius: options.visibleChunkRadius ?? 1,
    cellWorldScale,
    ...(options.visibleChunks === undefined ? {} : { visibleChunks: options.visibleChunks }),
  });
  const buildings = createBuildingLayer(scene, cellWorldScale, materials);
  const citizens = createCitizenLayer(scene, cellWorldScale, materials);
  const construction = createConstructionLayer(scene, cellWorldScale, materials);
  const seeds = createSeedLayer(
    scene,
    cellWorldScale,
    Object.fromEntries(
      initial.districtSeedDefinitions.map((definition) => [definition.kind, definition]),
    ) as Readonly<Record<DistrictSeedKind, DistrictSeedDefinition>>,
    materials,
  );
  const placementPreview = createPlacementPreviewLayer(scene, cellWorldScale, materials);
  let chunkSize = initial.chunkSize;
  let disposed = false;

  const update = (snapshot: SimulationSnapshot, interpolation: number): void => {
    if (disposed) throw new Error('Cannot update a disposed city scene.');
    chunkSize = snapshot.chunkSize;
    ground.reconcile(snapshot);
    buildings.reconcile(snapshot.buildings);
    construction.reconcile(snapshot.constructionProjects);
    seeds.reconcile(snapshot.seeds, snapshot.activeChunks, snapshot.chunkSize);
    citizens.reconcile(
      snapshot.citizens,
      interpolation,
      ground.getRenderedChunks(),
      snapshot.chunkSize,
    );
  };

  update(initial, 1);

  return {
    scene,
    update,
    pickLogicalCell(clientX: number, clientY: number): PickedLogicalCell | undefined {
      if (disposed) throw new Error('Cannot pick on a disposed city scene.');
      const canvas = engine.getRenderingCanvas();
      if (canvas === null) return undefined;
      const pointer = pointerToCanvasPosition({ clientX, clientY }, canvas);
      const pick = scene.pick(pointer.x, pointer.y, (mesh) =>
        mesh.name.startsWith('ground-chunk-'),
      );
      if (!pick.hit || pick.pickedPoint === null) return undefined;
      const position = worldToLogicalCell(pick.pickedPoint, cellWorldScale);
      return { position, chunk: logicalCellToChunk(position, chunkSize) };
    },
    setPlacementPreview(preview: PlacementPreview | DistrictSeedPlacementInfo | undefined): void {
      if (disposed) throw new Error('Cannot update a disposed city scene.');
      placementPreview.setPreview(preview);
    },
    setSeedInfluenceVisibility(options: SeedVisibilityOptions): void {
      if (disposed) throw new Error('Cannot change seed visibility on a disposed city scene.');
      seeds.setVisibility(options);
    },
    setVisibleChunks(chunks: readonly ChunkCoordinate[]): void {
      if (disposed) throw new Error('Cannot change visibility on a disposed city scene.');
      ground.setVisibleChunks(chunks);
    },
    getStructuralCounters(): CitySceneStructuralCounters {
      return {
        visibleChunks: ground.getVisibleChunkCount(),
        renderedChunks: ground.getRenderedChunkCount(),
        chunkRebuilds: ground.getRebuildCount(),
        visibleCitizens: citizens.getVisibleCitizenCount(),
        renderedCitizens: citizens.getRenderedCitizenCount(),
        meshCount: scene.meshes.length,
      };
    },
    dispose(): void {
      if (disposed) return;
      citizens.dispose();
      buildings.dispose();
      construction.dispose();
      seeds.dispose();
      placementPreview.dispose();
      ground.dispose();
      camera.detachControl();
      scene.dispose();
      disposed = true;
    },
  };
}
