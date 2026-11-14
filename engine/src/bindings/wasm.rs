//! wasm-bindgen wrapper: JS class `Engine` (camelCase methods, CONTRACTS §7).
use crate::engine::Engine as Core;
use crate::error::EngineError;
use crate::query::Query;
use crate::rank::{Candidate, PointIn};
use js_sys::{Array, Float32Array, Float64Array, Object, Reflect, Uint8Array};
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn err(e: EngineError) -> JsError {
    JsError::new(&e.0)
}

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    v.serialize(&serde_wasm_bindgen::Serializer::json_compatible()).map_err(|e| JsError::new(&e.to_string()))
}

fn set(o: &Object, k: &str, v: &JsValue) {
    let _ = Reflect::set(o, &JsValue::from_str(k), v);
}

fn get(o: &JsValue, k: &str) -> JsValue {
    Reflect::get(o, &JsValue::from_str(k)).unwrap_or(JsValue::UNDEFINED)
}

#[wasm_bindgen]
pub struct Engine {
    core: Core,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        console_error_panic_hook::set_once();
        Engine { core: Core::new() }
    }

    #[wasm_bindgen(js_name = loadEphemeris)]
    pub fn load_ephemeris(&mut self, meta_json: &str, bytes: &[u8]) -> Result<(), JsError> {
        self.core.load_ephemeris(meta_json, bytes).map_err(err)
    }

    /// [t0_unix, t_last_unix] covered by the loaded ephemeris.
    #[wasm_bindgen(js_name = ephemerisRange)]
    pub fn ephemeris_range(&self) -> Result<Float64Array, JsError> {
        let e = self.core.ephem.as_ref().ok_or_else(|| JsError::new("ephemeris not loaded"))?;
        Ok(Float64Array::from(&[e.t0, e.t_end()][..]))
    }

    #[wasm_bindgen(js_name = loadTerrainManifest)]
    pub fn load_terrain_manifest(&mut self, json: &str) -> Result<(), JsError> {
        self.core.load_terrain_manifest(json).map_err(err)
    }

    #[wasm_bindgen(js_name = addTile)]
    pub fn add_tile(&mut self, level_id: &str, tx: u32, ty: u32, raw: &[u8]) -> Result<(), JsError> {
        self.core.add_tile(level_id, tx as usize, ty as usize, raw).map_err(err)
    }

    #[wasm_bindgen(js_name = hasTile)]
    pub fn has_tile(&self, level_id: &str, tx: u32, ty: u32) -> bool {
        self.core.has_tile(level_id, tx as usize, ty as usize)
    }

    #[wasm_bindgen(js_name = requiredTiles)]
    pub fn required_tiles(&self, lat: f64, lon: f64, max_dist_km: Option<f64>, n_az: u32) -> Result<Vec<String>, JsError> {
        self.core.required_tiles(lat, lon, max_dist_km, n_az as usize).map_err(err)
    }

    #[wasm_bindgen(js_name = requiredTilesArea)]
    pub fn required_tiles_area(&self, lat: f64, lon: f64, radius_km: f64, level_id: Option<String>) -> Result<Vec<String>, JsError> {
        self.core.required_tiles_area(lat, lon, radius_km, level_id.as_deref()).map_err(err)
    }

    #[wasm_bindgen(js_name = requiredTilesRect)]
    pub fn required_tiles_rect(&self, west: f64, south: f64, east: f64, north: f64, w: u32, h: u32) -> Result<Vec<String>, JsError> {
        self.core.required_tiles_rect(west, south, east, north, w as usize, h as usize).map_err(err)
    }

    pub fn horizon(&self, lat: f64, lon: f64, height_m: f64, n_az: u32) -> Result<JsValue, JsError> {
        let r = self.core.horizon(lat, lon, height_m, n_az as usize).map_err(err)?;
        let o = Object::new();
        set(&o, "nAz", &JsValue::from(r.n_az as u32));
        set(&o, "elevDeg", &Float32Array::from(&r.elev_deg[..]));
        set(&o, "resolutionM", &JsValue::from(r.info.resolution_m));
        set(&o, "maxDistKm", &JsValue::from(r.info.max_dist_km));
        set(&o, "siteElevM", &JsValue::from(r.info.site_elev_m));
        set(&o, "missingSamples", &JsValue::from(r.info.missing_samples as f64));
        Ok(o.into())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn visibility(&self, lat: f64, lon: f64, height_m: f64, elev_deg: &[f32], t_start: f64, t_end: f64, step_s: f64) -> Result<JsValue, JsError> {
        let r = self.core.visibility(lat, lon, height_m, elev_deg, t_start, t_end, step_s).map_err(err)?;
        let s = &r.series;
        let o = Object::new();
        set(&o, "t", &Float64Array::from(&s.t[..]));
        set(&o, "sunAz", &Float32Array::from(&s.sun_az[..]));
        set(&o, "sunEl", &Float32Array::from(&s.sun_el[..]));
        set(&o, "sunFrac", &Float32Array::from(&s.sun_frac[..]));
        set(&o, "earthAz", &Float32Array::from(&s.earth_az[..]));
        set(&o, "earthEl", &Float32Array::from(&s.earth_el[..]));
        set(&o, "earthUp", &Uint8Array::from(&s.earth_up[..]));
        set(&o, "eclipseFrac", &Float32Array::from(&s.eclipse_frac[..]));
        set(&o, "metrics", &to_js(&r.metrics)?);
        set(&o, "events", &to_js(&r.events)?);
        Ok(o.into())
    }

    #[wasm_bindgen(js_name = loadIndexManifest)]
    pub fn load_index_manifest(&mut self, json: &str) -> Result<(), JsError> {
        self.core.load_index_manifest(json).map_err(err)
    }

    #[wasm_bindgen(js_name = loadIndexStatic)]
    pub fn load_index_static(&mut self, raw: &[u8]) -> Result<(), JsError> {
        self.core.load_index_static(raw).map_err(err)
    }

    #[wasm_bindgen(js_name = addIndexMonth)]
    pub fn add_index_month(&mut self, month: &str, raw: &[u8]) -> Result<(), JsError> {
        self.core.add_index_month(month, raw).map_err(err)
    }

    #[wasm_bindgen(js_name = addHorizonBand)]
    pub fn add_horizon_band(&mut self, band: u32, raw: &[u8]) -> Result<(), JsError> {
        self.core.add_horizon_band(band as usize, raw).map_err(err)
    }

    #[wasm_bindgen(js_name = indexMonthsNeeded)]
    pub fn index_months_needed(&self, t_start: f64, t_end: f64) -> Result<Vec<String>, JsError> {
        self.core.index_months_needed(t_start, t_end).map_err(err)
    }

    #[wasm_bindgen(js_name = rankCoarse)]
    pub fn rank_coarse(&self, query: JsValue) -> Result<JsValue, JsError> {
        let q: Query = serde_wasm_bindgen::from_value(query).map_err(|e| JsError::new(&format!("bad query: {e}")))?;
        to_js(&self.core.rank_coarse(&q).map_err(err)?)
    }

    #[wasm_bindgen(js_name = rankRefine)]
    pub fn rank_refine(&self, query: JsValue, candidates: JsValue) -> Result<JsValue, JsError> {
        let q: Query = serde_wasm_bindgen::from_value(query).map_err(|e| JsError::new(&format!("bad query: {e}")))?;
        let c: Vec<Candidate> = serde_wasm_bindgen::from_value(candidates).map_err(|e| JsError::new(&format!("bad candidates: {e}")))?;
        to_js(&self.core.rank_refine(&q, &c).map_err(err)?)
    }

    /// points: `{ id, lat, lon, elevDeg: Float32Array, siteElevM?: number }[]`
    #[wasm_bindgen(js_name = rankPoints)]
    pub fn rank_points(&self, query: JsValue, points: JsValue) -> Result<JsValue, JsError> {
        let q: Query = serde_wasm_bindgen::from_value(query).map_err(|e| JsError::new(&format!("bad query: {e}")))?;
        let mut pts = Vec::new();
        for p in Array::from(&points).iter() {
            let num = |k: &str| get(&p, k).as_f64();
            let elev = get(&p, "elevDeg");
            if elev.is_undefined() {
                return Err(JsError::new("rankPoints: point without elevDeg"));
            }
            pts.push(PointIn {
                id: get(&p, "id").as_string().unwrap_or_default(),
                lat: num("lat").ok_or_else(|| JsError::new("rankPoints: lat missing"))?,
                lon: num("lon").ok_or_else(|| JsError::new("rankPoints: lon missing"))?,
                elev_deg: Float32Array::new(&elev).to_vec(),
                site_elev_m: num("siteElevM").unwrap_or(0.0),
            });
        }
        to_js(&self.core.rank_points(&q, &pts).map_err(err)?)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ellipse(&self, lat: f64, lon: f64, semi_major_m: f64, semi_minor_m: f64, rot_deg: f64, n: u32, height_m: f64, t_start: f64, t_end: f64, step_s: f64) -> Result<JsValue, JsError> {
        to_js(
            &self
                .core
                .ellipse(lat, lon, semi_major_m, semi_minor_m, rot_deg, n as usize, height_m, t_start, t_end, step_s)
                .map_err(err)?,
        )
    }

    #[wasm_bindgen(js_name = sampleHeights)]
    pub fn sample_heights(&self, west: f64, south: f64, east: f64, north: f64, w: u32, h: u32) -> Result<Vec<f32>, JsError> {
        self.core.sample_heights(west, south, east, north, w as usize, h as usize).map_err(err)
    }

    #[wasm_bindgen(js_name = sunEarthAt)]
    pub fn sun_earth_at(&self, lat: f64, lon: f64, t_unix: f64) -> Result<JsValue, JsError> {
        to_js(&self.core.sun_earth_at(lat, lon, t_unix).map_err(err)?)
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
