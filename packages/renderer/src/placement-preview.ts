import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { GridPosition } from '@idle-city/shared';
import { logicalToWorld } from './coordinates';
import type { CityMaterials } from './materials';

export interface PlacementPreview {
  readonly position: GridPosition;
  readonly valid: boolean;
}

export interface PlacementPreviewLayer {
  setPreview(preview: PlacementPreview | undefined): void;
  dispose(): void;
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
  let disposed = false;

  return {
    setPreview(preview: PlacementPreview | undefined): void {
      if (disposed) throw new Error('Cannot update a disposed placement preview.');
      if (preview === undefined) {
        mesh.isVisible = false;
        return;
      }
      mesh.position = logicalToWorld(preview.position, cellWorldScale);
      mesh.position.y = 0.08;
      mesh.material = preview.valid ? materials.placementValid : materials.placementInvalid;
      mesh.isVisible = true;
    },
    dispose(): void {
      if (disposed) return;
      mesh.dispose();
      disposed = true;
    },
  };
}
