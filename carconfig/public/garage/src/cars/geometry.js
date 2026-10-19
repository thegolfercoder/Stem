// Cutting meshes apart: by the class of each triangle, and into the
// connected pieces a mesh is made of. Used to keep the wheels, windows and
// body of merged models apart, and to clear stray bits out of a model.
import * as THREE from "three";

/**
 * Splits a mesh into one mesh per class of its triangles (`classes[k]` for
 * its k-th triangle), copying each triangle's raw attribute values. The new
 * meshes take the old one's place, transform and materials, and keep the
 * groups of a multi-material mesh. Returns the new meshes by class, or null
 * when the mesh is all one class or cannot be split.
 */
export function splitMesh(mesh, classes, nameOf = (c) => `${mesh.name} ${c}`) {
  const src = mesh.geometry;
  if (!mesh.parent || mesh.isSkinnedMesh || Object.keys(src.morphAttributes).length) return null;
  const tris = classes.length;
  const byClass = new Map();
  for (let k = 0; k < tris; k++) {
    let list = byClass.get(classes[k]);
    if (!list) byClass.set(classes[k], (list = []));
    list.push(k);
  }
  if (byClass.size < 2) return null;
  const multi = Array.isArray(mesh.material) && src.groups.length > 0;
  const materialOf = new Int32Array(tris);
  if (multi) for (const grp of src.groups) for (let k = grp.start / 3; k < Math.min(tris, (grp.start + grp.count) / 3); k++) materialOf[k] = grp.materialIndex ?? 0;
  const g = src.index ? src.toNonIndexed() : src;
  const out = new Map();
  for (const [c, list] of byClass) {
    if (multi) list.sort((a, b) => materialOf[a] - materialOf[b] || a - b);
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const inter = attr.isInterleavedBufferAttribute, from = inter ? attr.data.array : attr.array;
      const stride = inter ? attr.data.stride : attr.itemSize, offset = inter ? attr.offset : 0, size = attr.itemSize;
      const to = new from.constructor(list.length * 3 * size);
      let w = 0;
      for (const k of list) {
        for (let v = 0; v < 3; v++) {
          const base = (k * 3 + v) * stride + offset;
          for (let i = 0; i < size; i++) to[w++] = from[base + i];
        }
      }
      geo.setAttribute(name, new THREE.BufferAttribute(to, size, attr.normalized));
    }
    if (multi) {
      let start = 0;
      for (let i = 1; i <= list.length; i++) {
        if (i < list.length && materialOf[list[i]] === materialOf[list[start]]) continue;
        geo.addGroup(start * 3, (i - start) * 3, materialOf[list[start]]);
        start = i;
      }
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const piece = new THREE.Mesh(geo, mesh.material);
    piece.name = nameOf(c);
    piece.position.copy(mesh.position);
    piece.quaternion.copy(mesh.quaternion);
    piece.scale.copy(mesh.scale);
    piece.matrixAutoUpdate = mesh.matrixAutoUpdate;
    piece.matrix.copy(mesh.matrix);
    piece.visible = mesh.visible;
    mesh.parent.add(piece);
    out.set(c, piece);
  }
  mesh.removeFromParent();
  if (g !== src) g.dispose();
  src.dispose();
  return out;
}

/**
 * The connected pieces of a mesh: triangles that share a corner (split
 * vertices at texture seams still join) are one piece.
 * Returns the piece number of every triangle and the number of pieces.
 */
export function meshPieces(mesh) {
  const g = mesh.geometry, pos = g.attributes.position;
  if (!pos) return { piece: new Int32Array(0), count: 0 };
  const index = g.index;
  const tris = Math.floor((index ? index.count : pos.count) / 3);
  const parent = new Int32Array(tris).map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // Corners are matched on a grid of 2^17 steps across the mesh's own box
  // (a fraction of a millimetre on a whole car), packed into one number.
  if (!g.boundingBox) g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const steps = 131071;
  const fx = steps / (max.x - min.x || 1), fy = steps / (max.y - min.y || 1), fz = steps / (max.z - min.z || 1);
  const firstAt = new Map();
  const p = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    for (let c = 0; c < 3; c++) {
      p.fromBufferAttribute(pos, index ? index.getX(t * 3 + c) : t * 3 + c);
      const key = (Math.round((p.x - min.x) * fx) * 131072 + Math.round((p.y - min.y) * fy)) * 131072 + Math.round((p.z - min.z) * fz);
      const other = firstAt.get(key);
      if (other === undefined) firstAt.set(key, t);
      else {
        const a = find(t), b = find(other);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const piece = new Int32Array(tris);
  const ids = new Map();
  for (let t = 0; t < tris; t++) {
    const r = find(t);
    if (!ids.has(r)) ids.set(r, ids.size);
    piece[t] = ids.get(r);
  }
  return { piece, count: ids.size };
}
