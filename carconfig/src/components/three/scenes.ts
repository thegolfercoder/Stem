/**
 * Places to stand the car. "studio" is the generated light-former room in Studio.tsx;
 * the rest are real HDR photographs of light from Poly Haven (CC0), which is
 * what paint actually reflects in the world. The outdoor ones are projected
 * onto the ground, so the car stands on the road in the picture rather than
 * floating in front of it.
 */
export type SceneName = "studio" | "photo" | "road" | "sunset" | "night";

export const SCENES: readonly { name: SceneName; label: string }[] = [
  { name: "studio", label: "Studio" },
  { name: "photo", label: "Photo studio" },
  { name: "road", label: "Country road" },
  { name: "sunset", label: "Sunset" },
  { name: "night", label: "Night city" },
];
