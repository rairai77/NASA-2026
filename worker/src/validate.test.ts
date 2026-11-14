import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToolArgs } from "./validate.ts";

test("valid query passes through", () => {
  const r = validateToolArgs({
    window: { start: "2028-06-01", end: "2028-07-01" },
    region: { type: "polar", min_lat: -90, max_lat: -85 },
    filters: [{ metric: "longest_both_h", op: ">=", value: 144 }],
    objectives: [{ metric: "slope_deg", dir: "min" }],
    k: 5,
  });
  assert.deepEqual(r.warnings, []);
  assert.equal((r.query.filters as unknown[]).length, 1);
  assert.equal(r.query.k, 5);
});

test("unknown metric dropped with warning, valid parts kept", () => {
  const r = validateToolArgs({
    filters: [{ metric: "foo", op: ">", value: 1 }, { metric: "slope_deg", op: "<=", value: "8" }],
  });
  assert.deepEqual(r.query.filters, [{ metric: "slope_deg", op: "<=", value: 8 }]);
  assert.match(r.warnings[0], /unknown metric 'foo' dropped/);
});

test("k is clamped to 1..20", () => {
  assert.equal(validateToolArgs({ k: 99 }).query.k, 20);
  assert.equal(validateToolArgs({ k: 0 }).query.k, 1);
});

test("window with start >= end is dropped", () => {
  const r = validateToolArgs({ window: { start: "2028-07-01", end: "2028-06-01" } });
  assert.equal(r.query.window, undefined);
  assert.equal(r.warnings.length, 1);
});

test("bad region, bad op and non-object input", () => {
  const r = validateToolArgs({ region: { type: "ellipsoid" }, filters: [{ metric: "sun_hours", op: "=", value: 1 }] });
  assert.equal(r.query.region, undefined);
  assert.equal(r.warnings.length, 2);
  assert.equal(validateToolArgs("nope").warnings.length, 1);
});

test("sites region and unparsed passthrough", () => {
  const r = validateToolArgs({ region: { type: "sites", ids: ["apollo11", "bad id!", "malapert"] }, unparsed: ["vibes"] });
  assert.deepEqual(r.query.region, { type: "sites", ids: ["apollo11", "malapert"] });
  assert.deepEqual(r.unparsed, ["vibes"]);
});
