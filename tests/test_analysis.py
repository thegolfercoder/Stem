import os

from evosim import Simulation, SimulationConfig
from evosim.analysis import generate_report


def test_generate_report_creates_png(tmp_path):
    cfg = SimulationConfig()
    cfg.population.initial_organisms = 50
    cfg.world.width = 400
    cfg.world.height = 300
    sim = Simulation(cfg)
    for _ in range(60):
        sim.step()
    path = generate_report(sim.stats, output_dir=str(tmp_path), prefix="test")
    assert os.path.exists(path)
    assert os.path.getsize(path) > 0


def test_stats_export(tmp_path):
    cfg = SimulationConfig()
    cfg.population.initial_organisms = 40
    sim = Simulation(cfg)
    for _ in range(30):
        sim.step()
    csv_path = tmp_path / "s.csv"
    json_path = tmp_path / "s.json"
    sim.stats.to_csv(csv_path)
    sim.stats.to_json(json_path)
    assert csv_path.exists() and csv_path.stat().st_size > 0
    assert json_path.exists() and json_path.stat().st_size > 0
