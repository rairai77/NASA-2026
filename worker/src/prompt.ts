import { METRICS } from "./validate.ts";
import { SITE_LIST_TEXT } from "./sites.generated.ts";

const METRIC_DOC = `Metrics (use these exact names):
sun_hours (h): hours with Sun up in window
sun_frac (0-1): fraction of window with Sun up
longest_sun_h (h): longest continuous sunlit run
longest_dark_h (h): longest continuous night (Sun down)
earth_hours (h): hours with Earth up (direct-to-Earth comms)
longest_earth_h (h): longest continuous Earth-up run
longest_no_earth_h (h): longest continuous Earth-down run
both_hours (h): hours with Sun AND Earth both up
longest_both_h (h): longest continuous Sun-and-Earth run
mean_sun_el_deg (deg): mean Sun elevation while up
min_sun_el_deg (deg): minimum Sun elevation while up
sun_disc_frac_mean (0-1): mean visible fraction of Sun disc while up
eclipse_hours (h): hours Earth partly covers the Sun
comms_hours (h): hours Earth is up AND a Deep Space Network dish can hear the Moon (real comms; equals the window with relay)
longest_comms_h (h): longest continuous comms run
marginal_hours (h): hours Earth is up but skims the skyline (weak, flickery link; lower = better)
energy_wh (Wh): solar energy over the window (needs power)
battery_wh_needed (Wh): battery needed to ride out the longest night (needs power)
lat (deg), lon (deg east), elev_m (m): location and elevation
slope_deg (deg): terrain slope (lower = flatter)
psr_dist_km (km): distance to the nearest permanently shadowed region
fault_dist_km (km): distance to the nearest lobate scarp / fault`;

export function systemPrompt(today: string): string {
  return `You convert a mission planner's request about lunar landing sites into ONE call to the function set_query. Never write prose; only call the function.
Today is ${today} (UTC). Resolve all relative dates ("next spring", "in March") against it. Dates are YYYY-MM-DD, window end is exclusive.
If no time window is given, use window start = ${today}, end = one month later.
Defaults when not stated: height_m 2, k 5, min_separation_km 10. Use region {type:"polar", min_lat:-90, max_lat:-85} when the user says "south pole" or gives no region.
Only include fields the user's request implies, except the defaults above.
${METRIC_DOC}
Filters: {metric, op in <,<=,>,>=, value}. Objectives: {metric, dir in max,min}, in priority order (first is most important). mode "lexicographic" unless the user asks to weight objectives.
Regions: polar {min_lat,max_lat}; circle {lat,lon,radius_km} (lon east-positive, south latitudes negative); sites {ids:[...]} to rank only named curated sites; bbox {west,south,east,north} in degrees (west > east wraps the antimeridian); global {} for the whole Moon.
Searches reaching north of -85 degrees latitude (bbox, global, wide polar bands, circles away from the pole) run on a coarse 10 km grid, where psr_dist_km and fault_dist_km do not exist: do not put them in filters or objectives for such regions.
relay: set true only when the user assumes a relay orbiter / continuous Earth contact (then comms_hours equals the window).
power: lander panel {kind: vertical_fixed|vertical_tracking|horizontal, areaM2, efficiency 0-1, loadW, depthOfDischarge 0-1, batteryWh}. Include it only when the user gives power details or asks for energy_wh / battery_wh_needed; omitted fields default to vertical_tracking, 3 m2, 0.3, 150 W, 0.8, 2000 Wh.
Known site ids: ${SITE_LIST_TEXT}
Examples:
- "at least 6 days of continuous sun and Earth" -> filter longest_both_h >= 144
- "flattest" -> objective slope_deg min
- "shortest night" -> objective longest_dark_h min
- "most Earth visibility" -> objective earth_hours max
- "reliable comms" / "most time talking to Earth" -> objective comms_hours max (and filter longest_comms_h if a run length is given)
- "assuming a relay satellite" -> relay true
- "anywhere on the Moon" / "whole Moon" -> region {type:"global"}
- "between 20S and 40S, 0 to 30E" -> region bbox west 0 south -40 east 30 north -20
- "survive the night with a 2 kWh battery and 150 W load" -> power {kind:"vertical_tracking", loadW:150, batteryWh:2000, areaM2:3, efficiency:0.3, depthOfDischarge:0.8} and filter battery_wh_needed <= 2000
- "near Shackleton" -> region circle lat -89.67 lon 129.8 radius_km 30
- "launch slipped from March to June 2028" -> window 2028-06-01 to 2028-07-01
- "compare Apollo 11 with Malapert" -> region sites ids [apollo11, malapert]
Any phrase you cannot map onto the schema goes into unparsed (verbatim short strings); never guess a metric that is not listed.`;
}

const num = { type: "number" };
export const SET_QUERY_TOOL = {
  type: "function",
  function: {
    name: "set_query",
    description: "Set the structured landing-site search query.",
    parameters: {
      type: "object",
      properties: {
        window: {
          type: "object",
          properties: {
            start: { type: "string", description: "YYYY-MM-DD or ISO-8601 UTC" },
            end: { type: "string", description: "exclusive end, YYYY-MM-DD or ISO-8601 UTC" },
          },
          required: ["start", "end"],
        },
        region: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["polar", "circle", "sites"] },
            min_lat: num, max_lat: num,
            lat: num, lon: num, radius_km: num,
            ids: { type: "array", items: { type: "string" } },
          },
          required: ["type"],
        },
        height_m: { type: "number", description: "observer height above terrain, m" },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              metric: { type: "string", enum: METRICS },
              op: { type: "string", enum: ["<", "<=", ">", ">="] },
              value: num,
            },
            required: ["metric", "op", "value"],
          },
        },
        objectives: {
          type: "array",
          items: {
            type: "object",
            properties: {
              metric: { type: "string", enum: METRICS },
              dir: { type: "string", enum: ["max", "min"] },
            },
            required: ["metric", "dir"],
          },
        },
        mode: { type: "string", enum: ["lexicographic", "weighted"] },
        weights: { type: "array", items: num },
        k: { type: "integer", minimum: 1, maximum: 20 },
        min_separation_km: num,
        relay: { type: "boolean", description: "assume a relay orbiter gives continuous Earth contact" },
        power: {
          type: "object",
          description: "lander solar panel + battery model; enables energy_wh and battery_wh_needed",
          properties: {
            kind: { type: "string", enum: ["vertical_fixed", "vertical_tracking", "horizontal"] },
            azimuthDeg: { type: "number", description: "panel facing, deg from north (vertical_fixed only)" },
            areaM2: num,
            efficiency: { type: "number", minimum: 0, maximum: 1 },
            loadW: num,
            depthOfDischarge: { type: "number", minimum: 0, maximum: 1 },
            batteryWh: num,
          },
        },
        unparsed: { type: "array", items: { type: "string" }, description: "phrases that could not be mapped" },
      },
    },
  },
} as const;
