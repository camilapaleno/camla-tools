import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

// ─────────────────────────────────────────────
// RAW SVG path string from floppyAsset_1.svg
// viewBox: 0 0 416.65 436.33
// ─────────────────────────────────────────────
const FLOPPY_SVG_PATH = `M399.38,436.32c-8.43-.07-17.05-.45-25.56-.23-1.57-.2-.88-1.49-1.07-1.69-.07-.07-1.05.05-1.33-.01-108.85.41-217.84.44-326.68-.01l-.96.5-.36-.48c.62,1.29-.77.92-.24,1.68H10.19c-6.03-.41-9.79-5.37-10.19-11.14V11.38C-.04,7.16,3.31,1.96,7.4.79c.86-.24,1.68-.15,2.29-.31.26-.07.13-.48.16-.48h35.62s.36.33.36.36v3.96h56.13c.08,0-.17-1.4.14-1.44h219.34s.24,9.12.24,9.12h13.31l3.84-5.28h38.74V.36s.33-.36.36-.36h16.19c6.77,8.74,14.31,17,21.34,25.55.46.56.83,1.18,1.21,1.79v397.22c-.37,1-.27,2.11-.51,3.21-.71,3.32-3.67,6.52-6.81,7.69-1.08.4-2.39.46-3.48.85-2.15-.01-4.32.02-6.48,0ZM402.5,388.59h-18.95v18.47h18.95v-18.47ZM13.68,388.83v18.47h19.19v-18.47H13.68Z`;

// SVG viewBox dimensions (used to center the geometry)
const SVG_WIDTH = 416.65;
const SVG_HEIGHT = 436.33;

/**
 * Creates a 3D extruded floppy disk mesh from the SVG silhouette.
 *
 * @param {object} options
 * @param {number} options.depth        - Extrusion depth (thickness). Default: 12
 * @param {number} options.scale        - Uniform scale applied after extrusion. Default: 0.005
 * @param {THREE.Material} options.material - Optional custom material
 * @returns {THREE.Mesh}
 */
export function createFloppyDisk({
  depth = 12,
  scale = 0.005,
  material,
} = {}) {
  // --- Parse SVG path into Three.js shapes ---
  const loader = new SVGLoader();
  const svgData = loader.parse(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
      <path d="${FLOPPY_SVG_PATH}" />
    </svg>
  `);

  const shapes = [];
  for (const path of svgData.paths) {
    const pathShapes = SVGLoader.createShapes(path);
    shapes.push(...pathShapes);
  }

  if (shapes.length === 0) {
    throw new Error('SVGLoader produced no shapes — check the path data.');
  }

  // --- Extrude ---
  const extrudeSettings = {
    depth,
    bevelEnabled: true,
    bevelThickness: 1.5,
    bevelSize: 1,
    bevelOffset: 0,
    bevelSegments: 4,
  };

  // Merge all sub-shapes into one geometry
  const geometries = shapes.map(
    (shape) => new THREE.ExtrudeGeometry(shape, extrudeSettings)
  );
  const mergedGeo =
    geometries.length === 1
      ? geometries[0]
      : mergeGeometries(geometries); // see helper below

  // --- Center the geometry ---
  mergedGeo.computeBoundingBox();
  const bb = mergedGeo.boundingBox;
  const cx = (bb.max.x + bb.min.x) / 2;
  const cy = (bb.max.y + bb.min.y) / 2;
  mergedGeo.translate(-cx, -cy, -depth / 2);

  // SVG Y-axis is flipped relative to Three.js — correct it
  mergedGeo.scale(1, -1, 1);

  // --- Material ---
  const mat =
    material ||
    new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.4,
      metalness: 0.6,
    });

  const mesh = new THREE.Mesh(mergedGeo, mat);
  mesh.scale.setScalar(scale);

  return mesh;
}

// ─── Minimal geometry merger (avoids importing BufferGeometryUtils) ───────────
function mergeGeometries(geos) {
  // Use THREE.BufferGeometryUtils if available in your build,
  // otherwise fall back to this simple attribute-level merge.
  try {
    const { mergeGeometries: merge } = await import(
      'three/examples/jsm/utils/BufferGeometryUtils.js'
    );
    return merge(geos);
  } catch {
    // Manual merge
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let indexOffset = 0;

    for (const geo of geos) {
      geo.computeVertexNormals();
      const pos = geo.attributes.position.array;
      const nor = geo.attributes.normal.array;
      const uv = geo.attributes.uv ? geo.attributes.uv.array : new Float32Array((pos.length / 3) * 2);
      const idx = geo.index ? geo.index.array : null;

      positions.push(...pos);
      normals.push(...nor);
      uvs.push(...uv);

      if (idx) {
        for (const i of idx) indices.push(i + indexOffset);
      } else {
        for (let i = 0; i < pos.length / 3; i++) indices.push(i + indexOffset);
      }
      indexOffset += pos.length / 3;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    merged.setIndex(indices);
    return merged;
  }
}
