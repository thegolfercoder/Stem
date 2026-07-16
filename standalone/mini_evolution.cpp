// A mini, self-contained model of natural selection -- "survival of the fittest".
//
// Standalone teaching model: depends on nothing but the C++ standard library.
// Build and run:
//
//     g++ -O2 -o mini_evolution mini_evolution.cpp && ./mini_evolution
//
// The idea: every creature has one heritable trait, SPEED. Food is scarce, so a
// faster creature gathers more -- but moving fast burns energy (cost grows with
// speed squared). So there is a single best-adapted speed. Each generation, the
// fittest (most left-over energy) survive and have children that inherit their
// speed plus a small random mutation. A population that starts with random
// speeds converges, on its own, onto the best-adapted speed. That is evolution.
//
// This mirrors mini_evolution.py; the numbers differ slightly because the C++
// random generator differs, but the story is identical.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <random>
#include <vector>

// ---- The world (all the knobs live here) ---------------------------------
static const int    POP_SIZE         = 300;
static const int    GENERATIONS      = 60;
static const double SURVIVE_FRACTION = 0.40;
static const double MUTATION         = 0.18;
static const double SPEED_MIN        = 0.4;
static const double SPEED_MAX        = 4.2;
static const unsigned SEED           = 7;

// Fitness = food gathered - energy burned.
static const double FOOD = 10.0;   // max food a very fast creature could gather
static const double HALF = 1.5;    // speed at which food gathered is half of max
static const double COST = 0.15;   // burned energy = COST * speed^2

// Left-over energy. Benefit saturates, cost keeps rising -> a single best speed.
static double fitness(double speed) {
    double benefit = FOOD * speed / (speed + HALF);
    double cost = COST * speed * speed;
    return benefit - cost;
}

static double clampSpeed(double x) {
    return std::max(SPEED_MIN, std::min(SPEED_MAX, x));
}

static double bestPossibleSpeed() {
    double best = SPEED_MIN, bestF = fitness(SPEED_MIN);
    for (int i = 0; i <= 4000; ++i) {
        double s = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * i / 4000.0;
        if (fitness(s) > bestF) { bestF = fitness(s); best = s; }
    }
    return best;
}

static double mean(const std::vector<double>& v) {
    double s = 0; for (double x : v) s += x; return s / v.size();
}
static double stdev(const std::vector<double>& v) {
    double m = mean(v), s = 0; for (double x : v) s += (x - m) * (x - m);
    return std::sqrt(s / v.size());
}

// A tiny ASCII histogram so the model needs no plotting library.
static void histogram(const std::vector<double>& v, int bins = 24, int width = 40) {
    std::vector<int> counts(bins, 0);
    double span = SPEED_MAX - SPEED_MIN;
    for (double s : v) {
        int i = std::min(bins - 1, (int)((s - SPEED_MIN) / span * bins));
        counts[i]++;
    }
    int peak = 1; for (int c : counts) peak = std::max(peak, c);
    for (int i = 0; i < bins; ++i) {
        double lo = SPEED_MIN + span * i / bins;
        int n = (int)std::lround((double)counts[i] / peak * width);
        printf("  %4.2f | %s\n", lo, std::string(n, '#').c_str());
    }
}

int main() {
    std::mt19937 rng(SEED);
    std::uniform_real_distribution<double> uni(SPEED_MIN, SPEED_MAX);
    std::normal_distribution<double> mut(0.0, MUTATION);

    // Generation 0: totally random speeds -- no design, no plan.
    std::vector<double> pop(POP_SIZE);
    for (double& s : pop) s = uni(rng);
    std::vector<double> firstGen = pop;

    printf("Survival of the Fittest -- a mini model\n");
    printf("==========================================\n");
    printf("population %d, %d generations, top %d%% survive each generation\n\n",
           POP_SIZE, GENERATIONS, (int)(SURVIVE_FRACTION * 100));
    printf("%4s %11s %8s   (spread shrinks as the fit take over)\n", "gen", "mean speed", "spread");

    int nSurv = std::max(2, (int)(POP_SIZE * SURVIVE_FRACTION));
    std::uniform_int_distribution<int> pick(0, nSurv - 1);

    for (int gen = 0; gen <= GENERATIONS; ++gen) {
        if (gen % 6 == 0 || gen == GENERATIONS)
            printf("%4d %11.3f %8.3f\n", gen, mean(pop), stdev(pop));
        if (gen == GENERATIONS) break;

        // Selection: keep the fittest.
        std::sort(pop.begin(), pop.end(),
                  [](double a, double b) { return fitness(a) > fitness(b); });
        std::vector<double> survivors(pop.begin(), pop.begin() + nSurv);

        // Reproduction: survivors have children with small mutations.
        for (int i = 0; i < POP_SIZE; ++i)
            pop[i] = clampSpeed(survivors[pick(rng)] + mut(rng));
    }

    printf("\nBest-adapted speed (the target nobody was told): %.2f\n", bestPossibleSpeed());
    printf("Final population settled at:                     %.2f\n", mean(pop));
    printf("\nGENERATION 0  (random speeds -- spread all over):\n");
    histogram(firstGen);
    printf("\nFINAL GENERATION  (converged on the fittest speed):\n");
    histogram(pop);
    printf("\nNobody designed this. The fittest simply survived and had more children,\n"
           "so the whole population became well-adapted. That is natural selection.\n");
    return 0;
}
