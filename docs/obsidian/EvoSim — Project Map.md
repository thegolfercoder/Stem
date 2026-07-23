---
tags: [MOC]
---
# EvoSim — Project Map

Open **Graph view** to see the whole system. Start here:

## Engine core
- [[evosim]] — package entry
- [[evosim.simulation]] — perceive → decide → act → live
- [[evosim.organism]] · [[evosim.genome]] · [[evosim.world]] · [[evosim.species]] · [[evosim.spatial]] · [[evosim.config]] · [[evosim.stats]]

## Brains (pluggable)
- [[evosim.behavior]] — [[evosim.behavior.base]] · [[evosim.behavior.rule_based]] · [[evosim.behavior.neural]]

## Visualization & analysis
- [[evosim.render]] · [[evosim.analysis]]

## Entry points
- [[scripts.run_simulation]] · [[scripts.run_headless]] · [[scripts.capture_animation]] · [[scripts.export_blender]]
- [[scripts.build_web]] · [[scripts.build_single]] · [[scripts.build_mindmap]]

## Browser layer
- [[web.survival (page)]] · [[web.index (page)]] · [[web.evosim_pkg]] · [[dist (single files)]]

## Tests
- [[tests.test_simulation]] · [[tests.test_genome]] · [[tests.test_world]] · [[tests.test_analysis]]

## Engine dependency graph
```mermaid
graph LR
    evosim["evosim"] --> evosim_config["config"]
    evosim["evosim"] --> evosim_genome["genome"]
    evosim["evosim"] --> evosim_organism["organism"]
    evosim["evosim"] --> evosim_simulation["simulation"]
    evosim["evosim"] --> evosim_world["world"]
    evosim_analysis["analysis"] --> evosim_analysis_plots["analysis.plots"]
    evosim_analysis_plots["analysis.plots"] --> evosim_stats["stats"]
    evosim_behavior["behavior"] --> evosim_behavior_base["behavior.base"]
    evosim_behavior["behavior"] --> evosim_behavior_neural["behavior.neural"]
    evosim_behavior["behavior"] --> evosim_behavior_rule_based["behavior.rule_based"]
    evosim_behavior_neural["behavior.neural"] --> evosim_behavior_base["behavior.base"]
    evosim_behavior_rule_based["behavior.rule_based"] --> evosim_behavior_base["behavior.base"]
    evosim_organism["organism"] --> evosim_config["config"]
    evosim_organism["organism"] --> evosim_genome["genome"]
    evosim_render["render"] --> evosim_render_base["render.base"]
    evosim_render["render"] --> evosim_render_blender_export["render.blender_export"]
    evosim_render["render"] --> evosim_render_pygame_renderer["render.pygame_renderer"]
    evosim_render_blender_export["render.blender_export"] --> evosim_render_base["render.base"]
    evosim_render_pygame_renderer["render.pygame_renderer"] --> evosim_render_base["render.base"]
    evosim_simulation["simulation"] --> evosim_behavior["behavior"]
    evosim_simulation["simulation"] --> evosim_behavior_base["behavior.base"]
    evosim_simulation["simulation"] --> evosim_config["config"]
    evosim_simulation["simulation"] --> evosim_genome["genome"]
    evosim_simulation["simulation"] --> evosim_organism["organism"]
    evosim_simulation["simulation"] --> evosim_spatial["spatial"]
    evosim_simulation["simulation"] --> evosim_species["species"]
    evosim_simulation["simulation"] --> evosim_stats["stats"]
    evosim_simulation["simulation"] --> evosim_world["world"]
    evosim_species["species"] --> evosim_config["config"]
    evosim_species["species"] --> evosim_genome["genome"]
    evosim_world["world"] --> evosim_config["config"]
    evosim_world["world"] --> evosim_spatial["spatial"]
```
