// Reading what a model's parts are called. Modellers name things in many
// languages and styles ("LeftFrontTyre", "pneu_av_g", "Cerchio.001"), so names
// are split into lower-case words before anything is matched against them.

export const nameWords = (s) =>
  String(s || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[_.\-:/|()[\]]+/g, " ")
    .toLowerCase();

export const materialsOf = (mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/** Every name from a mesh up to the model root, plus its material names. */
export function label(o) {
  const names = [];
  for (let p = o; p; p = p.parent) if (p.name) names.push(nameWords(p.name));
  return `${names.join(" ")} ${materialsOf(o).map((m) => nameWords(m?.name)).join(" ")}`;
}

/** Just the node names, without materials. */
export function nodeLabel(o) {
  const names = [];
  for (let p = o; p; p = p.parent) if (p.name) names.push(nameWords(p.name));
  return names.join(" ");
}

const LAMP_WORDS = "head ?lights?|tail ?lights?|lamps?|lights?|indicators?|blinkers?|phares?|feux|faros?|fanali|luce|luz|scheinwerfer|leuchten?";

/** Surface kinds recognisable from a material's name alone. Order matters. */
export const KINDS = [
  ["lens", new RegExp(`\\b(${LAMP_WORDS}) ?(glass|lens|cover|vitre|verre|vetro|vidrio|glas)|\\blens(es)?\\b`)],
  ["glass", /\b(glass|windows?|windscreen|windshield|backlight|vitres?|verre|vetro|vetri\w*|vidrios?|cristal(es)?|glas|scheiben?|ventanas?|finestrini)\b/],
  ["tyre", /\b(tyres?|tires?|rubber|tread|sidewall|pneus?|pneumatici|gomma|gomme|goma|neumaticos?|reifen)\b/],
  ["carbon", /\b(carbon|cfrp|carbone|carbono)\b/],
  ["chrome", /\b(chrome|chromed|polished|chromo|cromo|cromato|chrom)\b/],
  ["plastic", /\b(plastic|trim ?black|black ?trim|textured|matte ?black|grille|grill|plastique|plastica|plastico|kunststoff)\b/],
];

export function kindOf(name) {
  const w = nameWords(name);
  for (const [k, re] of KINDS) if (re.test(w)) return k;
  return null;
}

export const PAINT_WORDS = /\b(paint\w*|car ?paint|body ?colou?r|body|bodywork|exterior|shell|coat|clear ?coat|livery|carrozzeria|carroceria|carrocera|carrosserie|karosserie|lack|vernice|pintura|peinture|livrea|verniz)\b/;
export const OTHER_WORDS = new RegExp(
  "\\b(" +
    [
      "glass\\w*", "windows?", "windshield", "windscreen", "lights?", "lamps?", "lens", "vetro", "vidrio", "verre", "glas", "vitre", "phares?", "feux", "faro", "luce", "luz", "licht", "scheinwerfer",
      "tires?", "tyres?", "rubber", "rims?", "wheels?", "brakes?", "calipers?", "discs?", "rotors?", "gomma", "goma", "pneu\\w*", "reifen", "cerchi\\w*", "llantas?", "jantes?", "felgen?", "ruota", "rueda", "roues?", "rad",
      "interior", "interni", "interieur", "innen\\w*", "inside", "inner", "inter", "int", "seats?", "chair", "sedile", "asiento", "siege", "sitz", "dash\\w*", "screen", "steering", "volante", "lenkrad", "leather", "fabric", "cloth", "carpet", "headliner", "cockpit", "cabin", "console",
      "chrome", "chromo", "cromo", "cromato", "chrom", "mirrors?", "logo", "badges?", "emblem", "plates?", "licen[cs]e", "targa", "placa", "plaque", "kennzeichen", "grill", "grille", "carbon", "plastic", "plastica", "plastique", "kunststoff", "wipers?", "engine", "motor", "exhaust",
      "under\\w*", "chassis", "floor", "bottom", "dessous", "suelo", "boden", "ground", "shadow", "backdrop", "stage", "platform",
    ].join("|") +
    ")\\b",
);

export function paintNameSays(name) {
  const w = nameWords(name);
  if (OTHER_WORDS.test(w)) return "other";
  if (PAINT_WORDS.test(w)) return "paint";
  return null;
}

export const LAMP_RE = /\b(head ?lights?|head ?lamps?|headlamps?|tail ?lights?|tail ?lamps?|taillamps?|brake ?lights?|drl|leds?|lights?|lamps?|phares?|faros?|feux|fanali|scheinwerfer|licht|leuchten?|indicators?|blinkers?)\b/;
export const REAR_LAMP_RE = /\b(tail|rear|back|brake|stop|reverse|arriere|posteriore|trasero|heck|rueck|ruck)\b/;
export const LAMP_EXCLUDE_RE = /\b(interior|inside|cabin|dash\w*|ceiling|dome|switch|button|screen)\b/;

export const WHEEL_RE = /\b(wheels?|rims?|tyres?|tires?|brakes?|calipers?|callipers?|discs?|disks?|rotors?|lugs?|hubs?|spokes?|rueda|roue|ruota|llanta|jante|felgen?|reifen|gomma|pneu\w*|cerchi\w*)\b/;
export const WHEEL_EXCLUDE_RE = /\b(steering|spare|light|lamp|arch|well|house|housing|wheelhouse|liner|fender|volante|lenkrad)\b/;

export const PART = {
  caliper: /\b(calipers?|callipers?|brake ?calipers?|bremssattel|etriers?|pinzas?|pinze|pinza)\b/,
  disc: /\b(discs?|disks?|rotors?|brake ?discs?|brake ?disks?|bremsscheiben?|disques?|dischi|discos?)\b/,
  rim: /\b(rims?|wheels?|alloys?|spokes?|felgen?|jantes?|llantas?|cerchi\w*|cerchione|ruota|rueda|roues?)\b/,
  tyre: /\b(tyres?|tires?|rubber|tread|sidewall|pneus?|pneumatici|gomma|gomme|goma|neumaticos?|reifen)\b/,
  lug: /\b(lugs?|nuts?|bolts?|screws?|valves?|caps?|center ?caps?|centre ?caps?|logo|badges?|emblem)\b/,
  mirror: /\b(mirrors?|wing ?mirrors?|side ?mirrors?|spiegel\w*|retro\w*|espejos?|specchi\w*)\b/,
  mirrorGlass: /\b(mirror ?glass|reflect\w*|mirror ?surface|spiegelglas)\b/,
  spoiler: /\b(spoiler|rear ?wing|wing|aileron|alettone|heckfl\w*|ducktail)\b/,
  spoilerExclude: /\b(mirrors?|front|fender|door|wing ?mirror|splitter)\b/,
  exhaust: /\b(exhausts?|tail ?pipes?|tailpipes?|mufflers?|silencers?|exhaust ?tips?|scarico|auspuff\w*|echappement)\b/,
  trim: /\b(trim|chrome|chromed|chromo|cromo|cromato|chrom|window ?surround|beltline)\b/,
  badge: /\b(logo|badges?|emblem|lettering|plates?|licen[cs]e|kennzeichen|targa)\b/,
};
