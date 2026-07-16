import numpy as np

from evosim.config import SimulationConfig
from evosim.spatial import SpatialHash, toroidal_delta
from evosim.world import World


def test_world_seeds_food():
    cfg = SimulationConfig()
    world = World(cfg, np.random.default_rng(0))
    assert len(world.food_pos) == cfg.food.initial_count
    assert len(world.food_energy) == cfg.food.initial_count


def test_food_regrows_up_to_capacity():
    cfg = SimulationConfig()
    cfg.food.carrying_capacity = 60
    cfg.food.initial_count = 10
    world = World(cfg, np.random.default_rng(1))
    for _ in range(400):
        world.regrow()
    assert len(world.food_pos) <= cfg.food.carrying_capacity


def test_consume_food_marks_then_compacts():
    cfg = SimulationConfig()
    world = World(cfg, np.random.default_rng(2))
    before = len(world.food_pos)
    world.consume_food([0, 1, 2])
    # Eaten plants are only marked during a tick (indices stay stable)...
    assert len(world.food_pos) == before
    assert not world.is_food_alive(0)
    # ...and removed when the tick is compacted.
    world.compact_food()
    assert len(world.food_pos) == before - 3


def test_spatial_hash_finds_nearby_point():
    h = SpatialHash(100, 100, cell_size=10, wrap=True)
    pts = np.array([[50.0, 50.0], [52.0, 51.0], [90.0, 90.0]])
    h.rebuild(pts)
    found = h.query_radius(50, 50, 12)
    assert 0 in found and 1 in found


def test_toroidal_delta_wraps():
    a = np.array([1.0, 1.0])
    b = np.array([99.0, 99.0])
    d = toroidal_delta(a.copy(), b.copy(), 100, 100)
    # Nearest image of b from a is at (-1, -1), not (98, 98).
    assert abs(d[0]) <= 3 and abs(d[1]) <= 3
