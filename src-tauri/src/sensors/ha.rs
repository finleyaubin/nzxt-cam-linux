//! Home Assistant numeric entities as sensors, polled from /api/states by a background thread.

use parking_lot::{Mutex, RwLock};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;
use std::thread::{self, Thread};
use std::time::Duration;

pub const PREFIX: &str = "ha:";
const POLL: Duration = Duration::from_secs(5);
const DOMAINS: &[&str] = &["sensor.", "number.", "input_number."];

struct Entity {
    label: String,
    unit: &'static str,
    value: f64,
}

static CONFIG: RwLock<Option<(String, String)>> = RwLock::new(None);
static ENTITIES: RwLock<Vec<(String, Entity)>> = RwLock::new(Vec::new());
static UNITS: Mutex<Option<HashSet<&'static str>>> = Mutex::new(None);
static POLLER: OnceLock<Thread> = OnceLock::new();

pub fn configure(url: &str, token: &str) {
    let url = url.trim().trim_end_matches('/');
    let valid = (url.starts_with("http://") || url.starts_with("https://")) && !token.trim().is_empty();
    *CONFIG.write() = valid.then(|| (url.to_string(), token.trim().to_string()));
    ENTITIES.write().clear();
    let poller = POLLER.get_or_init(|| thread::spawn(poll_forever).thread().clone());
    poller.unpark();
}

pub fn configured() -> bool {
    CONFIG.read().is_some()
}

fn poll_forever() {
    loop {
        if let Err(e) = refresh() {
            log::warn!("Home Assistant: {e}");
        }
        thread::park_timeout(POLL);
    }
}

pub fn refresh() -> Result<(), String> {
    let Some((url, token)) = CONFIG.read().clone() else { return Ok(()) };
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(5))).build().into();
    let states: Vec<Value> = agent
        .get(format!("{url}/api/states"))
        .header("Authorization", format!("Bearer {token}"))
        .call()
        .map_err(|e| format!("{url}: {e}"))?
        .body_mut()
        .read_json()
        .map_err(|e| format!("{url}: unexpected response: {e}"))?;
    let parsed = parse_states(&states);
    // A reconfigure while the request was in flight must not be overwritten with the old server's data.
    if CONFIG.read().as_ref().is_some_and(|c| c.0 == url) {
        *ENTITIES.write() = parsed;
    }
    Ok(())
}

fn intern(unit: &str) -> &'static str {
    let unit = match unit {
        "°C" | "°F" => "°",
        u => u,
    };
    let mut set = UNITS.lock();
    let set = set.get_or_insert_with(HashSet::new);
    if let Some(&known) = set.get(unit) {
        return known;
    }
    let leaked: &'static str = Box::leak(unit.to_string().into_boxed_str());
    set.insert(leaked);
    leaked
}

fn parse_states(states: &[Value]) -> Vec<(String, Entity)> {
    let mut out: Vec<(String, Entity)> = states
        .iter()
        .filter_map(|s| {
            let id = s["entity_id"].as_str().filter(|id| DOMAINS.iter().any(|d| id.starts_with(d)))?;
            let value: f64 = s["state"].as_str()?.parse().ok().filter(|v: &f64| v.is_finite())?;
            let attrs = &s["attributes"];
            let name = attrs["friendly_name"].as_str().unwrap_or(id);
            let unit = intern(attrs["unit_of_measurement"].as_str().unwrap_or(""));
            Some((id.to_string(), Entity { label: format!("Home Assistant · {name}"), unit, value }))
        })
        .collect();
    out.sort_by(|a, b| a.1.label.cmp(&b.1.label));
    out
}

pub fn list() -> Vec<super::all::Sensor> {
    if configured() && ENTITIES.read().is_empty() {
        let _ = refresh();
    }
    ENTITIES
        .read()
        .iter()
        .map(|(id, e)| super::all::Sensor { id: format!("{PREFIX}{id}"), label: e.label.clone(), unit: e.unit.into() })
        .collect()
}

fn find<T>(id: &str, f: impl FnOnce(&Entity) -> T) -> Option<T> {
    let id = id.strip_prefix(PREFIX)?;
    ENTITIES.read().iter().find(|(e, _)| e == id).map(|(_, e)| f(e))
}

pub fn read(id: &str) -> Option<f64> {
    find(id, |e| e.value)
}

pub fn unit_of(id: &str) -> &'static str {
    find(id, |e| e.unit).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_only_numeric_entities_in_known_domains() {
        let states = vec![
            json!({"entity_id": "sensor.room_temp", "state": "21.5", "attributes": {"friendly_name": "Room", "unit_of_measurement": "°C"}}),
            json!({"entity_id": "sensor.door", "state": "unavailable", "attributes": {}}),
            json!({"entity_id": "light.lamp", "state": "3", "attributes": {}}),
            json!({"entity_id": "number.target", "state": "40", "attributes": {"unit_of_measurement": "%"}}),
        ];
        let parsed = parse_states(&states);
        let ids: Vec<&str> = parsed.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, ["sensor.room_temp", "number.target"]);
        assert_eq!(parsed[0].1.unit, "°");
        assert_eq!(parsed[0].1.label, "Home Assistant · Room");
        assert_eq!(parsed[0].1.value, 21.5);
    }

    #[test]
    fn fetches_with_bearer_token_and_serves_reads() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = conn.read(&mut buf).unwrap();
            let body = r#"[{"entity_id":"sensor.power","state":"412","attributes":{"friendly_name":"Power","unit_of_measurement":"W"}}]"#;
            write!(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            String::from_utf8_lossy(&buf[..n]).to_lowercase()
        });
        configure(&format!("http://127.0.0.1:{port}/"), " secret ");
        let request = server.join().unwrap();
        assert!(request.starts_with("get /api/states ") && request.contains("authorization: bearer secret"), "{request}");
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while read("ha:sensor.power").is_none() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(read("ha:sensor.power"), Some(412.0));
        assert_eq!(unit_of("ha:sensor.power"), "W");
        assert_eq!(list().len(), 1);
        configure("", "");
        assert!(!configured() && read("ha:sensor.power").is_none());
    }

    #[test]
    fn units_are_interned() {
        assert!(std::ptr::eq(intern("kWh"), intern("kWh")));
    }
}
