//! API keys in the desktop Secret Service (GNOME Keyring, KWallet, ...) instead of config.json.

use keyring::Entry;

const SERVICE: &str = "nzxtcam-archlinux-rust";

/// The only secrets the app stores; settings carrying any other name are rejected.
pub const KEY_NAMES: &[&str] = &["giphy", "homeassistant"];

// The Secret Service client blocks on its own runtime, which panics when entered from an async task.
fn off_runtime<T: Send>(op: impl FnOnce() -> Result<T, String> + Send) -> Result<T, String> {
    std::thread::scope(|scope| scope.spawn(op).join().unwrap_or_else(|_| Err("keyring thread panicked".into())))
}

fn entry(name: &str) -> Result<Entry, String> {
    if !KEY_NAMES.contains(&name) {
        return Err(format!("Unknown API key name: {name}"));
    }
    Entry::new(SERVICE, name).map_err(|e| format!("keyring {name}: {e}"))
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    off_runtime(|| match entry(name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring {name}: {e}")),
    })
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    off_runtime(|| entry(name)?.set_password(value).map_err(|e| format!("keyring {name}: {e}")))
}

pub fn delete(name: &str) -> Result<(), String> {
    off_runtime(|| match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring {name}: {e}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "needs a running Secret Service; run with --ignored"]
    fn roundtrip_through_the_system_keyring() {
        set("giphy", "test-value").unwrap();
        assert_eq!(get("giphy").unwrap().as_deref(), Some("test-value"));
        delete("giphy").unwrap();
        assert_eq!(get("giphy").unwrap(), None);
    }

    #[test]
    fn unknown_names_are_rejected() {
        assert!(set("other", "x").is_err());
    }
}
