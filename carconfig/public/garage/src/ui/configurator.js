// The configuration panel. Sections and options are built from what the
// loaded car supports; nothing is shown that the model cannot do.
import { h, $ } from "./dom.js";
import {
  PAINTS, FINISHES, RIM_FINISHES, CALIPERS, TRIMS, CARBON, ACCENTS, EXHAUSTS, TINTS, LIGHTS, RIDES, ENVIRONMENTS, FACTORY,
} from "../config.js";
import { describe, paintText, finishLabel } from "./summary.js";
import { HEX } from "../state/persistence.js";
import { metaLine } from "../cars/catalog.js";

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const presetFor = (hex, finish) => PAINTS.find((p) => p.hex === hex.toLowerCase() && p.finish === finish);

export function mountConfigurator(store, { setBuild, setEnvironment, setTurntable }) {
  const root = $("config");
  const open = new Set(["exterior"]);
  let updaters = [];
  let builtFor = null;

  const build = () => {
    const s = store.get();
    return s.builds[s.vehicleId] ?? FACTORY;
  };

  /** A row of mutually exclusive choices. */
  function chips(label, options, read, write, { dot = false, value = true } = {}) {
    const buttons = options.map((o) =>
      h(
        "button",
        { type: "button", class: "chip", onclick: () => write(o.id) },
        dot && o.hex ? h("span", { class: "dot", style: { "--c": o.hex } }) : null,
        o.label,
      ),
    );
    const out = h("output");
    updaters.push((s) => {
      const cur = read(s);
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(options[i].id === cur)));
      if (value) out.textContent = options.find((o) => o.id === cur)?.label ?? "";
    });
    return h("div", { role: "group", "aria-label": label }, h("div", { class: "group-label" }, h("span", {}, label), out), h("div", { class: "chips" }, buttons));
  }

  function section(id, title, value, ...body) {
    const valueEl = h("span", { class: "section-value" });
    updaters.push((s) => (valueEl.textContent = value(s)));
    const d = h(
      "details",
      { class: "section", open: open.has(id) },
      h("summary", {}, h("span", { class: "section-title" }, title), valueEl),
      h("div", { class: "section-body" }, body),
    );
    d.addEventListener("toggle", () => (d.open ? open.add(id) : open.delete(id)));
    return d;
  }

  const set = (patch) => setBuild({ ...build(), ...patch });

  function paintBlock(caps) {
    const choose = (paint) => set({ paint });
    const swatches = [
      h("button", { type: "button", class: "swatch", dataset: { finish: "factory" }, title: "Factory paint", "aria-label": "Factory paint", onclick: () => choose(null) }),
      ...PAINTS.map((p) =>
        h("button", {
          type: "button",
          class: "swatch",
          style: { "--c": p.hex },
          dataset: { finish: p.finish, id: p.id },
          title: `${p.name} · ${finishLabel(p.finish)}`,
          "aria-label": `${p.name}, ${finishLabel(p.finish)}`,
          onclick: () => choose({ hex: p.hex, finish: p.finish, name: p.name }),
        }),
      ),
    ];
    const name = h("strong");
    const finishText = h("span");

    // Finish applies to whatever colour is showing, the factory one included.
    const finishChips = chips(
      "Finish",
      FINISHES,
      (s) => (s.builds[s.vehicleId] ?? FACTORY).paint?.finish ?? null,
      (finish) => {
        const cur = build().paint;
        const hex = cur?.hex ?? caps.factoryHex ?? "#808080";
        const preset = presetFor(hex, finish);
        set({ paint: { hex, finish, name: preset?.name ?? "Custom" } });
      },
      { value: false },
    );

    // Custom colour: picker, HEX and RGB, all kept in step.
    const picker = h("input", { type: "color", "aria-label": "Custom colour" });
    const hexIn = h("input", { type: "text", inputmode: "text", maxlength: "7", spellcheck: "false", autocomplete: "off", "aria-label": "HEX" });
    const rgbIns = ["R", "G", "B"].map((c) => h("input", { type: "number", min: "0", max: "255", step: "1", inputmode: "numeric", "aria-label": c }));
    const custom = (hex) => {
      const cur = build().paint;
      const finish = cur?.finish ?? "metallic";
      const preset = presetFor(hex, finish);
      set({ paint: { hex: hex.toLowerCase(), finish, name: preset?.name ?? "Custom" } });
    };
    picker.addEventListener("input", () => custom(picker.value));
    hexIn.addEventListener("change", () => {
      let v = hexIn.value.trim();
      if (!v.startsWith("#")) v = `#${v}`;
      if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${[...v.slice(1)].map((c) => c + c).join("")}`;
      const ok = HEX.test(v);
      hexIn.setAttribute("aria-invalid", String(!ok));
      if (ok) custom(v);
    });
    rgbIns.forEach((input) =>
      input.addEventListener("change", () => {
        const rgb = rgbIns.map((i) => Number(i.value) || 0);
        custom(rgbToHex(rgb));
      }),
    );

    updaters.push((s) => {
      const p = (s.builds[s.vehicleId] ?? FACTORY).paint;
      swatches[0].setAttribute("aria-pressed", String(!p));
      swatches.slice(1).forEach((b, i) => b.setAttribute("aria-pressed", String(Boolean(p && PAINTS[i].hex === p.hex && PAINTS[i].finish === p.finish))));
      name.textContent = p ? p.name : "Factory";
      finishText.textContent = p ? finishLabel(p.finish) : "As built";
      const hex = p?.hex ?? caps.factoryHex ?? "#808080";
      if (document.activeElement !== hexIn) {
        hexIn.value = hex.toUpperCase();
        hexIn.removeAttribute("aria-invalid");
      }
      picker.value = hex;
      hexToRgb(hex).forEach((v, i) => document.activeElement !== rgbIns[i] && (rgbIns[i].value = v));
    });

    return h(
      "div",
      {},
      h("div", { class: "group-label" }, h("span", {}, "Paint")),
      h("div", { class: "swatches", role: "group", "aria-label": "Paint colours" }, swatches),
      h("div", { class: "swatch-name" }, name, finishText),
      finishChips,
      h(
        "div",
        { class: "custom" },
        h("div", { class: "group-label" }, h("span", {}, "Custom colour")),
        h("div", { class: "custom-row" }, picker, h("label", { class: "field" }, h("span", {}, "HEX"), hexIn)),
        h("div", { class: "rgb" }, rgbIns.map((input, i) => h("label", { class: "field" }, h("span", {}, "RGB"[i]), input))),
      ),
    );
  }

  function render(s) {
    const caps = s.caps;
    const entry = s.entry;
    updaters = [];
    if (!caps || !entry) {
      root.replaceChildren();
      builtFor = null;
      return;
    }
    const b = (s2) => s2.builds[s2.vehicleId] ?? FACTORY;
    const rowsText = (keys) => (s2) =>
      describe(b(s2), s2.caps)
        .filter((r) => keys.includes(r.key))
        .map((r) => r.value)
        .join(" · ");
    const sections = [];

    const exterior = [];
    if (caps.paint) exterior.push(paintBlock(caps));
    else exterior.push(h("p", { class: "note" }, "This model's colour is painted into its textures, so it keeps its own paint."));
    if (caps.trim) exterior.push(chips("Exterior trim", TRIMS, (x) => b(x).trim, (id) => set({ trim: id })));
    if (caps.carbon) exterior.push(chips("Carbon parts", CARBON, (x) => b(x).carbon, (id) => set({ carbon: id })));
    if (caps.mirrors) exterior.push(chips("Mirror caps", ACCENTS.filter((o) => !(o.id === "body" && caps.mirrorsArePaint)), (x) => b(x).mirrors, (id) => set({ mirrors: id })));
    if (caps.spoiler) exterior.push(chips("Spoiler", ACCENTS, (x) => b(x).spoiler, (id) => set({ spoiler: id })));
    if (caps.exhaust) exterior.push(chips("Exhaust tips", EXHAUSTS, (x) => b(x).exhaust, (id) => set({ exhaust: id })));
    sections.push(section("exterior", "Exterior", (x) => paintText(b(x).paint), exterior));

    const wheels = [];
    if (caps.rims) wheels.push(chips("Wheel finish", RIM_FINISHES, (x) => b(x).rims, (id) => set({ rims: id }), { dot: true }));
    if (caps.calipers) wheels.push(chips("Brake calipers", CALIPERS, (x) => b(x).calipers, (id) => set({ calipers: id }), { dot: true }));
    if (wheels.length) sections.push(section("wheels", "Wheels", rowsText(["rims", "calipers"]), wheels));

    if (caps.glass) {
      const tints = [{ id: "factory", label: "Factory" }, ...TINTS];
      sections.push(section("glass", "Glass", rowsText(["tint"]), chips("Window tint", tints, (x) => b(x).tint ?? "factory", (id) => set({ tint: id === "factory" ? null : id }))));
    }
    if (caps.lights) sections.push(section("lighting", "Lighting", rowsText(["lights"]), chips("Lamps", LIGHTS, (x) => b(x).lights, (id) => set({ lights: id }))));
    if (caps.ride) {
      const rides = RIDES.map((r) => ({ ...r, label: r.note ? `${r.label} ${r.note}` : r.label }));
      sections.push(section("chassis", "Chassis", rowsText(["ride"]), chips("Ride height", rides, (x) => b(x).ride, (id) => set({ ride: id }))));
    }

    sections.push(
      section(
        "environment",
        "Environment",
        (x) => ENVIRONMENTS.find((e) => e.id === x.environment)?.label ?? "",
        chips("Studio", ENVIRONMENTS, (x) => x.environment, setEnvironment),
        chips("Turntable", [{ id: "off", label: "Off" }, { id: "on", label: "On" }], (x) => (x.turntable ? "on" : "off"), (id) => setTurntable(id === "on")),
      ),
    );

    sections.push(section("vehicle", "Vehicle", (x) => metaLine(x.entry ?? {}), vehicleBlock(s)));
    root.replaceChildren(...sections);
    builtFor = s.caps;
  }

  function vehicleBlock(s) {
    const { entry, info, caps } = s;
    const rows = [];
    const add = (k, v) => v && rows.push(h("dt", {}, k), h("dd", {}, v));
    add("Make", entry.manufacturer);
    add("Model", entry.model);
    add("Generation", entry.generation);
    add("Model year", entry.year && String(entry.year));
    add("Body", entry.bodyStyle);
    add("Category", entry.category);
    add("Engine", entry.specifications?.engine);
    add("Power", entry.specifications?.powerHp && `${entry.specifications.powerHp} hp`);
    const dims = entry.dimensions;
    if (dims?.length) add("Length", `${dims.length.toLocaleString("en-GB")} mm (published)`);
    else if (info) add("Length", `${Math.round(info.measured.length * 1000).toLocaleString("en-GB")} mm (${info.lengthSource === "typical" ? "typical for the body style" : "from the model"})`);
    if (dims?.width) add("Width", `${dims.width.toLocaleString("en-GB")} mm`);
    if (dims?.height) add("Height", `${dims.height.toLocaleString("en-GB")} mm`);
    if (info) add("Mesh", `${info.triangles.toLocaleString("en-GB")} triangles`);

    const missing = [
      !caps.paint && "paint",
      !caps.rims && "wheel finish",
      !caps.calipers && "calipers",
      !caps.glass && "glass tint",
      !caps.lights && "lamps",
      !caps.ride && "ride height",
    ].filter(Boolean);
    const c = entry.credit;
    return [
      h("dl", { class: "specs" }, rows),
      missing.length
        ? h("p", { class: "note" }, `Not offered on this model: ${missing.join(", ")}. `, "The model has no separate part for them, so changing them would mean inventing geometry.")
        : null,
      c
        ? h(
            "p",
            { class: "note" },
            c.own ? "Model built for Carbon Garage in Blender, from published data. " : `3D model “${c.title}” by `,
            !c.own && c.author ? (c.authorUrl ? h("a", { href: c.authorUrl, target: "_blank", rel: "noopener" }, c.author) : c.author) : null,
            !c.own && c.license ? ", " : null,
            c.license ? (c.licenseUrl ? h("a", { href: c.licenseUrl, target: "_blank", rel: "noopener" }, c.license) : c.license) : null,
            c.source && !c.own ? [", ", h("a", { href: c.source, target: "_blank", rel: "noopener" }, "source")] : null,
            ".",
          )
        : null,
    ];
  }

  const update = (s) => {
    if (s.caps !== builtFor) render(s);
    for (const fn of updaters) fn(s);
  };
  update(store.get());
  store.subscribe(update);
}
