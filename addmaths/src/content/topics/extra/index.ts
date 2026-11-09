import type { TopicExtra } from "@/lib/types";
import { indicesAndSurdsExtra } from "./indices-and-surds";
import { functionsExtra } from "./functions";
import { quadraticFunctionsExtra } from "./quadratic-functions";
import { factorsOfPolynomialsExtra } from "./factors-of-polynomials";

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
};
