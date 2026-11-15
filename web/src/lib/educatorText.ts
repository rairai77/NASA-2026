// Copied from docs/EDUCATOR.md (do not import docs at runtime). Keep in sync by hand.
export const TIPS: Record<string, string> = {
  'why-pole-hard': "At the Moon's poles the Sun never climbs far above the horizon, only a few degrees, because the Moon's axis is almost upright. Mountains and crater rims then block the Sun, so a spot can be sunlit while its neighbour a few hundred metres away sits in darkness for weeks.",
  'sun-skims-horizon': 'Because the Moon’s axis is tilted just 1.5 degrees, the Sun circles near the horizon at the poles instead of rising overhead. It slides along the skyline like a lamp rolled around the rim of a bowl. With no atmosphere there is no twilight, so shadows are sharp.',
  libration: 'The Moon rocks slightly as it orbits, a wobble called libration, so from the Moon Earth seems to drift by several degrees (up to about 8) around a point in the sky. Near the pole that small drift decides whether Earth is above a ridge, hidden behind it, or just grazing it.',
  psr: 'A permanently shadowed region (PSR) is a crater floor that never sees the Sun because the rim always blocks it. They are some of the coldest places known and may hold water ice. Our "distance to PSR" is an approximation based on cells that get no sunlight in 2026 to 2030.',
  'both-up': '"Both up" means the Sun and Earth are above the local skyline at the same time, so a lander can have power and a direct radio line to Earth. A crewed Artemis stay is planned at about 6 days, so we look for stretches of both-up that long. Shorter stretches may force the mission to wait or relocate.',
  'dust-charging': 'Near the line between lunar day and night, sunlight and the solar wind can build up electric charge on the surface and on lunar dust, which can then cling to or lift off equipment. We show a badge near that boundary as a caution, not a measured value.',
  'lobate-scarps': 'Lobate scarps are cliff-like ridges, some tens of metres tall, made when the Moon’s crust is pushed together along young faults as the Moon slowly shrinks. Some of these faults may still be active and linked to moonquakes, so we show them and let you keep a distance from them.',
  ellipse: 'A spacecraft cannot land on an exact point. The landing ellipse is the area, often 100 m to 1 km across, where it might touch down. We calculate sunlight and Earth view for many points inside it and report the worst, median and best cases.',
  'horizon-plot': 'The circle is the sky as seen from the site, looking straight up: the edge is the horizon, the centre is overhead, north is at the top. The grey outline is the terrain skyline. The Sun and Earth tracks are drawn on top, so a track dipping below the outline means that body is hidden behind terrain.',
  'timeline-bands': 'Each row shows time running left to right. One band marks when the Sun is above the skyline, one when Earth is, and one when both are. Thin marks show moments when Earth covers part of the Sun. Drag the cursor to change the time everywhere else in the app.',
  // app-specific additions (not in the doc)
  eclipse: 'An eclipse here means Earth passes in front of the Sun as seen from the surface (a solar eclipse on the Moon).',
  shadows: 'The overlay shows where terrain blocks the Sun at the time on the cursor, computed from LOLA elevation data with the same horizon code as the numbers. Dark = in shadow (with a faint blue cast from Earthshine). Use “Fly to selection” for the sharpest view: the local patch is about 60 km wide at roughly 30 m per pixel.',
};
// legacy ids used by existing <Why/> call sites
export const ALIASES: Record<string, string> = { pole: 'why-pole-hard', charging: 'dust-charging', scarps: 'lobate-scarps', horizon: 'horizon-plot' };

export interface TourStep { title: string; text: string; /** copy for the phone layout (no hover, wheel or desktop-only controls) */ phoneText?: string; action: 'answer' | 'why' | 'scrub' | 'stand' | 'how' }
export const TOUR: TourStep[] = [
  { title: '1. These are the best sites', action: 'answer',
    text: 'These are the best sites for the question in the bar at the top, best first. Each card shows the numbers behind its rank and a strip of when the Sun and Earth are up. Click a card to fly there, and change the question any time.',
    phoneText: 'These are the best sites for your question, best first. Each card shows the numbers behind its rank and when the Sun and Earth are up. Tap a card to see more.' },
  { title: '2. Why it\u2019s #1', action: 'why',
    text: 'This is the sky over the #1 site, looking straight up: the grey outline is the skyline, and the Sun and Earth tracks are drawn on it. A dot above the outline means that body is up at the time cursor. The ranking rewards sites where both stay up for long stretches.' },
  { title: '3. Scrub time', action: 'scrub',
    text: 'Drag the time cursor along the timeline, or let it play. Watch the Sun and Earth dots move on the plot. The bands show when the Sun, Earth, or both are up.',
    phoneText: 'Drag the time cursor along the timeline. The bands show when the Sun, Earth, or both are up; the plot in the Site tab follows the cursor.' },
  { title: '4. Stand there', action: 'stand',
    text: 'Press \u201cStand here\u201d in the site panel to see the skyline from 2 m above the ground, the way a lander would.',
    phoneText: 'Open the Site tab and press \u201cStand here\u201d to see the skyline from 2 m above the ground, the way a lander would.' },
  { title: '5. How we know', action: 'how',
    text: 'Open \u201cHow we know it\u2019s right\u201d to read the limits: Earth line of sight rather than a link budget, and not an official NASA product.' },
];
