# Demo video storyboard

Rules (Space Apps): English (subtitles if any other language), no NASA logos or insignia, no recognizable faces, voices or names of anyone under 18, no copyrighted music or footage without permission, no profanity. Do not imply NASA endorsement. Keep the "Not an official NASA product" caption in the final frame.

Story (from `docs/PLAN.md`): "Our CLPS launch slipped from March to June 2028."

All timings are targets. Numbers shown on screen must come from the real build. TODO(verify) replace every `[X]` with the value displayed in the final app.

## 30-second cut

| Time | On-screen action | Caption | Voice-over |
|---|---|---|---|
| 0-3 s | Globe of the Moon, query bar empty. Cursor types: "CLPS launch slipped from March to June 2028, best sites with Earth in view" | Launch slipped. Where do we land now? | "Our lander's launch just slipped three months." |
| 3-6 s | Query turns into editable chips (dates Jun 2028 window, region south pole, objectives, k = 5). Pause on chips, cursor hovers one. | Chips you can edit. No AI in the ranking. | "Type it, and it becomes chips you can edit." |
| 6-10 s | Five ranked pins light up near the south pole; results list shows rank and key metrics. Highlight rank and "[X] ms". | Ranked by Sun and Earth visibility | "Five ranked sites light up, computed in your browser." |
| 10-15 s | Zoom to #1. Drag the time cursor along the bottom timeline: a crater-rim shadow slides across terrain; Earth rises over the ridge in the sky. | Terrain-true horizon from LOLA | "Scrub time: a crater rim's shadow slides, Earth rises over the ridge." |
| 15-19 s | Drawer opens: horizon plot with Sun and Earth tracks; countdown reads "[X] d [Y] h of sunlight left". Hover the countdown. | Time to sunset and Earthset | "Down to the hour: sunlight left, and when Earth sets." |
| 19-23 s | Click "Stand here": first-person view at 2 m, skyline silhouette, Sun skimming the ridge, Earth low. Scrub a few hours. | Stand here | "Now stand on the surface and watch the Sun skim the horizon." |
| 23-26 s | Switch site to Apollo 11 via the picker; horizon plot flattens, Sun track climbs high. Side-by-side with the polar site. | Equator vs pole | "Compare Apollo 11: a high Sun, two-week days. The pole is a different world." |
| 26-29 s | Open "How we know it's right": Horizons agreement ([X] deg), limits list. | Checked against JPL Horizons | "And every number is checked against JPL Horizons, with limits stated." |
| 29-30 s | End card: project name, live URL, "Not an official NASA product. Data: NASA LRO/LOLA, NAIF SPICE." | Lunar Landing Site Navigator | "Lunar Landing Site Navigator." |

Voice-over word count is about 75 words; read at a steady pace. If it overruns, cut the shot at 23-26 s to 2 s and drop its caption.

## 60-second alternate cut

| Time | Action | Voice-over |
|---|---|---|
| 0-6 s | Same opening: typed slip query, chips appear. | "Our lander's launch slipped from March to June 2028. Which site is best now?" |
| 6-14 s | Edit a chip live (change k or min both-up hours); results re-rank. Show the ordered objectives chip. | "Chips are the contract. Change one and the ranking updates in milliseconds." |
| 14-22 s | Results list with sparklines; compare top 3 on the shared timeline (Sun, Earth, both bands). Highlight the longest both-up run of 6+ days. | "Compare sites on one timeline: Sun up, Earth up, and both. About six days matters for a crewed stay." |
| 22-32 s | Zoom to #1, scrub time: rim shadow, Earth rising, countdown. | "Terrain from LOLA decides the answer: a rim kilometres away can hide the Sun." |
| 32-40 s | Landing-ellipse mode: worst, median, best case across the ellipse. | "Landing is never exact, so we show worst, median and best case inside the ellipse." |
| 40-47 s | Stand here, scrub; flip to Apollo 11. | "Stand on the surface. Then compare Apollo 11." |
| 47-56 s | How we know it's right: Horizons table, mission replay (TODO(verify) only if built), limits. | "Checked against Horizons, with honest limits: Earth line of sight, not a link budget." |
| 56-60 s | End card with URL and credits. | "Lunar Landing Site Navigator." |

## Recording tips
- **Resolution:** record at 1920x1080 (or 2560x1440 downscaled), 30 fps, browser window at 1280 px width minimum for layout parity with the judges' laptops. Hide bookmarks bar and extensions. Browser zoom 100 percent.
- **Cursor:** enable a cursor highlight (large ring or click ripple) and move slowly. Pause 0.5 s on each result before the next action. Do not scroll quickly.
- **State:** record from a deployed or `npm run build` preview, not the dev server, with real data loaded (info badge must not say demo or synthetic). Warm the cache first so tiles do not pop in. Use a shared-link URL hash to start each shot in the exact state (query, selected sites, time cursor, camera); TODO(verify) generate and store the URL for each shot using the app's share button, and list them here:
  - Shot 1-3: TODO(verify) URL with empty query
  - Shot 4-5: TODO(verify) URL, site = rank 1 of the June 2028 query, time cursor at the shadow-sliding moment
  - Shot 6: TODO(verify) URL in first-person view
  - Shot 7: TODO(verify) URL with Apollo 11 selected
- **Capture order:** record each shot separately, then cut. Capture 10 s extra on each end.
- **Audio:** record voice-over separately in a quiet room. Use your own voice or clearly say if synthetic. No music with unclear licensing. Add English captions burned in or as a subtitle file. Check no minor's name or face appears.
- **Frame:** keep NASA logos out of view (no NASA website or QuickMap tabs on screen). Crop browser UI if it shows other tabs.
- **Check:** confirm the video is within the length limit, uploads publicly (unlisted is fine if the portal allows), and plays without login.
