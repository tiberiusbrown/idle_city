import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import '@babylonjs/core/Culling/ray';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene } from '@babylonjs/core/scene';
import type { BuildingId, CitizenId, GridRect, ZoneId } from '@idle-city/shared';
import { getBuildingArchetype } from '@idle-city/simulation';
import type { BuildingVisualKind, SimulationSnapshot } from '@idle-city/simulation';
import type { ZoneType } from '@idle-city/simulation';
import {
  DEFAULT_LOGICAL_CELL_WORLD_SCALE,
  interpolatedLogicalToWorld,
  logicalRectToWorldCenter,
  worldToLogical,
} from './coordinates';

export {
  DEFAULT_LOGICAL_CELL_WORLD_SCALE,
  interpolatedLogicalToWorld,
  logicalToWorld,
  logicalRectToWorldCenter,
  worldToLogical,
} from './coordinates';

export interface ZonePlacementPreview {
  readonly zoneType: ZoneType;
  readonly rect: GridRect;
  readonly valid: boolean;
}

export interface CityScene {
  readonly scene: Scene;
  update(snapshot: SimulationSnapshot, interpolationAlpha?: number): void;
  setZonePlacementPreview(preview: ZonePlacementPreview | undefined): void;
  pickLogicalCell(clientX: number, clientY: number): ReturnType<typeof worldToLogical> | undefined;
  resize(): void;
  dispose(): void;
}

interface ZoneVisual {
  readonly type: ZoneType;
  readonly width: number;
  readonly height: number;
  readonly fill: Mesh;
  readonly outline: readonly Mesh[];
}

interface ZoneMaterials {
  readonly fill: StandardMaterial;
  readonly outline: StandardMaterial;
}

interface BuildingVisual {
  readonly visualKind: BuildingVisualKind;
  readonly incomplete: boolean;
  readonly width: number;
  readonly depth: number;
  readonly mesh: Mesh;
}

function createZoneVisual(
  scene: Scene,
  name: string,
  type: ZoneType,
  rect: GridRect,
  materials: ZoneMaterials,
  cellWorldScale: number,
): ZoneVisual {
  const fill = MeshBuilder.CreateGround(
    `${name}-fill`,
    { width: rect.width * cellWorldScale, height: rect.height * cellWorldScale },
    scene,
  );
  fill.material = materials.fill;
  fill.isPickable = false;

  const outlineThickness = 0.14 * cellWorldScale;
  const outlineHeight = 0.12 * cellWorldScale;
  const outline = [
    MeshBuilder.CreateBox(
      `${name}-outline-north`,
      {
        width: rect.width * cellWorldScale + outlineThickness * 2,
        height: outlineHeight,
        depth: outlineThickness,
      },
      scene,
    ),
    MeshBuilder.CreateBox(
      `${name}-outline-east`,
      { width: outlineThickness, height: outlineHeight, depth: rect.height * cellWorldScale },
      scene,
    ),
    MeshBuilder.CreateBox(
      `${name}-outline-south`,
      {
        width: rect.width * cellWorldScale + outlineThickness * 2,
        height: outlineHeight,
        depth: outlineThickness,
      },
      scene,
    ),
    MeshBuilder.CreateBox(
      `${name}-outline-west`,
      { width: outlineThickness, height: outlineHeight, depth: rect.height * cellWorldScale },
      scene,
    ),
  ];
  for (const mesh of outline) {
    mesh.material = materials.outline;
    mesh.isPickable = false;
  }

  const visual = { type, width: rect.width, height: rect.height, fill, outline };
  updateZoneVisual(visual, rect, cellWorldScale);
  return visual;
}

function updateZoneVisual(visual: ZoneVisual, rect: GridRect, cellWorldScale: number): void {
  const center = logicalRectToWorldCenter(rect, cellWorldScale);
  visual.fill.position.copyFrom(center);
  visual.fill.position.y = 0.025 * cellWorldScale;

  const halfWidth = (rect.width / 2) * cellWorldScale;
  const halfHeight = (rect.height / 2) * cellWorldScale;
  const outlineThickness = 0.14 * cellWorldScale;
  const outlineY = 0.09 * cellWorldScale;
  const [north, east, south, west] = visual.outline;
  if (north === undefined || east === undefined || south === undefined || west === undefined) {
    throw new Error('Zone outline was missing a side.');
  }

  north.position.set(center.x, outlineY, center.z - halfHeight - outlineThickness / 2);
  east.position.set(center.x + halfWidth + outlineThickness / 2, outlineY, center.z);
  south.position.set(center.x, outlineY, center.z + halfHeight + outlineThickness / 2);
  west.position.set(center.x - halfWidth - outlineThickness / 2, outlineY, center.z);
}

function setZoneVisualVisibility(visual: ZoneVisual, visible: boolean): void {
  visual.fill.isVisible = visible;
  for (const mesh of visual.outline) mesh.isVisible = visible;
}

function disposeZoneVisual(visual: ZoneVisual): void {
  visual.fill.dispose();
  for (const mesh of visual.outline) mesh.dispose();
}

function physicalFootprintBounds(
  physicalCells: SimulationSnapshot['buildings'][number]['physicalCells'],
): GridRect {
  const first = physicalCells[0];
  if (first === undefined) throw new Error('Building physical footprints must not be empty.');

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const cell of physicalCells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function completedBuildingHeight(visualKind: BuildingVisualKind): number {
  if (visualKind === 'house') return 2;
  if (visualKind === 'shop') return 3;
  return 0.12;
}

function buildingMaterial(
  materials: Readonly<Record<BuildingVisualKind, StandardMaterial>>,
  constructionMaterial: StandardMaterial,
  visualKind: BuildingVisualKind,
  incomplete: boolean,
): StandardMaterial {
  return incomplete ? constructionMaterial : materials[visualKind];
}

function createBuildingVisual(
  scene: Scene,
  building: SimulationSnapshot['buildings'][number],
  materials: Readonly<Record<BuildingVisualKind, StandardMaterial>>,
  constructionMaterial: StandardMaterial,
): BuildingVisual {
  const visualKind = getBuildingArchetype(building.archetypeId).visualKind;
  const incomplete = building.state.kind === 'incomplete';
  const bounds = physicalFootprintBounds(building.physicalCells);
  const height = incomplete ? 0.22 : completedBuildingHeight(visualKind);
  const mesh = MeshBuilder.CreateBox(
    `building-${building.id}`,
    { width: bounds.width, height, depth: bounds.height },
    scene,
  );
  mesh.material = buildingMaterial(materials, constructionMaterial, visualKind, incomplete);
  mesh.isPickable = false;

  const visual = { visualKind, incomplete, width: bounds.width, depth: bounds.height, mesh };
  updateBuildingVisual(visual, bounds, height);
  return visual;
}

function updateBuildingVisual(visual: BuildingVisual, bounds: GridRect, height: number): void {
  const center = logicalRectToWorldCenter(bounds, DEFAULT_LOGICAL_CELL_WORLD_SCALE);
  visual.mesh.position.set(center.x, height / 2 + 0.05, center.z);
}

function createZoneMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  alpha: number,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.12);
  material.specularColor = new Color3(0.04, 0.04, 0.04);
  material.alpha = alpha;
  material.backFaceCulling = false;
  return material;
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
    14,
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 4;
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

  const zoneMaterials: Record<ZoneType, ZoneMaterials> = {
    living: {
      fill: createZoneMaterial(scene, 'living-zone-fill', new Color3(0.38, 0.82, 0.45), 0.42),
      outline: createZoneMaterial(scene, 'living-zone-outline', new Color3(0.18, 0.68, 0.28), 0.95),
    },
    working: {
      fill: createZoneMaterial(scene, 'working-zone-fill', new Color3(0.38, 0.6, 0.98), 0.42),
      outline: createZoneMaterial(scene, 'working-zone-outline', new Color3(0.16, 0.4, 0.9), 0.95),
    },
    leisure: {
      fill: createZoneMaterial(scene, 'leisure-zone-fill', new Color3(0.98, 0.64, 0.3), 0.42),
      outline: createZoneMaterial(scene, 'leisure-zone-outline', new Color3(0.9, 0.4, 0.1), 0.95),
    },
  };
  const placementInvalidFill = createZoneMaterial(
    scene,
    'placement-zone-invalid-fill',
    new Color3(0.95, 0.22, 0.26),
    0.48,
  );
  const placementInvalidOutline = createZoneMaterial(
    scene,
    'placement-zone-invalid-outline',
    new Color3(0.98, 0.12, 0.16),
    0.98,
  );

  const buildingMaterials: Readonly<Record<BuildingVisualKind, StandardMaterial>> = {
    house: createZoneMaterial(scene, 'house-building', new Color3(0.26, 0.78, 0.34), 1),
    shop: createZoneMaterial(scene, 'shop-building', new Color3(0.24, 0.48, 0.92), 1),
    park: createZoneMaterial(scene, 'park-building', new Color3(0.3, 0.72, 0.32), 1),
  };
  const constructionMaterial = createZoneMaterial(
    scene,
    'incomplete-building',
    new Color3(0.72, 0.58, 0.28),
    0.92,
  );

  const zoneVisuals = new Map<ZoneId, ZoneVisual>();
  const buildingVisuals = new Map<BuildingId, BuildingVisual>();
  let placementPreview: ZoneVisual | undefined;

  const reconcileZones = (snapshot: SimulationSnapshot): void => {
    const seenIds = new Set<ZoneId>();
    for (const zone of snapshot.zones) {
      if (seenIds.has(zone.id)) throw new Error(`Duplicate zone ID ${zone.id}.`);
      seenIds.add(zone.id);

      let visual = zoneVisuals.get(zone.id);
      if (
        visual !== undefined &&
        (visual.type !== zone.type ||
          visual.width !== zone.rect.width ||
          visual.height !== zone.rect.height)
      ) {
        disposeZoneVisual(visual);
        zoneVisuals.delete(zone.id);
        visual = undefined;
      }
      if (visual === undefined) {
        visual = createZoneVisual(
          scene,
          `zone-${zone.id}`,
          zone.type,
          zone.rect,
          zoneMaterials[zone.type],
          DEFAULT_LOGICAL_CELL_WORLD_SCALE,
        );
        zoneVisuals.set(zone.id, visual);
      }
      updateZoneVisual(visual, zone.rect, DEFAULT_LOGICAL_CELL_WORLD_SCALE);
      setZoneVisualVisibility(visual, true);
    }

    for (const [id, visual] of zoneVisuals) {
      if (seenIds.has(id)) continue;
      disposeZoneVisual(visual);
      zoneVisuals.delete(id);
    }
  };

  const reconcileBuildings = (snapshot: SimulationSnapshot): void => {
    const seenIds = new Set<BuildingId>();
    for (const building of snapshot.buildings) {
      if (seenIds.has(building.id)) throw new Error(`Duplicate building ID ${building.id}.`);
      seenIds.add(building.id);

      const visualKind = getBuildingArchetype(building.archetypeId).visualKind;
      const incomplete = building.state.kind === 'incomplete';
      const bounds = physicalFootprintBounds(building.physicalCells);
      let visual = buildingVisuals.get(building.id);
      if (
        visual !== undefined &&
        (visual.visualKind !== visualKind ||
          visual.incomplete !== incomplete ||
          visual.width !== bounds.width ||
          visual.depth !== bounds.height)
      ) {
        visual.mesh.dispose();
        buildingVisuals.delete(building.id);
        visual = undefined;
      }
      if (visual === undefined) {
        visual = createBuildingVisual(scene, building, buildingMaterials, constructionMaterial);
        buildingVisuals.set(building.id, visual);
      } else {
        const height = incomplete ? 0.22 : completedBuildingHeight(visualKind);
        visual.mesh.material = buildingMaterial(
          buildingMaterials,
          constructionMaterial,
          visualKind,
          incomplete,
        );
        updateBuildingVisual(visual, bounds, height);
      }
    }

    for (const [id, visual] of buildingVisuals) {
      if (seenIds.has(id)) continue;
      visual.mesh.dispose();
      buildingVisuals.delete(id);
    }
  };

  const setZonePlacementPreview = (preview: ZonePlacementPreview | undefined): void => {
    if (disposed) throw new Error('Cannot update a disposed city scene.');
    if (preview === undefined) {
      if (placementPreview !== undefined) setZoneVisualVisibility(placementPreview, false);
      return;
    }

    if (
      placementPreview !== undefined &&
      (placementPreview.type !== preview.zoneType ||
        placementPreview.width !== preview.rect.width ||
        placementPreview.height !== preview.rect.height)
    ) {
      disposeZoneVisual(placementPreview);
      placementPreview = undefined;
    }
    placementPreview ??= createZoneVisual(
      scene,
      'zone-placement-preview',
      preview.zoneType,
      preview.rect,
      zoneMaterials[preview.zoneType],
      DEFAULT_LOGICAL_CELL_WORLD_SCALE,
    );

    const previewMaterials = preview.valid
      ? zoneMaterials[preview.zoneType]
      : { fill: placementInvalidFill, outline: placementInvalidOutline };
    placementPreview.fill.material = previewMaterials.fill;
    for (const mesh of placementPreview.outline) mesh.material = previewMaterials.outline;
    updateZoneVisual(placementPreview, preview.rect, DEFAULT_LOGICAL_CELL_WORLD_SCALE);
    setZoneVisualVisibility(placementPreview, true);
  };

  const pickLogicalCell = (
    clientX: number,
    clientY: number,
  ): ReturnType<typeof worldToLogical> | undefined => {
    if (canvas === null) return undefined;
    const bounds = canvas.getBoundingClientRect();
    const picked = scene.pick(
      clientX - bounds.left,
      clientY - bounds.top,
      (mesh) => mesh === ground,
    );
    if (!picked.hit || picked.pickedPoint === null) return undefined;
    return worldToLogical(picked.pickedPoint);
  };

  const citizenMaterial = new StandardMaterial('citizen-material', scene);
  citizenMaterial.diffuseColor = new Color3(0.98, 0.62, 0.26);
  citizenMaterial.emissiveColor = new Color3(0.12, 0.06, 0.02);
  citizenMaterial.specularColor = new Color3(0.08, 0.06, 0.03);

  const citizenVisuals = new Map<CitizenId, Mesh>();
  const reconcileCitizens = (snapshot: SimulationSnapshot, interpolationAlpha: number): void => {
    const seenIds = new Set<CitizenId>();

    for (const citizen of snapshot.citizens) {
      if (seenIds.has(citizen.id)) throw new Error(`Duplicate citizen ID ${citizen.id}.`);
      seenIds.add(citizen.id);

      let visual = citizenVisuals.get(citizen.id);
      if (visual === undefined) {
        visual = MeshBuilder.CreateBox(
          `citizen-${citizen.id}`,
          { width: 0.62, height: 0.8, depth: 0.62 },
          scene,
        );
        visual.material = citizenMaterial;
        visual.isPickable = false;
        citizenVisuals.set(citizen.id, visual);
      }

      const interpolatedPosition = interpolatedLogicalToWorld(
        citizen.previousPosition,
        citizen.position,
        interpolationAlpha,
        DEFAULT_LOGICAL_CELL_WORLD_SCALE,
      );
      visual.position.copyFrom(interpolatedPosition);
      visual.position.y = 0.4;
    }

    for (const [id, visual] of citizenVisuals) {
      if (seenIds.has(id)) continue;
      visual.dispose();
      citizenVisuals.delete(id);
    }
  };

  let disposed = false;
  const update = (snapshot: SimulationSnapshot, interpolationAlpha = 1): void => {
    if (disposed) throw new Error('Cannot update a disposed city scene.');
    const clampedInterpolationAlpha = Math.min(1, Math.max(0, interpolationAlpha));
    reconcileZones(snapshot);
    reconcileBuildings(snapshot);
    reconcileCitizens(snapshot, clampedInterpolationAlpha);
  };

  update(initialSnapshot);

  return {
    scene,
    update,
    setZonePlacementPreview,
    pickLogicalCell,
    resize(): void {
      if (disposed) return;
      engine.resize();
    },
    dispose(): void {
      if (disposed) return;
      camera.detachControl();
      if (placementPreview !== undefined) disposeZoneVisual(placementPreview);
      for (const visual of zoneVisuals.values()) disposeZoneVisual(visual);
      zoneVisuals.clear();
      for (const visual of buildingVisuals.values()) visual.mesh.dispose();
      buildingVisuals.clear();
      for (const visual of citizenVisuals.values()) visual.dispose();
      citizenVisuals.clear();
      scene.dispose();
      disposed = true;
    },
  };
}
