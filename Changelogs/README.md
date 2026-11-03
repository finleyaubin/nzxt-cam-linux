Each release's notes live here as `v<VERSION>.md`, where `<VERSION>` matches `version` in `src-tauri/Cargo.toml` and the git tag (`v1.1.0` → `v1.1.0.md`).

Add the file **before** pushing the tag. The release workflow (`.github/workflows/release.yml`) fails if it is missing, and uses it as the body of the GitHub release.
