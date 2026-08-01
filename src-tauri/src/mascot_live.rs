//! Live mascot video: turns each read-aloud audio clip into a 512x512
//! talking-head video via SoulX-FlashHead, streamed to the mascot stage's
//! `live` state *while it generates*.
//!
//! A resident `stream_live.py` process loads the distilled `lite` model once
//! (2 denoise steps so generation outruns the 25 fps playback on the 8 GB
//! laptop 4060) and serves `generate` requests over a line protocol:
//!
//! - Rust → Python: `{"cmd":"generate","wav":...,"out_dir":...,"run":N}\n`
//! - Python → Rust: one JSON line per event: `ready` / `segment {run,path}` /
//!   `done` / `error`.
//!
//! Each segment is an mp4 with its own AAC track (the 16 kHz audio slice that
//! drove it), so the frontend plays sight *and* sound from the video element.
//! The TTS MP3 is transcoded to a 16 kHz mono WAV first; the resident process
//! deletes it once the generation consumes it. The whole pipeline is
//! best-effort — a dead GPU or failed transcode only logs and emits an error
//! event, never fails the read-aloud turn itself.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command as TokioCommand};
use tokio::sync::Mutex;

/// Frontend event fired for every playable segment of the current live clip;
/// the payload is a [`LiveSegment`].
pub const MASCOT_LIVE_SEGMENT_EVENT: &str = "thuki://mascot-live-segment";
/// Frontend event fired when the live pipeline errors or the resident process
/// dies; the stage should drop back to `idle`.
pub const MASCOT_LIVE_ERROR_EVENT: &str = "thuki://mascot-live-error";
/// TTS audio is resampled to the mono 16 kHz the model expects.
const LIVE_SAMPLE_RATE_HZ: &str = "16000";

/// A playable segment of the current run: `run` groups segments of one
/// read-aloud clip (bumped per generation), `path` is the mp4 to play.
#[derive(Clone, Serialize)]
pub struct LiveSegment {
    pub run: u64,
    pub path: String,
}

/// Resident streamer bookkeeping. The process is spawned lazily on first
/// use; the `loading` flag tracks whether the model has reported `ready`.
struct LiveStreamer {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    run: u64,
    loading: bool,
}

/// Global streamer state. A `MutexGuard<'static, LiveStreamer>` is what lets
/// the spawned stdout-reader task mutate the shared state after the caller
/// drops its guard.
fn live_streamer_state() -> &'static Mutex<LiveStreamer> {
    static STATE: OnceLock<Mutex<LiveStreamer>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(LiveStreamer {
            child: None,
            stdin: None,
            run: 0,
            loading: false,
        })
    })
}

/// SoulX-FlashHead project root (`~/Code/Llm/SoulX-FlashHead`).
pub fn flashhead_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join("Code")
        .join("Llm")
        .join("SoulX-FlashHead")
}

/// The resident `stream_live.py` bundled with the app.
fn stream_script_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("stream_live.py")
}

/// Condition headshot fed to SoulX-FlashHead. Prefers the app's
/// `public/girl.png`; falls back to the FlashHead example (the same image in
/// practice).
pub fn cond_image_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|root| root.join("public").join("girl.png"))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| flashhead_dir().join("examples").join("girl.png"))
}

/// Where generated live segments land (`app_data_dir/live/`).
pub fn live_output_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("live")
}

/// Transcodes the Edge TTS MP3 to the mono 16 kHz WAV FlashHead reads.
#[cfg_attr(coverage_nightly, coverage(off))]
async fn transcode_to_wav(mp3: &Path, wav: &Path) -> Result<(), String> {
    let status = TokioCommand::new("ffmpeg")
        .args(["-y", "-i"])
        .arg(mp3)
        .args(["-ar", LIVE_SAMPLE_RATE_HZ, "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(wav)
        .status()
        .await
        .map_err(|e| format!("live: spawn ffmpeg: {e}"))?;
    if !status.success() {
        return Err(format!("live: ffmpeg exited with {status}"));
    }
    Ok(())
}

/// The resident Python command: `stream_live.py` under the FlashHead venv,
/// stdin/stdout piped for the line protocol.
#[cfg_attr(coverage_nightly, coverage(off))]
fn streamer_command() -> TokioCommand {
    let mut cmd = TokioCommand::new(flashhead_dir().join(".venv").join("bin").join("python"));
    cmd.arg(stream_script_path());
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.env("CUDA_VISIBLE_DEVICES", "0");
    cmd
}

/// Tears the resident process down (EOF on stdout, or a fatal load error).
async fn reset_streamer() {
    let mut state = live_streamer_state().lock().await;
    if let Some(mut child) = state.child.take() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    state.stdin = None;
    state.loading = false;
}

/// Handles one stdout line from the resident process, forwarding segments and
/// surfacing errors to the frontend.
async fn handle_streamer_line(app: &AppHandle, line: &str) {
    let Ok(msg) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    match msg.get("event").and_then(|e| e.as_str()) {
        Some("ready") => {
            live_streamer_state().lock().await.loading = false;
        }
        Some("segment") => {
            let (Some(run), Some(path)) = (
                msg.get("run").and_then(|r| r.as_u64()),
                msg.get("path").and_then(|p| p.as_str()),
            ) else {
                return;
            };
            let _ = app.emit(
                MASCOT_LIVE_SEGMENT_EVENT,
                LiveSegment {
                    run,
                    path: path.to_string(),
                },
            );
        }
        Some("done") => {
            // Generation consumed the wav; nothing else to forward.
        }
        Some("error") => {
            let msg = msg
                .get("msg")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown error");
            eprintln!("[live] streamer error: {msg}");
            // A load error kills the service; drop it so the next request
            // respawns it. Per-run errors leave the process alive.
            if msg.starts_with("load:") {
                reset_streamer().await;
            }
            let _ = app.emit(MASCOT_LIVE_ERROR_EVENT, msg.to_string());
        }
        _ => {}
    }
}

/// Spawns the resident process if needed and starts the stdout reader. The
/// reader marks the process dead on EOF so the next request respawns it.
#[cfg_attr(coverage_nightly, coverage(off))]
async fn ensure_streamer(app: &AppHandle) -> Result<(), String> {
    let mut state = live_streamer_state().lock().await;
    if state.child.is_some() {
        return Ok(());
    }
    let mut child = streamer_command()
        .spawn()
        .map_err(|e| format!("live: spawn streamer: {e}"))?;
    let stdin = child.stdin.take().ok_or("live: no stdin")?;
    let stdout = child.stdout.take().ok_or("live: no stdout")?;
    state.child = Some(child);
    state.stdin = Some(stdin);
    state.loading = true;

    let app = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => handle_streamer_line(&app, &line).await,
                Ok(None) => break,
                Err(_) => break,
            }
        }
        // EOF: the process died. Clear state and tell the frontend the live
        // show is over (next request respawns the streamer).
        reset_streamer().await;
        let _ = app.emit(MASCOT_LIVE_ERROR_EVENT, "streamer exited".to_string());
    });
    Ok(())
}

/// Kicks off live-video generation for a finished read-aloud clip, taking
/// ownership of the WAV lifecycle (the resident process deletes it once
/// consumed). Serialized by the streamer's single-threaded request loop.
#[cfg_attr(coverage_nightly, coverage(off))]
pub async fn start_live_generation(app: &AppHandle, wav_path: &Path) -> Result<(), String> {
    ensure_streamer(app).await?;
    let mut state = live_streamer_state().lock().await;
    state.run += 1;
    let run = state.run;
    let request = serde_json::json!({
        "cmd": "generate",
        "wav": wav_path.to_string_lossy().into_owned(),
        "out_dir": live_output_dir(app).to_string_lossy().into_owned(),
        "run": run,
    })
    .to_string();
    let stdin = state.stdin.as_mut().ok_or("live: streamer stdin closed")?;
    stdin
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("live: write request: {e}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| format!("live: write request: {e}"))?;
    Ok(())
}

/// Transcodes `mp3` to a uniquely-named 16 kHz WAV and hands it to the
/// resident streamer. Returns the wav path on success (deleted by the
/// streamer when consumed).
#[cfg_attr(coverage_nightly, coverage(off))]
pub async fn trigger_live_generation(app: &AppHandle, mp3_path: &Path) {
    let out_dir = live_output_dir(app);
    let _ = std::fs::create_dir_all(&out_dir);
    let wav_path = out_dir.join(format!("live-{}.wav", uuid::Uuid::new_v4()));
    if let Err(e) = transcode_to_wav(mp3_path, &wav_path).await {
        eprintln!("[live] transcode failed: {e}");
        let _ = std::fs::remove_file(mp3_path);
        return;
    }
    let _ = std::fs::remove_file(mp3_path);
    if let Err(e) = start_live_generation(app, &wav_path).await {
        eprintln!("[live] start generation failed: {e}");
        let _ = std::fs::remove_file(&wav_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flashhead_dir_points_at_sibling_project() {
        let dir = flashhead_dir();
        assert!(dir.ends_with("Code/Llm/SoulX-FlashHead"));
    }

    #[test]
    fn cond_image_path_resolves_to_an_existing_file() {
        let path = cond_image_path();
        assert!(path.is_file(), "cond image must exist at {path:?}");
        assert_eq!(path.file_name().unwrap(), "girl.png");
    }

    #[test]
    fn stream_script_path_resolves_beside_the_binary() {
        let path = stream_script_path();
        assert!(path.ends_with("src-tauri/scripts/stream_live.py"));
        assert!(path.is_file(), "bundled script must exist at {path:?}");
    }

    #[test]
    fn live_segment_serializes_run_and_path() {
        let json = serde_json::to_string(&LiveSegment {
            run: 3,
            path: "/tmp/seg_3_0000.mp4".to_string(),
        })
        .unwrap();
        assert!(json.contains("\"run\":3"));
        assert!(json.contains("\"path\":\"/tmp/seg_3_0000.mp4\""));
    }
}
