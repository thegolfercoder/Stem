-- Vehicle + aftermarket parts compatibility database.
--
-- This file is the long-term source of truth for the data model. The MVP reads
-- the same shapes through src/lib/catalog, which is currently backed by seed
-- modules rather than a live database - the repository interface exists so that
-- swapping in a Postgres adapter is one file, not a rewrite.
--
-- Two things are deliberate and should survive any later refactor:
--
--  1. Provenance is columns on the row, not a comment. Every table holding a
--     factual claim about a car or a part carries source, source_url,
--     verification and verified_on. A row with verification = 'demo' is demo
--     data and the UI is expected to say so.
--  2. Fitment is its own table with its own provenance. Whether a wheel fits a
--     car is a claim about the world, separate from the wheel's own dimensions,
--     and it is wrong far more often. It gets its own confidence.

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared enumerations
-- ---------------------------------------------------------------------------

-- How much a given row can be trusted.
--   verified   - checked against a primary source (manufacturer spec, TÜV
--                certificate, the part maker's own fitment guide)
--   unverified - plausible and sourced, but nobody has confirmed it
--   estimated  - produced by a model or calculation, not observed
--   demo       - placeholder for development. Never show as fact.
CREATE TYPE verification_level AS ENUM ('verified', 'unverified', 'estimated', 'demo');

CREATE TYPE drivetrain AS ENUM ('fwd', 'rwd', 'awd');

CREATE TYPE compatibility_status AS ENUM (
  'compatible',
  'requires_modification',
  'incompatible',
  'unknown'
);

-- ---------------------------------------------------------------------------
-- Vehicle hierarchy: manufacturer > model > generation > trim
--
-- Engines are separate from trims because one engine appears in many trims and
-- one trim can be offered with several engines. vehicles is the join that
-- names a concrete buildable car, and it is what the rest of the schema points
-- at - nothing outside this section should reference a trim directly.
-- ---------------------------------------------------------------------------

CREATE TABLE manufacturers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  country       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE models (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id uuid NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  slug            text NOT NULL,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manufacturer_id, slug)
);

CREATE TABLE generations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  code        text NOT NULL,              -- 'G80', 'ZN6', '992.1'
  year_start  smallint NOT NULL,
  year_end    smallint,                   -- null while still in production
  body_style  text,
  UNIQUE (model_id, slug),
  CHECK (year_end IS NULL OR year_end >= year_start)
);

CREATE TABLE engines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  code              text NOT NULL,        -- 'S58B30T0'
  display_name      text NOT NULL,
  displacement_cc   integer,
  cylinders         smallint,
  aspiration        text,                 -- 'naturally_aspirated' | 'turbo' | ...
  fuel              text,

  source            text,
  source_url        text,
  verification      verification_level NOT NULL DEFAULT 'unverified',
  verified_on       date,
  CHECK (displacement_cc IS NULL OR displacement_cc > 0)
);

CREATE TABLE trims (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  name          text NOT NULL,            -- 'Competition xDrive'
  UNIQUE (generation_id, slug)
);

-- A concrete, buildable car: this trim, this engine, this model year.
CREATE TABLE vehicles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  trim_id       uuid NOT NULL REFERENCES trims(id) ON DELETE CASCADE,
  engine_id     uuid NOT NULL REFERENCES engines(id),
  year          smallint NOT NULL,
  drivetrain    drivetrain NOT NULL,

  -- Stock figures. Units are in the column name so nobody has to guess.
  stock_power_hp        integer,
  stock_torque_nm       integer,
  stock_weight_kg       integer,

  -- The 3D placeholder body this car is drawn with. Swapping in a real asset
  -- later means changing this string, not the viewer.
  body_profile  text NOT NULL DEFAULT 'coupe',

  source        text,
  source_url    text,
  verification  verification_level NOT NULL DEFAULT 'unverified',
  verified_on   date,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (trim_id, engine_id, year),
  CHECK (stock_power_hp  IS NULL OR stock_power_hp  > 0),
  CHECK (stock_torque_nm IS NULL OR stock_torque_nm > 0),
  CHECK (stock_weight_kg IS NULL OR stock_weight_kg > 0)
);

CREATE INDEX vehicles_trim_idx ON vehicles (trim_id);

-- ---------------------------------------------------------------------------
-- What the car came with, and what it can accept.
--
-- Split front/rear because staggered fitments are normal on the cars this
-- product is for, and a schema that assumes one corner spec cannot describe an
-- M3 without lying.
-- ---------------------------------------------------------------------------

CREATE TABLE vehicle_wheel_specs (
  vehicle_id        uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  axle              text NOT NULL CHECK (axle IN ('front', 'rear')),

  bolt_count        smallint NOT NULL,
  bolt_circle_mm    numeric(5,1) NOT NULL,   -- 112.0 in 5x112
  center_bore_mm    numeric(5,1) NOT NULL,
  diameter_in       numeric(4,1) NOT NULL,
  width_in          numeric(4,1) NOT NULL,
  offset_mm         smallint NOT NULL,

  -- The envelope an aftermarket wheel has to live inside. These are the
  -- numbers the compatibility engine reasons about, and they are the ones most
  -- likely to be wrong, so they carry their own provenance below.
  min_offset_mm     smallint,
  max_offset_mm     smallint,
  max_width_in      numeric(4,1),
  min_diameter_in   numeric(4,1),        -- brake clearance floor
  max_diameter_in   numeric(4,1),

  tire_width_mm     smallint NOT NULL,
  tire_aspect       smallint NOT NULL,
  tire_diameter_in  numeric(4,1) NOT NULL,

  source            text,
  source_url        text,
  verification      verification_level NOT NULL DEFAULT 'unverified',
  verified_on       date,

  PRIMARY KEY (vehicle_id, axle),
  CHECK (min_offset_mm IS NULL OR max_offset_mm IS NULL OR min_offset_mm <= max_offset_mm)
);

CREATE TABLE vehicle_brake_specs (
  vehicle_id          uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  axle                text NOT NULL CHECK (axle IN ('front', 'rear')),

  rotor_diameter_mm   numeric(5,1) NOT NULL,
  rotor_thickness_mm  numeric(4,1),
  caliper_pistons     smallint,
  caliper_description text,

  source              text,
  source_url          text,
  verification        verification_level NOT NULL DEFAULT 'unverified',
  verified_on         date,

  PRIMARY KEY (vehicle_id, axle)
);

-- Platform-level traits a rule may need that are not a single measurement:
-- 'strut_front', 'multilink_rear', 'electronic_dampers', 'air_suspension'.
-- Keeping these as rows rather than boolean columns means adding a new trait
-- does not need a migration on a table with millions of rows in it.
CREATE TABLE vehicle_traits (
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  trait       text NOT NULL,
  PRIMARY KEY (vehicle_id, trait)
);

-- ---------------------------------------------------------------------------
-- Parts
--
-- Category-specific measurements live in the JSONB spec column rather than in
-- a table per category. That is a considered trade-off: the categories this
-- product will add over time (turbos, cages, seats, lighting) each have their
-- own dimensions, and forty sparse tables is worse than one validated document
-- per part. The columns every part has - price, brand, category - are real
-- columns and are what gets indexed and filtered on.
-- ---------------------------------------------------------------------------

CREATE TABLE part_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,     -- 'wheels', 'tires', 'suspension'
  name          text NOT NULL,
  parent_id     uuid REFERENCES part_categories(id) ON DELETE SET NULL,
  sort_order    smallint NOT NULL DEFAULT 0,
  -- Whether picking a part in this category replaces the previous pick
  -- (wheels) or adds to it (exterior). The configurator reads this rather
  -- than hardcoding a list of category names.
  single_select boolean NOT NULL DEFAULT true
);

CREATE TABLE brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  website_url text
);

CREATE TABLE parts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  category_id     uuid NOT NULL REFERENCES part_categories(id),
  brand_id        uuid NOT NULL REFERENCES brands(id),
  name            text NOT NULL,
  part_number     text,
  description     text,

  -- Money in minor units (cents). Never floats.
  price_cents           integer,
  install_cost_cents    integer,
  currency              char(3) NOT NULL DEFAULT 'USD',
  -- Prices go stale faster than anything else here, so they carry their own
  -- verification separate from the part's specs. 'demo' means invented for
  -- development and the UI must label it.
  price_verification    verification_level NOT NULL DEFAULT 'demo',
  price_checked_on      date,

  -- Category-specific measurements, validated in the application layer against
  -- a Zod schema chosen by category. See src/types/part.ts.
  spec            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- How this part changes the car in the 3D viewer, if at all.
  visual          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Claimed effect on the car's numbers. Claimed by the maker, which is not
  -- the same as measured, which is why the performance panel labels every
  -- modified figure an estimate.
  power_delta_hp        integer,
  torque_delta_nm       integer,
  weight_delta_kg       numeric(6,2),

  source          text,
  source_url      text,
  verification    verification_level NOT NULL DEFAULT 'unverified',
  verified_on     date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX parts_category_idx ON parts (category_id);
CREATE INDEX parts_brand_idx    ON parts (brand_id);
CREATE INDEX parts_spec_idx     ON parts USING gin (spec);

-- Explicit fitment: the maker says this part fits this car.
--
-- Absence of a row here is not evidence of anything. The compatibility engine
-- treats "no fitment record" as unknown, never as compatible, and this table
-- is the only place an explicit 'verified' fitment claim can come from.
CREATE TABLE vehicle_parts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  part_id       uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  status        compatibility_status NOT NULL,
  note          text,                      -- 'requires 10mm spacer'

  source        text,
  source_url    text,
  verification  verification_level NOT NULL DEFAULT 'unverified',
  verified_on   date,

  UNIQUE (vehicle_id, part_id)
);

CREATE INDEX vehicle_parts_vehicle_idx ON vehicle_parts (vehicle_id);
CREATE INDEX vehicle_parts_part_idx    ON vehicle_parts (part_id);

-- Rules evaluated when there is no explicit fitment record - and, for the
-- hard-physical ones like bolt pattern, even when there is.
--
-- The rule logic itself is code (src/lib/compatibility/rules), because it needs
-- to be unit-tested and stepped through in a debugger. This table holds rule
-- parameters and scope, so that a rule can be tightened for one platform
-- without a deploy.
CREATE TABLE compatibility_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key      text NOT NULL,             -- matches a registered rule in code
  -- Scope: null means the rule applies everywhere. Narrower scopes win.
  category_id   uuid REFERENCES part_categories(id) ON DELETE CASCADE,
  vehicle_id    uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  generation_id uuid REFERENCES generations(id) ON DELETE CASCADE,
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  UNIQUE (rule_key, category_id, vehicle_id, generation_id)
);

-- ---------------------------------------------------------------------------
-- Users and builds
--
-- users exists now and is referenced now, so that adding authentication later
-- is a matter of populating it rather than migrating every build row. Builds
-- with a null owner are anonymous - which is every build in the MVP.
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Mirrors auth.users(id) when Supabase Auth is added; unique but not a FK
  -- so this schema stands alone.
  auth_user_id  uuid UNIQUE,
  handle        text UNIQUE,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE builds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short, URL-safe, non-sequential. Sequential ids would let anyone walk
  -- every build in the database by counting.
  share_code    text NOT NULL UNIQUE,
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id),
  name          text NOT NULL,
  paint_color   text,
  is_public     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX builds_owner_idx ON builds (owner_id);

CREATE TABLE build_parts (
  build_id    uuid NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  part_id     uuid NOT NULL REFERENCES parts(id),
  quantity    smallint NOT NULL DEFAULT 1,
  -- The price when the build was saved. A build's total must not silently
  -- change because a retailer moved a price two years later.
  price_cents_at_save        integer,
  install_cost_cents_at_save integer,
  PRIMARY KEY (build_id, part_id),
  CHECK (quantity > 0)
);

COMMIT;
