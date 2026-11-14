//! Error type shared by the core and the bindings.
use std::fmt;

#[derive(Debug, Clone)]
pub struct EngineError(pub String);

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for EngineError {}
impl From<serde_json::Error> for EngineError {
    fn from(e: serde_json::Error) -> Self {
        EngineError(format!("json: {e}"))
    }
}
impl From<String> for EngineError {
    fn from(s: String) -> Self {
        EngineError(s)
    }
}
impl From<&str> for EngineError {
    fn from(s: &str) -> Self {
        EngineError(s.to_string())
    }
}

pub type Res<T> = Result<T, EngineError>;

#[macro_export]
macro_rules! bail {
    ($($t:tt)*) => { return Err($crate::error::EngineError(format!($($t)*))) };
}
