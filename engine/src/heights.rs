//! Terrain height sampling on a lat/lon grid (for the 3D globe terrain provider).
use crate::geo::*;
use crate::terrain::{TileSet, Terrain};

impl Terrain {
    pub(crate) fn grid_setup(&self, west: f64, south: f64, east: f64, north: f64, w: usize, h: usize) -> (f64, Vec<usize>, Vec<usize>) {
        let dlon = (east - west).abs() / (w.max(2) - 1) as f64;
        let dlat = (north - south).abs() / (h.max(2) - 1) as f64;
        let mid = ((north + south) * 0.5).to_radians().cos().abs().max(0.01);
        let spacing = (dlat.to_radians() * R).min(dlon.to_radians() * R * mid).max(1.0);
        let mut coarse_first: Vec<usize> = (0..self.levels.len()).collect();
        coarse_first.sort_by(|&a, &b| self.levels[b].pixel_m.partial_cmp(&self.levels[a].pixel_m).unwrap());
        let mut fine_first = coarse_first.clone();
        fine_first.reverse();
        (spacing, coarse_first, fine_first)
    }

    pub(crate) fn pt(west: f64, south: f64, east: f64, north: f64, w: usize, h: usize, i: usize, j: usize) -> V3 {
        let lon = west + (east - west) * i as f64 / (w.max(2) - 1) as f64;
        let lat = north - (north - south) * j as f64 / (h.max(2) - 1) as f64;
        unit_from_latlon(lat.clamp(-90.0, 90.0), lon)
    }

    /// Height at a point for a given sample spacing: coarsest valid level with
    /// pixel <= spacing, else finest valid level.
    pub fn height_for_spacing(&self, p: &V3, spacing: f64, coarse_first: &[usize], fine_first: &[usize]) -> Option<f64> {
        for &li in coarse_first.iter().filter(|&&li| self.levels[li].pixel_m <= spacing) {
            if let Some(z) = self.sample(li, p) {
                return Some(z);
            }
        }
        fine_first.iter().find_map(|&li| self.sample(li, p))
    }

    pub fn levels_by_pixel(&self) -> (Vec<usize>, Vec<usize>) {
        let mut c: Vec<usize> = (0..self.levels.len()).collect();
        c.sort_by(|&a, &b| self.levels[b].pixel_m.partial_cmp(&self.levels[a].pixel_m).unwrap());
        let mut f = c.clone();
        f.reverse();
        (c, f)
    }

    /// Heights (m) on a w x h grid including edges, row 0 = north. Per point:
    /// the coarsest level whose pixel size <= sample spacing that has a valid
    /// sample, else the finest valid level; 0 if no level covers the point.
    pub fn sample_heights(&self, west: f64, south: f64, east: f64, north: f64, w: usize, h: usize) -> Vec<f32> {
        let (spacing, coarse_first, fine_first) = self.grid_setup(west, south, east, north, w, h);
        let mut out = Vec::with_capacity(w * h);
        for j in 0..h {
            for i in 0..w {
                let p = Self::pt(west, south, east, north, w, h, i, j);
                let mut v = None;
                for &li in coarse_first.iter().filter(|&&li| self.levels[li].pixel_m <= spacing) {
                    if let Some(z) = self.sample(li, &p) {
                        v = Some(z);
                        break;
                    }
                }
                if v.is_none() {
                    for &li in &fine_first {
                        if let Some(z) = self.sample(li, &p) {
                            v = Some(z);
                            break;
                        }
                    }
                }
                out.push(v.unwrap_or(0.0) as f32);
            }
        }
        out
    }

    /// Dry run of `sample_heights`.
    pub fn plan_heights(&self, west: f64, south: f64, east: f64, north: f64, w: usize, h: usize, set: &mut TileSet) {
        let (spacing, coarse_first, fine_first) = self.grid_setup(west, south, east, north, w, h);
        for j in 0..h {
            for i in 0..w {
                let p = Self::pt(west, south, east, north, w, h, i, j);
                let hit = coarse_first
                    .iter()
                    .filter(|&&li| self.levels[li].pixel_m <= spacing)
                    .any(|&li| self.probe(li, &p, set))
                    || fine_first.iter().any(|&li| self.probe(li, &p, set));
                let _ = hit;
            }
        }
    }
}
