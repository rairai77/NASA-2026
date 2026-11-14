//! Tiny parallel helpers: rayon with the `parallel` feature, sequential otherwise.

#[cfg(feature = "parallel")]
pub fn pmap<T: Sync, U: Send, F: Fn(&T) -> U + Sync + Send>(v: &[T], f: F) -> Vec<U> {
    use rayon::prelude::*;
    v.par_iter().map(f).collect()
}
#[cfg(not(feature = "parallel"))]
pub fn pmap<T, U, F: Fn(&T) -> U>(v: &[T], f: F) -> Vec<U> {
    v.iter().map(f).collect()
}

#[cfg(feature = "parallel")]
pub fn pchunks_mut<T: Send, F: Fn(usize, &mut [T]) + Sync + Send>(data: &mut [T], chunk: usize, f: F) {
    use rayon::prelude::*;
    data.par_chunks_mut(chunk).enumerate().for_each(|(i, c)| f(i, c));
}
#[cfg(not(feature = "parallel"))]
pub fn pchunks_mut<T, F: Fn(usize, &mut [T])>(data: &mut [T], chunk: usize, f: F) {
    data.chunks_mut(chunk).enumerate().for_each(|(i, c)| f(i, c));
}

#[cfg(feature = "parallel")]
pub fn pchunks2_mut<T: Send, F: Fn(usize, &mut [T], &mut [T]) + Sync + Send>(a: &mut [T], b: &mut [T], chunk: usize, f: F) {
    use rayon::prelude::*;
    a.par_chunks_mut(chunk).zip(b.par_chunks_mut(chunk)).enumerate().for_each(|(i, (x, y))| f(i, x, y));
}
#[cfg(not(feature = "parallel"))]
pub fn pchunks2_mut<T, F: Fn(usize, &mut [T], &mut [T])>(a: &mut [T], b: &mut [T], chunk: usize, f: F) {
    a.chunks_mut(chunk).zip(b.chunks_mut(chunk)).enumerate().for_each(|(i, (x, y))| f(i, x, y));
}
