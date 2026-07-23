import numpy as np

from evosim import Simulation, SimulationConfig


def small_config(brain="neural", seed=7):
    cfg = SimulationConfig()
    cfg.seed = seed
    cfg.behavior.brain = brain
    cfg.population.initial_organisms = 60
    cfg.population.max_organisms = 400
    cfg.food.initial_count = 200
    cfg.food.carrying_capacity = 400
    cfg.world.width = 400
    cfg.world.height = 300
    return cfg


def test_simulation_runs_and_records():
    sim = Simulation(small_config())
    for _ in range(120):
        sim.step()
    assert len(sim.stats.records) == 120
    assert sim.stats.records[-1]["tick"] == 120


def test_reproduction_and_births_occur():
    sim = Simulation(small_config(seed=3))
    total_births = 0
    for _ in range(200):
        sim.step()
        total_births += sim.stats.records[-1]["births"]
    assert total_births > 0


def test_determinism_same_seed_same_result():
    a = Simulation(small_config(seed=11))
    b = Simulation(small_config(seed=11))
    for _ in range(80):
        a.step()
        b.step()
    assert a.population == b.population
    assert a.stats.records[-1]["population"] == b.stats.records[-1]["population"]


def test_rule_brain_also_runs():
    sim = Simulation(small_config(brain="rule", seed=5))
    for _ in range(80):
        sim.step()
    assert len(sim.stats.records) == 80


def test_species_emerge():
    sim = Simulation(small_config(seed=9))
    for _ in range(150):
        sim.step()
    assert sim.species_tracker.count >= 1


def test_batched_neural_matches_per_organism():
    # The vectorized decide_batch must be numerically identical to looping decide.
    from evosim.behavior import make_brain
    from evosim.behavior.base import PERCEPTION_SIZE
    from evosim.config import BehaviorConfig

    sim = Simulation(small_config(seed=4))
    for _ in range(10):
        sim.step()
    brain = sim.brain
    orgs = sim.organisms
    perceptions = np.random.default_rng(0).random((len(orgs), PERCEPTION_SIZE))
    batched = brain.decide_batch(perceptions, orgs)
    looped = np.array([brain.decide(perceptions[i], o) for i, o in enumerate(orgs)])
    assert np.allclose(batched, looped, atol=1e-9)


def test_sexual_reproduction_runs():
    cfg = small_config(seed=8)
    cfg.reproduction.sexual = True
    sim = Simulation(cfg)
    births = 0
    for _ in range(200):
        sim.step()
        births += sim.stats.records[-1]["births"]
    assert births > 0
    assert sim.population >= 0  # did not crash


def test_energy_conservation_bounds():
    # Organisms never exceed their max energy capacity.
    sim = Simulation(small_config(seed=2))
    for _ in range(100):
        sim.step()
        for o in sim.organisms:
            assert o.energy <= o.max_energy + 1e-6


def test_survival_preset_selects_for_speed():
    """The general-audience 'survival' preset should embody directional
    selection: under genuine scarcity, mean speed rises and creatures starve
    without the population going extinct."""
    cfg = SimulationConfig.survival(seed=7)
    assert cfg.behavior.brain == "rule"
    assert cfg.population.max_organisms < 200  # few, followable creatures
    sim = Simulation(cfg)
    speed_start = float(np.mean([o.speed for o in sim.organisms]))
    for _ in range(900):
        if not sim.step():
            break
    assert len(sim.organisms) > 0, "population must survive the bottleneck"
    speed_end = float(np.mean([o.speed for o in sim.organisms]))
    assert speed_end > speed_start, "the fittest (fastest) should come to dominate"
    starved = int(sim.stats.column("deaths_starvation").sum())
    assert starved > 0, "scarcity should produce visible starvation deaths"
