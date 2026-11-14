//! Native file IO: load tiles and ephemeris from a pipeline data directory.
use crate::bail;
use crate::engine::Engine;
use crate::error::Res;
use crate::par::pmap;
use std::io::Read;
use std::path::Path;

pub fn load_ephemeris_files(eng: &mut Engine, json_path: &Path, f32_path: &Path) -> Res<()> {
    let meta = std::fs::read_to_string(json_path).map_err(|e| format!("{}: {e}", json_path.display()))?;
    let bytes = std::fs::read(f32_path).map_err(|e| format!("{}: {e}", f32_path.display()))?;
    eng.load_ephemeris(&meta, &bytes)
}

/// Reads `<data_dir>/terrain/manifest.json` and every gz tile of the selected
/// levels (all if `levels` is None). Returns the number of tiles loaded.
pub fn load_terrain_dir(eng: &mut Engine, data_dir: &Path, levels: Option<&[String]>) -> Res<usize> {
    let mpath = data_dir.join("terrain").join("manifest.json");
    let json = std::fs::read_to_string(&mpath).map_err(|e| format!("{}: {e}", mpath.display()))?;
    eng.load_terrain_manifest(&json)?;
    let t = eng.terrain.as_mut().unwrap();
    let nelem = t.tile_size * t.tile_size;
    // (level index, tx, ty, path)
    let mut jobs = Vec::new();
    for (li, l) in t.levels.iter().enumerate() {
        if let Some(sel) = levels {
            if !sel.iter().any(|s| s == &l.id) {
                continue;
            }
        }
        for ty in 0..l.tiles_y {
            for tx in 0..l.tiles_x {
                if l.is_missing(tx, ty) {
                    continue;
                }
                let rel = l.path.replace("{tx}", &tx.to_string()).replace("{ty}", &ty.to_string());
                jobs.push((li, tx, ty, data_dir.join(rel)));
            }
        }
    }
    let loaded: Vec<Option<(usize, usize, usize, Box<[i16]>)>> = pmap(&jobs, |(li, tx, ty, path)| {
        let f = std::fs::File::open(path).ok()?;
        let mut raw = Vec::with_capacity(nelem * 2);
        flate2::read::GzDecoder::new(f).read_to_end(&mut raw).ok()?;
        if raw.len() != nelem * 2 {
            return None;
        }
        let v: Box<[i16]> = raw.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        Some((*li, *tx, *ty, v))
    });
    let mut n = 0;
    for item in loaded.into_iter().flatten() {
        t.add_tile_i16(item.0, item.1, item.2, item.3)?;
        n += 1;
    }
    if n == 0 && !jobs.is_empty() {
        bail!("no readable tiles under {}", data_dir.display());
    }
    Ok(n)
}
