import type { DistrictSeedPlacementInfo } from '@idle-city/simulation';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateLineSystem, CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { GridPosition } from '@idle-city/shared';
import { logicalToWorld } from './coordinates';
import type { CityMaterials } from './materials';

export interface PlacementPreview {
  readonly position: GridPosition;
  readonly valid: boolean;
  readonly radius?: number;
  readonly sideLength?: number;
  readonly coveredCells?: readonly GridPosition[];
  readonly activeCoveredCells?: readonly GridPosition[];
  readonly selected?: boolean;
}

export interface PlacementPreviewLayer {
  setPreview(preview: PlacementPreview | DistrictSeedPlacementInfo | undefined): void;
  dispose(): void;
}

const MAX_ACTIVE_INFLUENCE_LINES = 4096;
const zeroLine = (): [Vector3, Vector3] => [Vector3.Zero(), Vector3.Zero()];

function boundedActiveLines(lines: Vector3[][]): Vector3[][] {
  const bounded = lines.slice(0, MAX_ACTIVE_INFLUENCE_LINES);
  while (bounded.length < MAX_ACTIVE_INFLUENCE_LINES) bounded.push(zeroLine());
  return bounded;
}

function linePositions(lines: readonly Vector3[][]): number[] {
  return lines.flatMap((line) => {
    const start = line[0] ?? Vector3.Zero();
    const end = line[1] ?? Vector3.Zero();
    return [start.x, start.y, start.z, end.x, end.y, end.z];
  });
}

function squareOutlinePoints(
  center: GridPosition,
  sideLength: number,
  cellWorldScale: number,
): Vector3[] {
  const origin = logicalToWorld(center, cellWorldScale);
  const halfExtent = (sideLength / 2) * cellWorldScale;
  return [
    new Vector3(origin.x - halfExtent, 0.13, origin.z - halfExtent),
    new Vector3(origin.x + halfExtent, 0.13, origin.z - halfExtent),
    new Vector3(origin.x + halfExtent, 0.13, origin.z + halfExtent),
    new Vector3(origin.x - halfExtent, 0.13, origin.z + halfExtent),
    new Vector3(origin.x - halfExtent, 0.13, origin.z - halfExtent),
  ];
}

function activeBoundaryLines(
  center: GridPosition,
  activeCells: readonly GridPosition[],
  cellWorldScale: number,
): Vector3[][] {
  const active = new Set(activeCells.map((cell) => `${String(cell.x)},${String(cell.y)}`));
  const lines: Vector3[][] = [];
  const edges = [
    { x: 0, y: -1, a: [-0.5, -0.5], b: [0.5, -0.5] },
    { x: 1, y: 0, a: [0.5, -0.5], b: [0.5, 0.5] },
    { x: 0, y: 1, a: [0.5, 0.5], b: [-0.5, 0.5] },
    { x: -1, y: 0, a: [-0.5, 0.5], b: [-0.5, -0.5] },
  ] as const;
  const origin = logicalToWorld(center, cellWorldScale);
  for (const cell of activeCells) {
    for (const edge of edges) {
      if (active.has(`${String(cell.x + edge.x)},${String(cell.y + edge.y)}`)) continue;
      const centerX = origin.x + (cell.x - center.x) * cellWorldScale;
      const centerZ = origin.z + (cell.y - center.y) * cellWorldScale;
      lines.push([
        new Vector3(
          centerX + edge.a[0] * cellWorldScale,
          0.14,
          centerZ + edge.a[1] * cellWorldScale,
        ),
        new Vector3(
          centerX + edge.b[0] * cellWorldScale,
          0.14,
          centerZ + edge.b[1] * cellWorldScale,
        ),
      ]);
    }
  }
  return lines;
}

export function createPlacementPreviewLayer(
  scene: Scene,
  cellWorldScale: number,
  materials: CityMaterials,
): PlacementPreviewLayer {
  const mesh = CreateBox('placement-preview', { size: 1 }, scene);
  mesh.scaling.copyFromFloats(cellWorldScale, 0.06, cellWorldScale);
  mesh.material = materials.placementValid;
  mesh.isPickable = false;
  mesh.isVisible = false;
  let influence: ReturnType<typeof CreateLines> | undefined;
  let activeInfluence: ReturnType<typeof CreateLineSystem> | undefined;
  let disposed = false;

  return {
    setPreview(preview: PlacementPreview | DistrictSeedPlacementInfo | undefined): void {
      if (disposed) throw new Error('Cannot update a disposed placement preview.');
      if (preview === undefined) {
        mesh.isVisible = false;
        if (influence !== undefined) influence.isVisible = false;
        if (activeInfluence !== undefined) activeInfluence.isVisible = false;
        return;
      }
      mesh.position = logicalToWorld(preview.position, cellWorldScale);
      mesh.position.y = 0.08;
      const emphasis = 'selected' in preview && preview.selected ? 1.25 : 1;
      mesh.scaling.copyFromFloats(cellWorldScale * emphasis, 0.06, cellWorldScale * emphasis);
      mesh.material = preview.valid ? materials.placementValid : materials.placementInvalid;
      mesh.isVisible = true;
      const sideLength =
        preview.sideLength ?? (preview.radius === undefined ? 3 : preview.radius * 2 + 1);
      if (influence === undefined) {
        influence = CreateLines(
          'placement-preview-influence',
          { points: squareOutlinePoints(preview.position, sideLength, cellWorldScale) },
          scene,
        );
        influence.isPickable = false;
      } else {
        CreateLines(
          'placement-preview-influence',
          {
            points: squareOutlinePoints(preview.position, sideLength, cellWorldScale),
            instance: influence,
          },
          scene,
        );
      }
      influence.material = preview.valid ? materials.influenceLiving : materials.placementInvalid;
      influence.isVisible = true;
      const activeLines = activeBoundaryLines(
        preview.position,
        preview.activeCoveredCells ?? preview.coveredCells ?? [],
        cellWorldScale,
      );
      const lines = boundedActiveLines(activeLines);
      if (activeInfluence === undefined) {
        activeInfluence = CreateLineSystem(
          'placement-preview-active-influence',
          { lines, updatable: true },
          scene,
        );
      } else {
        activeInfluence.updateVerticesData(VertexBuffer.PositionKind, linePositions(lines));
      }
      activeInfluence.material = preview.valid
        ? materials.influenceWorking
        : materials.placementInvalid;
      activeInfluence.isPickable = false;
      activeInfluence.isVisible =
        (preview.activeCoveredCells ?? preview.coveredCells ?? []).length > 0;
    },
    dispose(): void {
      if (disposed) return;
      mesh.dispose();
      influence?.dispose();
      activeInfluence?.dispose();
      disposed = true;
    },
  };
}
