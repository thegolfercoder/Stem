# Poly Citra CoolBrick (Project Rebrick v2)

A LaTeX Beamer version of the LGIC'26 APAC India "Poly Citra Bricks" deck. It keeps all of the original content and adds a passive-cooling research track.

- `poly_citra_coolbrick.tex`: the deck source (16:9 Beamer, metropolis theme)
- `poly_citra_coolbrick.pdf`: the compiled deck
- `img/`: photos taken from the original deck

Build it by running `pdflatex poly_citra_coolbrick.tex` twice. It needs the TeX Live packages `latex-extra` and `science` (for siunitx).

## What v2 adds: five cooling upgrades
1. **Air-cell core.** Dissolving EPS lets out the trapped air that made it insulate (k ≈ 0.035 W/mK becomes about 0.10–0.17 W/mK for solid PS). v2 puts air back in with hollow cells, partial foaming and a porous filler. Target U is about 0.6 W/m²K, against 2.2 for a 230 mm fired-clay wall.
2. **Bio-PCM pockets.** A coconut-oil-based phase-change material, tuned to 26–28 °C and sealed in PS cavities on the room side, flattens peak indoor temperatures.
3. **Cool face.** A CaCO₃ radiative-cooling coat. Purdue's version reflects 95.5% of sunlight and has stayed 1.7 °C below air temperature at noon. It also shields the PS from UV.
4. **Peel biochar filler.** The distillation residue is pyrolysed into a porous, flame-retardant filler. This addresses fire safety, the biggest weakness of polystyrene.
5. **Jaali (breeze-block) variant.** Perforated screens for shading and ventilation.

The deck also covers a test plan (IS 3495, IS 3346, UL-94, and a 30-day model-hut experiment), a risk table, an impact estimate, and a v1→v2 comparison.

## Before submitting
- Fill in every red `[...]` placeholder: team names, school, competition, awards, measured results and cost per brick.
- Numbers marked *estimate* or *target* still need to be measured. The PCM temperature curves are illustrative only.
- Finish the three incomplete references (Sony, PCM-brick study, orange-peel biochar/PLA paper).

## Sources used in the research
- India Cooling Action Plan figures (8× overall, about 11× for building space cooling, 74% share by 2037-38): https://iifiir.org/en/news/india-cooling-action-plan, https://www.clearias.com/india-cooling-action-plan/
- Eco Niwas Samhita RETV ≤ 15 W/m²: https://www.studiomatrx.org/students/building-performance-simulation/ecbc-and-eco-niwas-samhita
- Radiative-cooling CaCO₃ paint (Purdue, 2020): https://www.purdue.edu/newsroom/releases/2020/Q4/this-white-paint-could-reduce-the-need-for-air-conditioning-by-keeping-surfaces-cooler-than-surroundings.html, https://doaj.org/article/293558ce52c0408d9d247f66cf50f78a
- Orange-peel insulation boards (Vitale & Cascone): https://rivistatema.com/?p=1961
- Orange-peel biochar/PLA (k = 0.081 W/mK, UL-94 V-1): https://scholarworks.bwise.kr/cau/bitstream/2019.sw.cau/83546/1/Enhancedbiodegradabilityandthermalinsulationcapabilityofpolylacticacidreinforcedwithcalcium-crosslinkedorangepeelbiochar.pdf
- PCM-infused bricks: https://www.ebsco.com/articles/construction-and-building/72d6bf1c-1035-5d4f-8fa9-87104f33b801/computational-and-experimental-analysis-of-pcm-infused-brick-for-sustainable-heat-regulation/, https://arxiv.org/pdf/2510.18883
- Limonene EPS recycling (Sony) and solvent recovery: https://www.preprints.org/manuscript/202407.1983, https://uspto.report/patent/app/20220243028
- Polystyrene-waste bricks and insulation: https://www.scientific.net/AMR.652-654.1191, https://doi.org/10.3390/en14071844
