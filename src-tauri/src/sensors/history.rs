//! Rolling per-metric history that feeds graph elements on the LCD.
//!
//! Sampled opportunistically from `read_temperatures` (rate-limited to one sample per second), so it
//! fills whether the LCD loop, the UI poller or the preview is the one asking for readings.

use crate::types::{MetricId, Temperatures};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

const SAMPLE_EVERY: Duration = Duration::from_secs(1);
/// Longest graph window the editor offers.
pub const MAX_SECONDS: usize = 600;

struct Log {
    last_at: Option<Instant>,
    samples: VecDeque<Temperatures>,
    /// Total samples ever taken; lets the LCD loop notice that a graph has moved on.
    count: u64,
}

static LOG: Mutex<Log> = Mutex::new(Log { last_at: None, samples: VecDeque::new(), count: 0 });

pub fn record(t: Temperatures) {
    let mut log = LOG.lock();
    if log.last_at.is_some_and(|at| at.elapsed() < SAMPLE_EVERY) {
        return;
    }
    log.last_at = Some(Instant::now());
    log.count += 1;
    log.samples.push_back(t);
    while log.samples.len() > MAX_SECONDS {
        log.samples.pop_front();
    }
}

/// Oldest-to-newest values of `metric` over the last `seconds` seconds.
pub fn series(metric: MetricId, seconds: usize) -> Vec<f64> {
    let log = LOG.lock();
    let skip = log.samples.len().saturating_sub(seconds);
    log.samples.iter().skip(skip).map(|t| metric.value_from(*t)).collect()
}

pub fn version() -> u64 {
    LOG.lock().count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn series_is_rate_limited_and_windowed() {
        let at = |cpu| Temperatures { cpu, ..Temperatures::default() };
        record(at(10.0));
        record(at(20.0)); // inside the same second: dropped
        let s = series(MetricId::Cpu, 5);
        assert_eq!(s.last(), Some(&10.0));
        assert!(series(MetricId::Cpu, 0).is_empty());
    }
}
