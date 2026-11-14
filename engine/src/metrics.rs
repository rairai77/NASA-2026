//! Window metrics (fine series and coarse bitsets) and bit utilities.
use crate::visibility::Series;
use std::collections::BTreeMap;

pub type Metrics = BTreeMap<String, f64>;

pub fn longest_run_bool(v: impl Iterator<Item = bool>) -> usize {
    let (mut best, mut cur) = (0, 0);
    for b in v {
        if b {
            cur += 1;
            best = best.max(cur);
        } else {
            cur = 0;
        }
    }
    best
}

/// Window metrics of CONTRACTS §5 from a fine series (power-model metrics excluded).
pub fn window_metrics(s: &Series) -> Metrics {
    let n = s.t.len();
    let h = s.step_s / 3600.0;
    let mut m = Metrics::new();
    if n == 0 {
        return m;
    }
    let su = |k: usize| s.sun_up[k] == 1;
    let eu = |k: usize| s.earth_up[k] == 1;
    let cnt = |f: &dyn Fn(usize) -> bool| (0..n).filter(|&k| f(k)).count() as f64;
    let sun_n = cnt(&su);
    m.insert("sun_hours".into(), sun_n * h);
    m.insert("sun_frac".into(), sun_n / n as f64);
    m.insert("longest_sun_h".into(), longest_run_bool((0..n).map(su)) as f64 * h);
    m.insert("longest_dark_h".into(), longest_run_bool((0..n).map(|k| !su(k))) as f64 * h);
    m.insert("earth_hours".into(), cnt(&eu) * h);
    m.insert("longest_earth_h".into(), longest_run_bool((0..n).map(eu)) as f64 * h);
    m.insert("longest_no_earth_h".into(), longest_run_bool((0..n).map(|k| !eu(k))) as f64 * h);
    m.insert("both_hours".into(), cnt(&|k| su(k) && eu(k)) * h);
    m.insert("longest_both_h".into(), longest_run_bool((0..n).map(|k| su(k) && eu(k))) as f64 * h);
    m.insert("eclipse_hours".into(), s.eclipse_active.iter().filter(|&&b| b == 1).count() as f64 * h);
    if sun_n > 0.0 {
        let (mut sum, mut mn, mut fsum) = (0.0, f64::INFINITY, 0.0);
        for k in 0..n {
            if su(k) {
                let el = s.sun_el[k] as f64;
                sum += el;
                mn = mn.min(el);
                fsum += s.sun_frac[k] as f64;
            }
        }
        m.insert("mean_sun_el_deg".into(), sum / sun_n);
        m.insert("min_sun_el_deg".into(), mn);
        m.insert("sun_disc_frac_mean".into(), fsum / sun_n);
    }
    m
}

// ---------------------------------------------------------------- bit utils

#[inline]
fn mask(n: usize) -> u64 {
    if n >= 64 {
        !0
    } else {
        (1u64 << n) - 1
    }
}

/// Read `n <= 64` bits starting at bit `pos`.
#[inline]
fn read_bits(src: &[u64], pos: usize, n: usize) -> u64 {
    let (w, o) = (pos / 64, pos % 64);
    let mut v = src[w] >> o;
    if o + n > 64 {
        v |= src[w + 1] << (64 - o);
    }
    v & mask(n)
}

/// OR `n <= 64` bits of `val` into `dst` at bit `pos` (dst must be zero there).
#[inline]
fn write_bits(dst: &mut [u64], pos: usize, n: usize, val: u64) {
    let (w, o) = (pos / 64, pos % 64);
    dst[w] |= val << o;
    if o + n > 64 {
        dst[w + 1] |= val >> (64 - o);
    }
}

/// Append bits [lo, lo+count) of `src` into `dst` starting at bit `dst_pos`.
pub fn copy_bits(dst: &mut [u64], dst_pos: usize, src: &[u64], lo: usize, count: usize) {
    let mut done = 0;
    while done < count {
        let n = (count - done).min(64);
        let v = read_bits(src, lo + done, n);
        write_bits(dst, dst_pos + done, n, v);
        done += n;
    }
}

pub fn popcount(w: &[u64]) -> usize {
    w.iter().map(|x| x.count_ones() as usize).sum()
}

/// Longest run of ones (or zeros if `invert`) among the first `nbits` bits.
pub fn longest_run(words: &[u64], nbits: usize, invert: bool) -> usize {
    let (mut best, mut cur) = (0usize, 0usize);
    let mut remaining_total = nbits;
    for &w0 in words {
        if remaining_total == 0 {
            break;
        }
        let nb = remaining_total.min(64);
        remaining_total -= nb;
        let mut x = if invert { !w0 } else { w0 } & mask(nb);
        let mut rem = nb;
        // continue the run from the previous word
        let t = (x.trailing_ones() as usize).min(rem);
        cur += t;
        best = best.max(cur);
        if t == rem {
            continue;
        }
        x = x.checked_shr(t as u32).unwrap_or(0);
        rem -= t;
        cur = 0;
        loop {
            let z = (x.trailing_zeros() as usize).min(rem);
            x = x.checked_shr(z as u32).unwrap_or(0);
            rem -= z;
            if rem == 0 {
                break;
            }
            let o = (x.trailing_ones() as usize).min(rem);
            x = x.checked_shr(o as u32).unwrap_or(0);
            rem -= o;
            best = best.max(o);
            if rem == 0 {
                cur = o;
                break;
            }
        }
    }
    best
}

/// Coarse metrics from Sun-up / Earth-up bitsets over `n` steps.
pub fn coarse_metrics(sun: &[u64], earth: &[u64], n: usize, step_s: f64) -> Metrics {
    let h = step_s / 3600.0;
    let both: Vec<u64> = sun.iter().zip(earth).map(|(a, b)| a & b).collect();
    let sc = popcount(sun);
    let mut m = Metrics::new();
    m.insert("sun_hours".into(), sc as f64 * h);
    m.insert("sun_frac".into(), sc as f64 / n.max(1) as f64);
    m.insert("earth_hours".into(), popcount(earth) as f64 * h);
    m.insert("both_hours".into(), popcount(&both) as f64 * h);
    m.insert("longest_sun_h".into(), longest_run(sun, n, false) as f64 * h);
    m.insert("longest_dark_h".into(), longest_run(sun, n, true) as f64 * h);
    m.insert("longest_earth_h".into(), longest_run(earth, n, false) as f64 * h);
    m.insert("longest_no_earth_h".into(), longest_run(earth, n, true) as f64 * h);
    m.insert("longest_both_h".into(), longest_run(&both, n, false) as f64 * h);
    m
}
