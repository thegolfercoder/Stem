import type { TopicExtra } from "@/lib/types";
import { indicesAndSurdsExtra } from "./indices-and-surds";
import { functionsExtra } from "./functions";
import { quadraticFunctionsExtra } from "./quadratic-functions";
import { factorsOfPolynomialsExtra } from "./factors-of-polynomials";
import { equationsInequalitiesGraphsExtra } from "./equations-inequalities-graphs";
import { simultaneousEquationsExtra } from "./simultaneous-equations";
import { logarithmsExponentialsExtra } from "./logarithms-exponentials";
import { straightLineGraphsExtra } from "./straight-line-graphs";
import { circlesExtra } from "./circles";
import { circularMeasureExtra } from "./circular-measure";

/**
 * Additions to each topic, keyed by slug. Each file adds lesson sections,
 * worked examples across all four levels, exam questions with mark schemes,
 * more mistakes and tips, and the one-page summary.
 */
export const EXTRAS: Record<string, TopicExtra> = {
  "indices-and-surds": indicesAndSurdsExtra,
  functions: functionsExtra,
  "quadratic-functions": quadraticFunctionsExtra,
  "factors-of-polynomials": factorsOfPolynomialsExtra,
  "equations-inequalities-graphs": equationsInequalitiesGraphsExtra,
  "simultaneous-equations": simultaneousEquationsExtra,
  "logarithms-exponentials": logarithmsExponentialsExtra,
  "straight-line-graphs": straightLineGraphsExtra,
  circles: circlesExtra,
  "circular-measure": circularMeasureExtra,
};
