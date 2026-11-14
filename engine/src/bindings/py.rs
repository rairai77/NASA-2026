//! PyO3 module `lunar_engine`: numpy in/out wrappers over the core.
use crate::engine::Engine as Core;
use crate::error::EngineError;
use crate::geo::*;
use crate::global::{global_grid_bitsets, global_grid_horizons, GlobalGrid};
use crate::grid::{grid_bitsets, grid_horizons, BitsetSpec, GridSpec};
use crate::metrics::Metrics;
use numpy::{IntoPyArray, PyArray1, PyArrayMethods, PyReadonlyArray1, PyReadonlyArray3, PyUntypedArrayMethods};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use std::path::Path;

fn err(e: EngineError) -> PyErr {
    PyValueError::new_err(e.0)
}

fn metrics_dict<'py>(py: Python<'py>, m: &Metrics) -> PyResult<Bound<'py, PyDict>> {
    let d = PyDict::new(py);
    for (k, v) in m {
        d.set_item(k, v)?;
    }
    Ok(d)
}

#[pyclass]
pub struct Engine {
    core: Core,
}

#[pymethods]
impl Engine {
    #[new]
    fn new() -> Self {
        Engine { core: Core::new() }
    }

    fn load_ephemeris_files(&mut self, json_path: &str, f32_path: &str) -> PyResult<()> {
        crate::native_io::load_ephemeris_files(&mut self.core, Path::new(json_path), Path::new(f32_path)).map_err(err)
    }

    /// Load `<data_dir>/terrain/manifest.json` and its gz tiles; returns tiles loaded.
    #[pyo3(signature = (data_dir, levels=None))]
    fn load_terrain_dir(&mut self, py: Python<'_>, data_dir: &str, levels: Option<Vec<String>>) -> PyResult<usize> {
        let core = &mut self.core;
        py.detach(|| crate::native_io::load_terrain_dir(core, Path::new(data_dir), levels.as_deref())).map_err(err)
    }

    fn load_dsn_files(&mut self, json_path: &str, i16_path: &str) -> PyResult<()> {
        let meta = std::fs::read_to_string(json_path).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let bytes = std::fs::read(i16_path).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.core.load_dsn(&meta, &bytes).map_err(err)
    }

    fn load_terrain_manifest(&mut self, json: &str) -> PyResult<()> {
        self.core.load_terrain_manifest(json).map_err(err)
    }

    #[pyo3(signature = (lat, lon, h=2.0, n_az=720))]
    fn horizon<'py>(&self, py: Python<'py>, lat: f64, lon: f64, h: f64, n_az: usize) -> PyResult<Bound<'py, PyArray1<f32>>> {
        let r = py.detach(|| self.core.horizon(lat, lon, h, n_az)).map_err(err)?;
        Ok(r.elev_deg.into_pyarray(py))
    }

    /// Like `horizon` but returns a dict with elev_deg and the info fields.
    #[pyo3(signature = (lat, lon, h=2.0, n_az=720, max_dist_km=None))]
    fn horizon_info<'py>(&self, py: Python<'py>, lat: f64, lon: f64, h: f64, n_az: usize, max_dist_km: Option<f64>) -> PyResult<Bound<'py, PyDict>> {
        let t = self.core.terrain.as_ref().ok_or_else(|| PyValueError::new_err("terrain not loaded"))?;
        let (hz, info) = py.detach(|| t.horizon(lat, lon, h, n_az, max_dist_km.map(|k| k * 1000.0))).map_err(err)?;
        let d = PyDict::new(py);
        d.set_item("n_az", n_az)?;
        d.set_item("elev_deg", hz.into_pyarray(py))?;
        d.set_item("resolution_m", info.resolution_m)?;
        d.set_item("max_dist_km", info.max_dist_km)?;
        d.set_item("site_elev_m", info.site_elev_m)?;
        d.set_item("missing_samples", info.missing_samples)?;
        Ok(d)
    }

    fn site_elevation(&self, lat: f64, lon: f64) -> Option<f64> {
        let t = self.core.terrain.as_ref()?;
        t.site_elevation(&unit_from_latlon(nudge_lat(lat), lon)).map(|v| v.0)
    }

    #[pyo3(signature = (lat, lon, max_dist_km=None, n_az=720))]
    fn required_tiles(&self, lat: f64, lon: f64, max_dist_km: Option<f64>, n_az: usize) -> PyResult<Vec<String>> {
        self.core.required_tiles(lat, lon, max_dist_km, n_az).map_err(err)
    }

    #[pyo3(signature = (lat, lon, h, elev_deg, t_start, t_end, step_s, site_elev_m=None, relay=false))]
    #[allow(clippy::too_many_arguments)]
    fn visibility<'py>(
        &self,
        py: Python<'py>,
        lat: f64,
        lon: f64,
        h: f64,
        elev_deg: PyReadonlyArray1<'py, f32>,
        t_start: f64,
        t_end: f64,
        step_s: f64,
        site_elev_m: Option<f64>,
        relay: bool,
    ) -> PyResult<Bound<'py, PyDict>> {
        let hz = elev_deg.as_slice().map_err(|e| PyValueError::new_err(e.to_string()))?;
        let z = site_elev_m.unwrap_or_else(|| self.core.site_elev_or_zero(lat, lon));
        let r = self.core.visibility_full(lat, lon, h, z, hz, t_start, t_end, step_s, relay).map_err(err)?;
        let s = r.series;
        let d = PyDict::new(py);
        d.set_item("t", s.t.into_pyarray(py))?;
        d.set_item("sun_az", s.sun_az.into_pyarray(py))?;
        d.set_item("sun_el", s.sun_el.into_pyarray(py))?;
        d.set_item("sun_frac", s.sun_frac.into_pyarray(py))?;
        d.set_item("earth_az", s.earth_az.into_pyarray(py))?;
        d.set_item("earth_el", s.earth_el.into_pyarray(py))?;
        d.set_item("earth_up", s.earth_up.into_pyarray(py))?;
        d.set_item("eclipse_frac", s.eclipse_frac.into_pyarray(py))?;
        d.set_item("link_margin", r.comms.link_margin.into_pyarray(py))?;
        if let Some(m) = r.comms.dsn_up {
            d.set_item("dsn_up", m.into_pyarray(py))?;
        }
        d.set_item("metrics", metrics_dict(py, &r.metrics)?)?;
        let ev = PyList::empty(py);
        for e in &r.events {
            let ed = PyDict::new(py);
            ed.set_item("t", e.t)?;
            ed.set_item("kind", e.kind)?;
            ev.append(ed)?;
        }
        d.set_item("events", ev)?;
        Ok(d)
    }

    fn sun_earth_at<'py>(&self, py: Python<'py>, lat: f64, lon: f64, t: f64) -> PyResult<Bound<'py, PyDict>> {
        let r = self.core.sun_earth_at(lat, lon, t).map_err(err)?;
        let d = PyDict::new(py);
        d.set_item("sun_az", r.sun_az)?;
        d.set_item("sun_el", r.sun_el)?;
        d.set_item("sun_radius_deg", r.sun_radius_deg)?;
        d.set_item("earth_az", r.earth_az)?;
        d.set_item("earth_el", r.earth_el)?;
        d.set_item("earth_radius_deg", r.earth_radius_deg)?;
        d.set_item("eclipse_frac", r.eclipse_frac)?;
        d.set_item("sun_vec_me", r.sun_vec_me.to_vec())?;
        d.set_item("earth_vec_me", r.earth_vec_me.to_vec())?;
        Ok(d)
    }

    /// Horizons for every cell of a south-polar grid: int16 [ny, nx, n_az] in
    /// 0.01 degree units, -32768 for cells north of `max_lat` or without data.
    #[allow(clippy::too_many_arguments)]
    fn grid_horizons<'py>(
        &self,
        py: Python<'py>,
        nx: usize,
        ny: usize,
        x0: f64,
        y0: f64,
        cell_m: f64,
        n_az: usize,
        height_m: f64,
        max_lat: f64,
    ) -> PyResult<Bound<'py, numpy::PyArray3<i16>>> {
        let t = self.core.terrain.as_ref().ok_or_else(|| PyValueError::new_err("terrain not loaded"))?;
        let g = GridSpec { nx, ny, x0, y0, cell_m };
        let out = py.detach(|| grid_horizons(t, &g, n_az, height_m, max_lat));
        out.into_pyarray(py).reshape([ny, nx, n_az])
    }

    /// Sun-up and Earth-up bitsets (u64, `words = ceil(n_steps/64)` per cell,
    /// flat [ncells*words]) from grid horizons [ny, nx, n_az] (int16, 0.01 deg).
    /// Site height comes from `elev_m` (float32 [ny*nx]) if given, else terrain.
    #[pyo3(signature = (horizons, t0_unix, n_steps, step_s, height_m, x0, y0, cell_m, elev_m=None))]
    #[allow(clippy::too_many_arguments)]
    fn grid_bitsets<'py>(
        &self,
        py: Python<'py>,
        horizons: PyReadonlyArray3<'py, i16>,
        t0_unix: f64,
        n_steps: usize,
        step_s: f64,
        height_m: f64,
        x0: f64,
        y0: f64,
        cell_m: f64,
        elev_m: Option<PyReadonlyArray1<'py, f32>>,
    ) -> PyResult<(Bound<'py, PyArray1<u64>>, Bound<'py, PyArray1<u64>>)> {
        let sh = horizons.shape();
        let (ny, nx, n_az) = (sh[0], sh[1], sh[2]);
        let hz = horizons.as_slice().map_err(|e| PyValueError::new_err(format!("horizons must be C-contiguous: {e}")))?;
        let el = match &elev_m {
            Some(a) => Some(a.as_slice().map_err(|e| PyValueError::new_err(e.to_string()))?),
            None => None,
        };
        let eph = self.core.ephem.as_ref().ok_or_else(|| PyValueError::new_err("ephemeris not loaded"))?;
        let terr = self.core.terrain.as_ref();
        let g = GridSpec { nx, ny, x0, y0, cell_m };
        let spec = BitsetSpec { n_az, t0: t0_unix, n_steps, step_s, height_m };
        let (s, e) = py.detach(|| grid_bitsets(eph, terr, el, hz, &g, &spec)).map_err(err)?;
        Ok((s.into_pyarray(py), e.into_pyarray(py)))
    }

    /// Heights (m) at points; `level` = level id ("g0", ...) or None for the finest valid level. NaN where invalid.
    #[pyo3(signature = (lats, lons, level=None))]
    fn sample_points<'py>(&self, py: Python<'py>, lats: PyReadonlyArray1<'py, f64>, lons: PyReadonlyArray1<'py, f64>, level: Option<String>) -> PyResult<Bound<'py, PyArray1<f64>>> {
        let t = self.core.terrain.as_ref().ok_or_else(|| PyValueError::new_err("terrain not loaded"))?;
        let li = match &level {
            Some(id) => Some(t.level_index(id).ok_or_else(|| PyValueError::new_err(format!("unknown level {id}")))?),
            None => None,
        };
        let (la, lo) = (lats.as_slice().map_err(|e| PyValueError::new_err(e.to_string()))?, lons.as_slice().map_err(|e| PyValueError::new_err(e.to_string()))?);
        if la.len() != lo.len() {
            return Err(PyValueError::new_err("lats and lons differ in length"));
        }
        let out: Vec<f64> = py.detach(|| {
            la.iter()
                .zip(lo)
                .map(|(&a, &b)| {
                    let u = unit_from_latlon(nudge_lat(a), b);
                    match li {
                        Some(li) => t.sample(li, &u),
                        None => t.site_elevation(&u).map(|v| v.0),
                    }
                    .unwrap_or(f64::NAN)
                })
                .collect()
        });
        Ok(out.into_pyarray(py))
    }

    /// Global equirect grid (lon from -180, lat from 90, `ppd` cells/deg) horizons: int16 [ny, nx, n_az], 0.01 deg.
    #[pyo3(signature = (ppd, n_az, height_m, max_dist_km=150.0))]
    fn global_grid_horizons<'py>(&self, py: Python<'py>, ppd: f64, n_az: usize, height_m: f64, max_dist_km: f64) -> PyResult<Bound<'py, numpy::PyArray3<i16>>> {
        let t = self.core.terrain.as_ref().ok_or_else(|| PyValueError::new_err("terrain not loaded"))?;
        let g = GlobalGrid::whole_moon(ppd);
        let out = py.detach(|| global_grid_horizons(t, &g, n_az, height_m, max_dist_km * 1000.0));
        out.into_pyarray(py).reshape([g.ny, g.nx, n_az])
    }

    /// Global bitsets (same bit layout as `grid_bitsets`); horizons from `global_grid_horizons`.
    #[pyo3(signature = (horizons, t0_unix, n_steps, step_s, height_m, ppd, elev_m=None))]
    #[allow(clippy::too_many_arguments)]
    fn global_grid_bitsets<'py>(
        &self,
        py: Python<'py>,
        horizons: PyReadonlyArray3<'py, i16>,
        t0_unix: f64,
        n_steps: usize,
        step_s: f64,
        height_m: f64,
        ppd: f64,
        elev_m: Option<PyReadonlyArray1<'py, f32>>,
    ) -> PyResult<(Bound<'py, PyArray1<u64>>, Bound<'py, PyArray1<u64>>)> {
        let n_az = horizons.shape()[2];
        let g = GlobalGrid::whole_moon(ppd);
        if horizons.shape()[0] != g.ny || horizons.shape()[1] != g.nx {
            return Err(PyValueError::new_err("horizons shape does not match the global grid for this ppd"));
        }
        let hz = horizons.as_slice().map_err(|e| PyValueError::new_err(e.to_string()))?;
        let el = match &elev_m {
            Some(a) => Some(a.as_slice().map_err(|e| PyValueError::new_err(e.to_string()))?),
            None => None,
        };
        let eph = self.core.ephem.as_ref().ok_or_else(|| PyValueError::new_err("ephemeris not loaded"))?;
        let spec = BitsetSpec { n_az, t0: t0_unix, n_steps, step_s, height_m };
        let terr = self.core.terrain.as_ref();
        let (s, e) = py.detach(|| global_grid_bitsets(eph, terr, el, hz, &g, &spec)).map_err(err)?;
        Ok((s.into_pyarray(py), e.into_pyarray(py)))
    }
}

#[pymodule]
fn lunar_engine(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<Engine>()?;
    Ok(())
}
