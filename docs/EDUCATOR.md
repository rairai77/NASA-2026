# Educator mode text

Tooltip texts (1-3 sentences each) and a guided tour for the app's educator mode. Plain language, no jargon without a gloss. Keys are the ids used in `web/src/lib/educatorText.ts`, which holds the in-app copy and must be kept in sync by hand. Educator mode and the tour are built; the tour starts from the "Start tour" button that appears when Educator mode is on.

## Tooltips

**why-pole-hard**
At the Moon's poles the Sun never climbs far above the horizon, only a few degrees, because the Moon's axis is almost upright. Mountains and crater rims then block the Sun, so a spot can be sunlit while its neighbour a few hundred metres away sits in darkness for weeks.

**sun-skims-horizon**
Because the Moon's axis is tilted just 1.5 degrees, the Sun circles near the horizon at the poles instead of rising overhead. It slides along the skyline like a lamp rolled around the rim of a bowl. With no atmosphere there is no twilight, so shadows are sharp.

**libration**
The Moon rocks slightly as it orbits, a wobble called libration, so from the Moon Earth seems to drift by several degrees (up to about 8) around a point in the sky. Near the pole that small drift decides whether Earth is above a ridge, hidden behind it, or just grazing it.

**psr**
A permanently shadowed region (PSR) is a crater floor that never sees the Sun because the rim always blocks it. They are some of the coldest places known and may hold water ice. Our "distance to PSR" is an approximation based on cells that get no sunlight in 2026 to 2030.

**both-up**
"Both up" means the Sun and Earth are above the local skyline at the same time, so a lander can have power and a direct radio line to Earth. A crewed Artemis stay is planned at about 6 days, so we look for stretches of both-up that long. Shorter stretches may force the mission to wait or relocate.

**dust-charging**
Near the line between lunar day and night, sunlight and the solar wind can build up electric charge on the surface and on lunar dust, which can then cling to or lift off equipment. We show a badge near that boundary as a caution, not a measured value.

**lobate-scarps**
Lobate scarps are cliff-like ridges, some tens of metres tall, made when the Moon's crust is pushed together along young faults as the Moon slowly shrinks. Some of these faults may still be active and linked to moonquakes, so we show them and let you keep a distance from them.

**ellipse**
A spacecraft cannot land on an exact point. The landing ellipse is the area, often 100 m to 1 km across, where it might touch down. We calculate sunlight and Earth view for many points inside it and report the worst, median and best cases.

**horizon-plot**
The circle is the sky as seen from the site, looking straight up: the edge is the horizon, the centre is overhead, north is at the top. The grey outline is the terrain skyline. The Sun and Earth tracks are drawn on top, so a track dipping below the outline means that body is hidden behind terrain.

**timeline-bands**
Each row shows time running left to right. One band marks when the Sun is above the skyline, one when Earth is, and one when both are. Thin marks show moments when Earth covers part of the Sun. Drag the cursor to change the time everywhere else in the app.

**eclipse**
An eclipse here means Earth passes in front of the Sun as seen from the surface (a solar eclipse on the Moon).

**shadows**
The overlay shows where terrain blocks the Sun at the time on the cursor, computed from LOLA elevation data with the same horizon code as the numbers. Dark means in shadow, with a faint blue cast from Earthshine. Use "Fly to selection" for the sharpest view: the local patch is about 60 km wide at roughly 30 m per pixel.

## Five-step guided tour

1. **Meet the Moon.** The tour starts on the globe with an Apollo site selected. Say: "At Apollo 11 the Sun gets high overhead and a day lasts about two weeks." Highlight the horizon plot, where the Sun track sweeps high above a flat skyline.
2. **Go to the pole.** Switch to a south-polar site. Say: "Here the Sun only skims the horizon." Show the plot flattening and the skyline cutting into the Sun track. Open the **why-pole-hard** tooltip.
3. **Scrub time.** Drag the time cursor along the timeline. Watch the Sun and Earth move on the plot and the countdown to sunrise or sunset change. Open **timeline-bands** and **both-up**.
4. **Ask a question.** Type a request such as "best sites for a week in June 2028". Chips appear; edit one; ranked sites update. Say: "You can change one chip and re-rank. No AI picks the winner; the chips are the contract."
5. **Stand there, and check the work.** Press "Stand here" to see the skyline from 2 m up. Then open "How we know it's right" and read the limits: Earth line of sight rather than a link budget, and not an official NASA product.
