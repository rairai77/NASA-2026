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
