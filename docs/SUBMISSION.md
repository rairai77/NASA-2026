# Space Apps 2026 submission text

Paste-ready. Fill every remaining `TODO(verify)` before submitting (deadline 11:59 PM Pacific, Sun Nov 15, 2026). Check field names and limits against the 2026 Project Submission Guide.

## Project name
Lunar Landing Site Navigator

## Challenge
Lunar Landing Site Navigator

## Links
- Live demo: https://lunar-site-navigator.cutenitki.workers.dev
- Repository (MIT): https://github.com/rairai77/NASA-2026
- Demo video: TODO(verify) add URL once uploaded

## High-level summary (about 150 words)
Lunar Landing Site Navigator answers "which sites and dates work best for my mission?" from a typed request or a few chips. It ranks lunar landing sites and dates by how long the Sun and Earth stay above each site's real local skyline, then shows why on a 3D Moon. Sun elevation and Earth direction come from NASA SPICE (DE440) and are checked against JPL Horizons. Skylines come from LRO LOLA topography with lunar curvature, so the south pole, where the Sun skims the horizon and a distant rim can shadow a site, is handled correctly. Users can pick Apollo, CLPS, other agencies' sites, Artemis regions or any coordinate, or type a request such as "launch slipped from March to June 2028" and edit the resulting query chips. Results include time to sunset and Earthset, a horizon plot, a shared timeline, power and Deep Space Network comms checks and a first-person "stand here" view. A "How we know it's right" panel shows our validation and limits. Everything runs in the browser from precomputed static data.

## Project details

**What it does.** Compares and ranks lunar sites and dates by sunlight and Earth line of sight. For any site it shows the Sun and Earth tracks against the terrain horizon, countdowns to sunset and Earthset, and metrics (sunlit hours, longest sunlit and dark runs, visible fraction of the Sun's disc, hours with Sun and Earth both up, eclipse hours, slope, distance to permanently shadowed areas and to mapped fault scarps). It ranks the south polar cap (to 85°S, 1 km grid) for a date window, and screens the whole Moon or a lat-lon box on a coarse 10 km grid, flagged "coarse". Other features: compare 2 to 4 sites, mission replay (predicted vs reported sunset), scenario diff for a launch slip, a power and battery model, DSN comms visibility with a relay toggle, a landing-ellipse mode (worst, median and best case over 10 to 400 sample points), a rover traverse planner (slope limit, waits for sunlight), a 3D Moon with terrain-true shadows from LOLA, context layers (PGDA shadow, illumination and Earth visibility; Diviner temperature; fault scarps), educator mode with a guided tour, share links and CSV export.

**How it works.** An offline Python pipeline (SpiceyPy, rasterio, numpy, scipy) turns NAIF kernels and LOLA DEMs into static tiles, a 15-minute Sun/Earth ephemeris for 2026-2030 and monthly Sun-up/Earth-up bitsets. A Rust engine, compiled to WebAssembly and run in a Web Worker, computes horizons (ray-marched with a curvature term), Sun-disc visibility, eclipses, metrics and rankings locally, fetching only the tiles a query needs. The UI is React and CesiumJS with D3 charts. The only server code is a small Cloudflare Worker that sends typed requests to an LLM through OpenRouter to produce editable query chips. The LLM is never in the ranking path.

**Benefits.** Mission planners can replan quickly after a schedule slip and compare many site-date combinations at once. Science and engineering teams can share a scenario by link. Educators and the public get plain-language explanations of why the pole is hard. The tool is a screening aid built on open data, with its assumptions stated.

**Intended impact.** Make terrain-aware Sun and Earth visibility, which today needs expert tools such as QuickMap, Moon Trek or SPICE scripting, available as a fast, date-specific comparison for any skill level. We do not claim to replace NASA's site-selection analysis. Measured performance: a 4-month box query on the coarse global index ranks 64,800 cells in 0.59 s and refines 50 candidates in 0.14 s (WASM in Node). We have no user feedback or usage numbers to report.

**Tools, languages and services.** Python, Rust, TypeScript, JavaScript; React, Vite, CesiumJS, D3, Zustand, Comlink; SpiceyPy, rasterio, numpy, scipy; PyO3, wasm-bindgen, wasm-pack, rayon; Cloudflare Workers (static assets and `/api/parse`); OpenRouter with `anthropic/claude-haiku-5.5` (query parsing only); Claude Code (development).

## Use of NASA data and services
All terrain, ephemeris and catalog inputs are NASA data or NASA-funded products. Nothing is redistributed other than derived tiles and tables.

| Dataset or service | Link | Used for |
|---|---|---|
| LRO LOLA gridded DEMs (LDEM_85S_20M, LDEM_80S_80M, LDEM_60S_240M, LDEM_64, LDEM_16, LDEM_4), PDS Geosciences Node | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/ | Terrain, horizons, slope, region grid |
| NAIF SPICE toolkit and generic kernels (DE440s, lunar PCK and frames, LSK, DSN station kernels) | https://naif.jpl.nasa.gov/naif/data_generic.html | Sun/Earth positions in the lunar frame, DSN geometry |
| JPL Horizons | https://ssd.jpl.nasa.gov/horizons/ | Independent validation of Sun/Earth azimuth and elevation (and DSN elevation) |
| LROC lobate scarp shapefiles (global and polar) | https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_LOBATE_SCARPS and https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_POLAR_SCARP_LOCATIONS | Fault-scarp layer and distance filter |
| LROC anthropogenic features shapefile | https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_ANTHROPOGENIC_OBJECTS | Landing-site coordinates for flown missions |
| NASA SVS CGI Moon Kit (SVS 4720) | https://svs.gsfc.nasa.gov/4720 | Globe imagery (visual only) |
| NASA Artemis III candidate regions release | https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/ | Region names (coordinates are our own representative points) |
| NASA mission releases (CLPS, IM-1, Blue Ghost, LRO images) | see `data-src/SOURCES.md` | Mission timelines for replay |
| PGDA lunar polar illumination (Mazarico et al. 2011) | https://pgda.gsfc.nasa.gov/products/69 | Validation of our sunlit fraction, Earth-up fraction and permanent-shadow proxy over 72,324 cells (r = 0.976 and 0.974); globe layers for permanent shadow, average illumination and Earth visibility |
| LRO Diviner Polar Resource Product | https://pds-geosciences.wustl.edu/ | Annual maximum surface and average (2 cm) temperature layers on the globe |
| LROC QuickMap, NASA Moon Trek | https://quickmap.lroc.asu.edu , https://trek.nasa.gov/moon/ | Reference only, used to sanity-check results by eye. No data taken from them. |

## Space agency partner data
The challenge lists the Canadian Space Agency Moon Exploration portal (https://asc-csa.gc.ca/eng/astronomy/moon-exploration/). We did **not** use data from it. It was read as background context only. A search of the app, worker, pipeline, engine and `data-src/` finds no CSA material.

Non-NASA sources used: JAXA, ISRO, CNSA and commercial-lander facts in `data-src/missions.json` come from agency and company press releases and news reports linked per entry in `data-src/SOURCES.md` (used for mission replay and site names, not as measured data). Wikipedia is cited in places for feature coordinates and is labelled as such. TODO(verify) team to check each source's terms of use.

## References
**Datasets and papers**
- Smith, D. E., et al. (2010). Initial observations from the Lunar Orbiter Laser Altimeter (LOLA). Geophys. Res. Lett. 37, L18204. https://doi.org/10.1029/2010GL043751
- Smith, D. E., et al. (2017). Summary of the results from the Lunar Orbiter Laser Altimeter after seven years in lunar orbit. Icarus 283, 70-91. https://doi.org/10.1016/j.icarus.2016.06.006
- Acton, C. H. (1996). Ancillary data services of NASA's Navigation and Ancillary Information Facility. Planet. Space Sci. 44(1), 65-70. https://doi.org/10.1016/0032-0633(95)00107-7
- Acton, C., et al. (2018). A look towards the future in the handling of space science mission geometry. Planet. Space Sci. 150, 9-12. https://doi.org/10.1016/j.pss.2017.02.013
- Park, R. S., et al. (2021). The JPL Planetary and Lunar Ephemerides DE440 and DE441. Astron. J. 161, 105. https://doi.org/10.3847/1538-3881/abd414
- Giorgini, J. D., et al. (1996). JPL's on-line solar system data service. Bull. Am. Astron. Soc. 28(3), 1158. (JPL Horizons)
- Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211(2), 1066-1081. https://doi.org/10.1016/j.icarus.2010.10.030
- Watters, T. R., et al. (2015). Global thrust faulting on the Moon and the influence of tidal stresses. Geology 43(10), 851-854. https://doi.org/10.1130/G37120.1
- Nelson, D. M., et al. (2014). Mapping lunar maria extents and lobate scarps using LROC image products. LPSC 45, abstract 2861.
- Wagner, R. V., et al. (2017). Coordinates of anthropogenic features on the Moon. Icarus 283, 92-103. https://doi.org/10.1016/j.icarus.2016.05.011
- NASA Scientific Visualization Studio, CGI Moon Kit, https://svs.gsfc.nasa.gov/4720
- NASA, Artemis III candidate landing regions (2024-10-28); LPSC 2026 abstract 1901 (Artemis III site selection update), https://www.hou.usra.edu/meetings/lpsc2026/pdf/1901.pdf
- Paige, D. A., et al. (2010). The Lunar Reconnaissance Orbiter Diviner Lunar Radiometer Experiment. Space Sci. Rev. 150, 125-160. https://doi.org/10.1007/s11214-009-9529-2
- Williams, J.-P., et al. (2019). Seasonal polar temperatures on the Moon. J. Geophys. Res. Planets 124, 2505-2521. https://doi.org/10.1029/2019JE006028
- Barker et al. (2016, 2021) are not used (5 m DEMs are not in the pipeline).

**Software** (versions: see `web/package.json`, `pipeline/pyproject.toml`, `engine/Cargo.toml`; licenses are in each package's own repository)
- CesiumJS https://cesium.com/platform/cesiumjs/ · React https://react.dev · Vite https://vite.dev · D3 https://d3js.org · Zustand https://github.com/pmndrs/zustand · Comlink https://github.com/GoogleChromeLabs/comlink
- SpiceyPy https://github.com/AndrewAnnex/SpiceyPy · rasterio https://rasterio.readthedocs.io · NumPy https://numpy.org · SciPy https://scipy.org
- Rust, PyO3 https://pyo3.rs · wasm-bindgen https://github.com/rustwasm/wasm-bindgen · wasm-pack · rayon https://github.com/rayon-rs/rayon
- Cloudflare Workers https://developers.cloudflare.com/workers/ · OpenRouter https://openrouter.ai
- Other dependencies shipped: lz-string (npm); pyproj, Pillow, matplotlib, requests, tqdm (PyPI); serde, serde_json, flate2, numpy (crate), js-sys, serde-wasm-bindgen (crates); wrangler (npm, deploy).

**AI tools:** Claude Code (Anthropic) for development; an LLM via OpenRouter (`anthropic/claude-haiku-5.5`) only to parse typed requests into query chips.

## AI usage disclosure
- **Development:** Claude Code (Anthropic) wrote most of the code, scripts and documentation under the direction of the team. TODO(verify) team to confirm this wording and how much of the output the team reviewed.
- **In the product:** an LLM, reached through OpenRouter, converts a typed request into editable query chips and nothing else. Its output is validated against a fixed query schema, invalid parts are dropped and shown as unparsed, and it writes no explanations. It is never used to rank sites or compute any number. The form UI offers the same function without it.
- **Not used:** no generative AI made data, imagery or the demo video imagery. TODO(verify) team to confirm this holds for the final video and any voice-over (say so if AI voice is used).

## Judging criteria mapping
Judging criteria as listed in the published judging guide (confirm against the 2026 edition).

| Criterion | What addresses it | Evidence to point at |
|---|---|---|
| **Impact** | Fast replanning after a slip (query chips, scenario diff, shareable links), whole-region ranking, educator mode and guided tour for non-experts | Demo story in the video; share links; `docs/EDUCATOR.md`. No user feedback collected |
| **Creativity** | Date-specific ranking of whole regions rather than one point at a time; landing-ellipse robustness; first-person "stand here" view with true skyline; mission replay; rover traverse planner that waits for sunlight; chips as the contract with no AI in ranking | Features table in README.md; video |
| **Validity** | SPICE/DE440 geometry matches Horizons to 3e-5 degrees, both in the Python reference and in the compiled engine (3 sites, 20 times; limit 0.05). Native and WASM builds are bit-identical on 20 sites. Our sunlit fraction vs PGDA average illumination over 72,324 cells: r = 0.976 (bias -0.023, RMSE 0.039); Earth visibility r = 0.974; permanent-shadow agreement 97.7% (IoU 0.81). Apollo 11 Sun-up averages 14.74 days per lunation. Shadow patch matches per-pixel horizons on 98.7% of pixels at 19.5 m/px. DSN elevations match Horizons to 1e-4 degrees. Mission replay: IM-1 +42.3 h, Chandrayaan-3 +3.6 h, Blue Ghost 1 -3.4 h (reported times uncertain by hours). Limits stated up front | `docs/VALIDATION.md`, `docs/HOW_WE_KNOW.md`, in-app panel. Not yet done: comparison with an independent skyline tool |
| **Relevance** | Directly answers the challenge: Sun and Earth versus horizon, time to sunset and Earthset, curated and custom sites, temporal views, power model, DSN comms visibility, all skill levels | README.md features table |
| **Presentation** | 30-second storyboarded video (60-second alternate), clear hero shots, English captions, validation slide | `docs/VIDEO.md`, video link |

## Declarations checklist
- [ ] All team members registered and listed on the project page
- [ ] Video in English, no NASA logos, no faces or names of anyone under 18
- [ ] Every external resource listed in References
- [ ] "Not an official NASA product" line present in the app and README
- [ ] Submitted by 9 PM Pacific to leave margin
