use crate::geo::*;
use crate::metrics::{longest_run, longest_run_bool};
use crate::query::nms;
use crate::terrain::Terrain;
use crate::visibility::{eclipse_fraction, sun_fraction};

/// One south-polar stereographic level, 200 m pixels, 256 km square, heights from `f(x, y)` metres.
fn synth(f: impl Fn(f64, f64) -> f64) -> Terrain {
    let man = r#"{"tile_size":256,"height_scale":0.5,"nodata":-32768,"radius_m":1737400,
      "levels":[{"id":"s0","proj":"south_stereo","pixel_m":200,"x0":-128000,"y0":128000,
      "width":1280,"height":1280,"tiles_x":5,"tiles_y":5,"path":"x","missing":[]}]}"#;
    let mut t = Terrain::from_manifest_json(man).unwrap();
    for ty in 0..5 {
        for tx in 0..5 {
            let mut raw = Vec::with_capacity(256 * 256 * 2);
            for r in 0..256 {
                for c in 0..256 {
                    let (j, i) = (tx * 256 + c, ty * 256 + r);
                    let x = -128000.0 + (j as f64 + 0.5) * 200.0;
                    let y = 128000.0 - (i as f64 + 0.5) * 200.0;
                    let v = (f(x, y) / 0.5).round() as i16;
                    raw.extend_from_slice(&v.to_le_bytes());
                }
            }
            t.add_tile("s0", tx, ty, &raw).unwrap();
        }
    }
    t
}

#[test]
fn flat_sphere_horizon_is_the_dip_angle() {
    let t = synth(|_, _| 0.0);
    let (hz, info) = t.horizon(-89.9, 30.0, 2.0, 72, None).unwrap();
    let dip = -(R / (R + 2.0)).acos().to_degrees(); // -0.0868 deg
    for v in &hz {
        assert!((*v as f64 - dip).abs() < 0.003, "got {v}, want {dip}");
    }
    assert_eq!(info.resolution_m, 200.0);
}

#[test]
fn wall_gives_expected_elevation() {
    // 500 m high wall between x = 9 km and 12 km, east of a site next to the pole.
    let t = synth(|x, _| if (9000.0..12000.0).contains(&x) { 500.0 } else { 0.0 });
    let (hz, _) = t.horizon(-89.99, 0.0, 2.0, 360, None).unwrap();
    let d = 9100.0f64;
    let th = d / R;
    let want = ((R + 500.0) * th.cos() - (R + 2.0)).atan2((R + 500.0) * th.sin()).to_degrees();
    let east = hz[90] as f64;
    assert!((east - want).abs() < 0.15, "east {east} want {want}");
    assert!(hz[270] < 0.0, "west should stay below horizontal");
}

#[test]
fn sun_fraction_endpoints() {
    let r = 0.0047;
    assert!((sun_fraction(r, r) - 1.0).abs() < 1e-12);
    assert!((sun_fraction(0.0, r) - 0.5).abs() < 1e-12);
    assert!(sun_fraction(-r, r).abs() < 1e-12);
    // eclipse overlap: disjoint, fully covered, half-ish
    assert_eq!(eclipse_fraction(0.0047, 0.0045, 0.02), 0.0);
    assert!((eclipse_fraction(0.0047, 0.0090, 0.001) - 1.0).abs() < 1e-12);
    let f = eclipse_fraction(0.0047, 0.0045, 0.0047);
    assert!(f > 0.2 && f < 0.7);
}

#[test]
fn run_lengths_match_brute_force() {
    let mut s = 0x1234_5678_9abc_def1u64;
    let mut rnd = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    for trial in 0..300 {
        let n = 1 + (rnd() % 300) as usize;
        let bias = rnd() % 4; // vary run structure
        let bits: Vec<bool> = (0..n).map(|_| if bias == 0 { rnd() % 16 != 0 } else if bias == 1 { rnd() % 16 == 0 } else { rnd() % 2 == 0 }).collect();
        let mut words = vec![0u64; (n + 63) / 64];
        for (k, b) in bits.iter().enumerate() {
            if *b {
                words[k / 64] |= 1 << (k % 64);
            }
        }
        assert_eq!(longest_run(&words, n, false), longest_run_bool(bits.iter().copied()), "ones trial {trial}");
        assert_eq!(longest_run(&words, n, true), longest_run_bool(bits.iter().map(|b| !b)), "zeros trial {trial}");
    }
}

#[test]
fn stereo_round_trip() {
    for &(lat, lon) in &[(-89.9, 12.0), (-85.0, -170.0), (-70.0, 45.5), (-60.1, 179.0)] {
        let u = unit_from_latlon(lat, lon);
        let (x, y) = south_stereo_fwd(&u);
        let (la, lo) = south_stereo_inv(x, y);
        assert!((la - lat).abs() < 1e-9 && (wrap180(lo - lon)).abs() < 1e-9, "{lat},{lon} -> {la},{lo}");
    }
}

#[test]
fn nms_enforces_separation() {
    let pts: Vec<V3> = (0..20).map(|i| unit_from_latlon(-88.0 + i as f64 * 0.01, 0.0)).collect(); // ~300 m apart
    let order: Vec<usize> = (0..20).collect();
    let kept = nms(&order, &|i| pts[i], 1000.0, 50);
    for a in 0..kept.len() {
        for b in a + 1..kept.len() {
            assert!(gc_dist_m(&pts[kept[a]], &pts[kept[b]]) >= 1000.0);
        }
    }
    assert!(kept.len() >= 2 && kept.len() < 20);
    assert_eq!(kept[0], 0);
}

/// Heavy: real data, seam check for the south-pole patch. Run with `cargo test --release -- --ignored seam --nocapture`.
#[test]
#[ignore]
fn seam_pole_patch_real_data() {
    use crate::engine::Engine;
    let dd = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/public/data");
    let mut eng = Engine::default();
    let m = std::fs::read_to_string(dd.join("ephem/ephem.json")).unwrap();
    let b = std::fs::read(dd.join("ephem/ephem.f32")).unwrap();
    eng.load_ephemeris(&m, &b).unwrap();
    eng.load_terrain_manifest(&std::fs::read_to_string(dd.join("terrain/manifest.json")).unwrap()).unwrap();
    let keys = eng.required_tiles_patch(-90.0, 0.0, 650.0, 1024).unwrap();
    eprintln!("planned {} tiles", keys.len());
    {
        let t = eng.terrain.as_mut().unwrap();
        let nelem = t.tile_size * t.tile_size;
        for k in &keys {
            let mut it = k.split('/');
            let (id, ty, tx) = (it.next().unwrap(), it.next().unwrap().parse::<usize>().unwrap(), it.next().unwrap().parse::<usize>().unwrap());
            let path = dd.join(format!("terrain/{id}/{ty}/{tx}.i16.gz"));
            let out = std::process::Command::new("gzip").arg("-dc").arg(&path).output().unwrap();
            assert_eq!(out.stdout.len(), nelem * 2, "{k}");
            t.add_tile(id, tx, ty, &out.stdout).unwrap();
        }
    }
    let r = eng.shadow_patch(-90.0, 0.0, 650.0, 1024, 1794873600.0).unwrap();
    let px = 1024;
    let lit = |c0: usize, c1: usize| (300..600).map(|i| (c0..c1).filter(|&j| r.data[(i * px + j) * 2] > 0).count()).sum::<usize>();
    eprintln!("sun az {} el {}", r.sun_az, r.sun_el);
    eprintln!("strict strip cols 503..514 rows 300..700 lit = {}", lit(503, 514));
    eprintln!("lit strip 498..520 = {}, mirror 504..526 = {}", lit(498, 520), lit(504, 526));
    for i in [300, 400, 500, 600, 700] {
        let row: Vec<usize> = (498..520).filter(|&j| r.data[(i * px + j) * 2] > 0).collect();
        eprintln!("row {i}: lit cols {row:?}");
    }
    // DEM level used along row 500 across x = 0
    let g = eng.patch_grid(-90.0, 0.0, 650.0, 1024).unwrap();
    let t = eng.terrain.as_ref().unwrap();
    let (cf, ff) = t.levels_by_pixel();
    for j in 505..520 {
        let (x, y) = g.xy(500, j);
        let p = g.point(x, y);
        let used: Vec<String> = cf.iter().filter(|&&li| t.levels[li].pixel_m <= g.pixel_m).chain(ff.iter()).take(6).map(|&li| format!("{}:{:?}", t.levels[li].id, t.sample(li, &p))).collect();
        eprintln!("col {j} x={x:.1} y={y:.1} up={} {used:?}", g.up[500 * px + j]);
    }
}

/// Planning must not skip the sliver-shaped equirect tiles beside the pole (manifest only, no tile data).
#[test]
fn pole_patch_plan_covers_sliver_tiles() {
    use crate::engine::Engine;
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/public/data/terrain/manifest.json");
    let Ok(json) = std::fs::read_to_string(p) else { return };
    let mut eng = Engine::default();
    eng.load_terrain_manifest(&json).unwrap();
    let keys = eng.required_tiles_patch(-90.0, 0.0, 650.0, 1024).unwrap();
    assert!(keys.iter().any(|k| k == "g0/44/89"), "g0/44/89 missing from plan");
}

/// Heavy: local patch plan time/tile count with real manifest.
#[test]
#[ignore]
fn local_patch_plan_cost() {
    use crate::engine::Engine;
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/public/data/terrain/manifest.json");
    let mut eng = Engine::default();
    eng.load_terrain_manifest(&std::fs::read_to_string(p).unwrap()).unwrap();
    let t0 = std::time::Instant::now();
    let keys = eng.required_tiles_patch(-88.7, -68.3, 60.0, 2048).unwrap();
    eprintln!("local plan: {} tiles, {:?}", keys.len(), t0.elapsed());
}

/// Heavy: pole patch plan time with real manifest.
#[test]
#[ignore]
fn pole_patch_plan_cost() {
    use crate::engine::Engine;
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/public/data/terrain/manifest.json");
    let mut eng = Engine::default();
    eng.load_terrain_manifest(&std::fs::read_to_string(p).unwrap()).unwrap();
    let t0 = std::time::Instant::now();
    let keys = eng.required_tiles_patch(-90.0, 0.0, 650.0, 1024).unwrap();
    eprintln!("pole plan: {} tiles, {:?}", keys.len(), t0.elapsed());
}
