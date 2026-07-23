import numpy as np

from evosim.config import ReproductionConfig
from evosim.genome import GENE_NAMES, Genome


def test_random_genome_in_bounds():
    rng = np.random.default_rng(0)
    g = Genome.random(rng)
    assert g.genes.shape == (len(GENE_NAMES),)
    assert np.all(g.genes >= 0.0) and np.all(g.genes <= 1.0)


def test_trait_expression_within_physical_range():
    rng = np.random.default_rng(1)
    g = Genome.random(rng)
    assert 0.4 <= g.trait("speed") <= 4.2
    assert 0.0 <= g.trait("diet") <= 1.0
    r, gg, b = g.color
    assert all(0 <= c <= 255 for c in (r, gg, b))


def test_mutation_stays_in_bounds_and_increments_generation():
    rng = np.random.default_rng(2)
    cfg = ReproductionConfig(mutation_rate=1.0, mutation_scale=0.5)
    g = Genome.random(rng)
    child = g.mutate(rng, cfg)
    assert np.all(child.genes >= 0.0) and np.all(child.genes <= 1.0)
    assert child.generation == g.generation + 1


def test_distance_is_zero_for_identical_and_positive_otherwise():
    rng = np.random.default_rng(3)
    g = Genome.random(rng)
    assert g.distance(g.copy()) == 0.0
    other = Genome.random(np.random.default_rng(99))
    assert g.distance(other) > 0.0


def test_neural_weights_present_when_requested():
    rng = np.random.default_rng(4)
    g = Genome.random(rng, weight_size=50)
    assert g.weights is not None and g.weights.shape == (50,)
    child = g.mutate(rng, ReproductionConfig())
    assert child.weights is not None and child.weights.shape == (50,)


def test_crossover_inherits_from_both_parents():
    rng = np.random.default_rng(5)
    a = Genome.random(rng, weight_size=20)
    b = Genome.random(rng, weight_size=20)
    child = a.crossover(b, rng)
    # Every gene must come from one parent or the other (no new values).
    from_a = child.genes == a.genes
    from_b = child.genes == b.genes
    assert np.all(from_a | from_b)
    assert child.weights.shape == a.weights.shape
    assert child.generation == max(a.generation, b.generation) + 1
