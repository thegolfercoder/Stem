"use client";

import type { ReactNode } from "react";
import {
  CALIPER_COLOURS,
  PAINT_PRESETS,
  RIDE_HEIGHT_RANGE,
  WHEEL_FINISHES,
  type GlassTint,
  type PaintFinish,
  type StripeStyle,
} from "@/lib/build/appearance";
import type { Attachment, SpokeStyle } from "@/lib/build/viewer-config";
import type { ModelInfo } from "@/components/three/car/RealCar";
import type { ConfiguratorState } from "./useConfigurator";

/**
 * Direct visual customisation: the car's look, without going through the
 * parts catalogue. Every control writes to the build's appearance, which
 * the viewer applies on top of whatever the parts did, and which travels in
 * the share link.
 */

const FINISHES: readonly { value: PaintFinish; label: string }[] = [
  { value: "gloss", label: "Gloss" },
  { value: "metallic", label: "Metallic" },
  { value: "pearl", label: "Pearl" },
  { value: "satin", label: "Satin" },
  { value: "matte", label: "Matte" },
  { value: "chrome", label: "Chrome" },
];

const WHEEL_STYLES: readonly { value: SpokeStyle; label: string }[] = [
  { value: "five_spoke", label: "Five-spoke" },
  { value: "twin_five_spoke", label: "Twin five" },
  { value: "split_spoke", label: "Split spoke" },
  { value: "mesh", label: "Mesh" },
  { value: "ten_spoke", label: "Ten-spoke" },
  { value: "y_spoke", label: "Y-spoke" },
  { value: "multi_spoke", label: "Multi-spoke" },
  { value: "deep_dish", label: "Deep dish" },
];

const AERO: readonly { value: Attachment; label: string }[] = [
  { value: "wing", label: "Wing" },
  { value: "spoiler", label: "Ducktail" },
  { value: "splitter", label: "Splitter" },
  { value: "diffuser", label: "Diffuser" },
  { value: "side_skirts", label: "Side skirts" },
];

const TINTS: readonly { value: GlassTint; label: string }[] = [
  { value: "clear", label: "Clear" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "limo", label: "Limo" },
];

const STRIPES: readonly { value: StripeStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "twin", label: "Twin" },
  { value: "single", label: "Centre" },
  { value: "side", label: "Side" },
];

export function CustomisePanel({ state, modelInfo }: { state: ConfiguratorState; modelInfo?: ModelInfo | null }) {
  const { appearance: a, setAppearance, viewerConfig: cfg } = state;
  // A real 3D model keeps its own paint and wheels until something else is
  // chosen, so it offers "Factory" and "Stock" as the first choices. Stripes
  // need a known surface to lie on, which only the generated body has.
  const realModel = cfg.asset !== null;
  const info = realModel ? (modelInfo ?? null) : null;
  const paintOn = !realModel || cfg.paintChosen;
  const wheelsOn = !realModel || cfg.wheelsChosen;
  const calipersOn = !realModel || cfg.caliperChosen;

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <Section
        title="Paint"
        note={
          info?.paint === "none"
            ? "This model is drawn with one material for everything, so its paint can't be separated from the glass and tyres to change it."
            : undefined
        }
      >
        <div className="grid grid-cols-6 gap-1.5">
          {realModel ? (
            <button
              type="button"
              title="The model's own paint"
              aria-label="Factory paint"
              aria-pressed={!cfg.paintChosen}
              onClick={() => setAppearance({ paintHex: undefined, paintFinish: undefined })}
              className={`flex aspect-square items-center justify-center rounded-full border-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-ink-dim)] transition-transform hover:scale-110 ${
                !cfg.paintChosen ? "border-[var(--color-accent)]" : "border-[var(--color-line-bright)]"
              }`}
              style={{ background: "conic-gradient(from 200deg, #3a3f46, #9aa1a8, #3a3f46, #1c1f24, #3a3f46)" }}
            >
              <span className="rounded bg-black/55 px-1">Fac</span>
            </button>
          ) : null}
          {PAINT_PRESETS.map((p) => {
            const on = paintOn && cfg.paintHex.toLowerCase() === p.hex && cfg.paintFinish === p.finish;
            return (
              <button
                key={p.name}
                type="button"
                title={`${p.name} · ${p.finish}`}
                aria-label={`${p.name}, ${p.finish}`}
                aria-pressed={on}
                disabled={info?.paint === "none"}
                onClick={() => setAppearance({ paintHex: p.hex, paintFinish: p.finish })}
                className={`aspect-square rounded-full border-2 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 ${
                  on ? "border-[var(--color-accent)]" : "border-[var(--color-line-bright)]"
                }`}
                style={{ background: swatchBackground(p.hex, p.finish) }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ColourInput
            label="Custom paint colour"
            value={cfg.paintHex}
            onChange={(hex) => setAppearance({ paintHex: hex })}
          />
          <Chips
            options={FINISHES}
            value={paintOn ? cfg.paintFinish : null}
            onChange={(v) => setAppearance({ paintFinish: v, paintHex: cfg.paintHex })}
          />
        </div>
      </Section>

      <Section
        title="Wheels"
        note={
          info && !info.wheels
            ? "This model's wheels are part of its body, so wheel designs, calipers and ride height can't be shown on it."
            : undefined
        }
      >
        <div className="flex flex-wrap gap-1">
          {realModel ? (
            <button
              type="button"
              aria-pressed={!cfg.wheelsChosen}
              onClick={() => setAppearance({ wheelStyle: undefined, wheelFinishHex: undefined })}
              className={chipClass(!cfg.wheelsChosen)}
            >
              Stock
            </button>
          ) : null}
          {WHEEL_STYLES.map((o) => {
            const on = wheelsOn && cfg.wheelStyle === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => setAppearance({ wheelStyle: o.value })}
                className={chipClass(on)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <Swatches
          colours={WHEEL_FINISHES}
          value={cfg.wheelFinishHex}
          selected={wheelsOn}
          onChange={(hex) => setAppearance({ wheelFinishHex: hex, wheelStyle: cfg.wheelStyle })}
          label="Wheel finish"
        />
      </Section>

      <Section
        title="Calipers"
        note={
          info?.wheels && !info.calipers && !cfg.wheelsChosen
            ? "This model's own calipers can't be recoloured, so choosing a colour fits the build's wheels."
            : undefined
        }
      >
        <Swatches
          colours={CALIPER_COLOURS}
          value={cfg.caliperHex}
          selected={calipersOn}
          onChange={(hex) => setAppearance({ caliperHex: hex })}
          label="Caliper colour"
        />
      </Section>

      <Section title="Glass & lights">
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] text-[var(--color-ink-dim)]">Tint</span>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              aria-pressed={!cfg.tint}
              onClick={() => setAppearance({ tint: undefined })}
              className={chipClass(!cfg.tint)}
            >
              Stock
            </button>
            {TINTS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={cfg.tint === o.value}
                onClick={() => setAppearance({ tint: o.value })}
                className={chipClass(cfg.tint === o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] text-[var(--color-ink-dim)]">Lights</span>
          <div className="flex flex-wrap gap-1">
            {(
              [
                [false, "Off"],
                [true, "On"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={cfg.lights === value}
                onClick={() => setAppearance({ lights: cfg.lights === value ? undefined : value })}
                className={chipClass(cfg.lights === value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Stance">
        <label className="block text-[11px] text-[var(--color-ink-dim)]">
          Ride height{" "}
          <span className="tabular-nums text-[var(--color-ink)]">
            {(a.rideHeightMm ?? 0) > 0 ? "+" : ""}
            {a.rideHeightMm ?? 0}mm
          </span>
          <input
            type="range"
            min={RIDE_HEIGHT_RANGE[0]}
            max={RIDE_HEIGHT_RANGE[1]}
            step={5}
            value={a.rideHeightMm ?? 0}
            onChange={(e) => setAppearance({ rideHeightMm: Number(e.target.value) || undefined })}
            className="mt-1 w-full accent-[var(--color-accent)]"
          />
        </label>
        <p className="mt-1 text-[10px] text-[var(--color-ink-faint)]">
          On top of any suspension in the build. A look, not a fitment check.
        </p>
      </Section>

      <Section title="Body" note={realModel ? "Stripes show on generated bodies only; this car uses a 3D model." : undefined}>
        <div className="flex flex-wrap gap-1">
          {AERO.map((o) => {
            const on = (a.aero ?? []).includes(o.value) || cfg.attachments.includes(o.value);
            const fromPart = !(a.aero ?? []).includes(o.value) && cfg.attachments.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={fromPart}
                title={fromPart ? "Fitted by a part in the build" : undefined}
                onClick={() => {
                  const current = a.aero ?? [];
                  setAppearance({
                    aero: current.includes(o.value) ? current.filter((x) => x !== o.value) : [...current, o.value],
                  });
                }}
                className={chipClass(on)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] text-[var(--color-ink-dim)]">Stripes</span>
          <Chips options={STRIPES} value={cfg.stripe} onChange={(v) => setAppearance({ stripe: v })} />
          {cfg.stripe !== "none" ? (
            <ColourInput label="Stripe colour" value={cfg.stripeHex} onChange={(hex) => setAppearance({ stripeHex: hex })} />
          ) : null}
        </div>
      </Section>

      <button
        type="button"
        onClick={state.resetAppearance}
        className="mt-1 text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
      >
        Reset look
      </button>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mb-4 border-b border-[var(--color-line)] pb-4 last-of-type:border-0">
      <h3 className="mb-2 text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">{title}</h3>
      {children}
      {note ? <p className="mt-2 text-[10px] text-[var(--color-ink-faint)]">{note}</p> : null}
    </section>
  );
}

function chipClass(on: boolean) {
  return `rounded border px-2 py-1 text-[11px] transition-colors disabled:cursor-default disabled:opacity-70 ${
    on
      ? "border-[var(--color-accent)]/60 bg-[var(--color-accent-dim)]/60 text-[var(--color-ink)]"
      : "border-[var(--color-line-bright)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
  }`;
}

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={chipClass(value === o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Swatches({
  colours,
  value,
  selected = true,
  onChange,
  label,
}: {
  colours: readonly { name: string; hex: string }[];
  value: string;
  /** False while nothing has been chosen, so no swatch shows as picked. */
  selected?: boolean;
  onChange: (hex: string) => void;
  label: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {colours.map((c) => {
        const on = selected && value.toLowerCase() === c.hex;
        return (
          <button
            key={c.hex}
            type="button"
            title={c.name}
            aria-label={`${label}: ${c.name}`}
            aria-pressed={on}
            onClick={() => onChange(c.hex)}
            className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
              on ? "border-[var(--color-accent)]" : "border-[var(--color-line-bright)]"
            }`}
            style={{ background: c.hex }}
          />
        );
      })}
      <ColourInput label={`Custom ${label.toLowerCase()}`} value={value} onChange={onChange} />
    </div>
  );
}

function ColourInput({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      title={label}
      className="h-6 w-8 shrink-0 cursor-pointer rounded border border-[var(--color-line-bright)] bg-transparent"
    />
  );
}

/** A hint of the finish in the swatch itself. */
function swatchBackground(hex: string, finish: PaintFinish): string {
  if (finish === "metallic" || finish === "pearl" || finish === "chrome") {
    return `radial-gradient(circle at 30% 30%, #ffffff66, ${hex} 45%, ${hex})`;
  }
  if (finish === "matte") return hex;
  return `radial-gradient(circle at 30% 30%, #ffffff33, ${hex} 40%)`;
}
