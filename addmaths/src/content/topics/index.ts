import type { Topic } from "@/lib/types";
import { functions } from "./functions";
import { quadraticFunctions } from "./quadratic-functions";
import { factorsOfPolynomials } from "./factors-of-polynomials";
import { equationsInequalitiesGraphs } from "./equations-inequalities-graphs";
import { simultaneousEquations } from "./simultaneous-equations";
import { indicesAndSurds } from "./indices-and-surds";
import { logarithmsExponentials } from "./logarithms-exponentials";
import { straightLineGraphs } from "./straight-line-graphs";
import { circles } from "./circles";
import { circularMeasure } from "./circular-measure";
import { trigonometricFunctions } from "./trigonometric-functions";
import { trigonometricIdentities } from "./trigonometric-identities";
import { trigonometricEquations } from "./trigonometric-equations";
import { permutationsCombinations } from "./permutations-combinations";
import { binomialExpansion } from "./binomial-expansion";
import { progressions } from "./progressions";
import { vectors } from "./vectors";
import { differentiation } from "./differentiation";
import { applicationsOfDifferentiation } from "./applications-of-differentiation";
import { integration } from "./integration";
import { applicationsOfIntegration } from "./applications-of-integration";
import { kinematics } from "./kinematics";

/**
 * The course, in teaching order.
 *
 * Several Cambridge units are split into more than one site topic — unit 10
 * (Trigonometry) becomes three pages and unit 14 (Calculus) becomes five —
 * because a single page covering all of unit 14 would be unusable. Each topic
 * records its `unit`, so the syllabus audit can prove that every one of the 14
 * official units and all of their objectives are covered.
 *
 * Indices and surds carries unit 0: Cambridge assumes it from IGCSE
 * Mathematics rather than testing it directly, but the papers lean on it
 * constantly, so it is taught here first.
 */
export const TOPICS: Topic[] = [
  indicesAndSurds,
  functions,
  quadraticFunctions,
  factorsOfPolynomials,
  equationsInequalitiesGraphs,
  simultaneousEquations,
  logarithmsExponentials,
  straightLineGraphs,
  circles,
  circularMeasure,
  trigonometricFunctions,
  trigonometricIdentities,
  trigonometricEquations,
  permutationsCombinations,
  binomialExpansion,
  progressions,
  vectors,
  differentiation,
  applicationsOfDifferentiation,
  integration,
  applicationsOfIntegration,
  kinematics,
];

export const TOPIC_BY_SLUG: Map<string, Topic> = new Map(TOPICS.map((t) => [t.slug, t]));

export function getTopic(slug: string): Topic | undefined {
  return TOPIC_BY_SLUG.get(slug);
}
