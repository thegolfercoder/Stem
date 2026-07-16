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


def test_energy_conservation_bounds():
    # Organisms never exceed their max energy capacity.
    sim = Simulation(small_config(seed=2))
    for _ in range(100):
        sim.step()
        for o in sim.organisms:
            assert o.energy <= o.max_energy + 1e-6
