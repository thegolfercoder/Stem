// Key, fill and rim: three directional lights that shape the car on top of
// the environment's reflections. They cast no shadow maps; the contact
// shadow under the car and ambient occlusion do that job without the
// acne and peter-panning shadow maps give on downloaded meshes.
import * as THREE from "three";

const deg = THREE.MathUtils.degToRad;

export class StudioLights {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = "studio lights";
    this.key = new THREE.DirectionalLight();
    this.fill = new THREE.DirectionalLight();
    this.rim = new THREE.DirectionalLight();
    for (const l of [this.key, this.fill, this.rim]) {
      l.target.position.set(0, 0.5, 0);
      this.group.add(l, l.target);
    }
    scene.add(this.group);
  }

  /** @param preset STUDIOS[id].lights  @param radius the car's bounding radius */
  apply(preset, radius = 3) {
    for (const name of ["key", "fill", "rim"]) {
      const [[azimuth, elevation], intensity, color] = preset[name];
      const l = this[name];
      l.position.setFromSphericalCoords(radius * 4, Math.PI / 2 - deg(elevation), deg(azimuth));
      l.intensity = intensity;
      l.color.set(color);
    }
  }
}
