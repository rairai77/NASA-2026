//! Lunar landing-site navigator compute engine.
//!
//! Pure compute: Sun/Earth ephemeris lookup, terrain horizon march, visibility
//! series, window metrics, index ranking, landing-ellipse sampling. Hosts push
//! data in (Python via PyO3, browser via wasm-bindgen).
pub mod bindings;
pub mod comms;
pub mod engine;
pub mod ephem;
pub mod error;
pub mod geo;
pub mod global;
pub mod grid;
pub mod heights;
pub mod horizon;
pub mod index;
pub mod metrics;
#[cfg(feature = "python")]
pub mod native_io;
pub mod par;
pub mod patch;
pub mod power;
pub mod query;
pub mod rank;
pub mod terrain;
pub mod traverse;
pub mod visibility;

#[cfg(test)]
mod tests;

pub use engine::Engine;
pub use error::{EngineError, Res};
