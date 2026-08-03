//! Live mascot video: turns each read-aloud audio clip into a 512x512
//! talking-head video via SoulX-FlashHead, streamed to the mascot stage's
//! `live` state *while it generates*.
//!
//! Generation runs over the FlashHead HTTP service
//! (`uvicorn flash_head_server.main:app`, port 8000, launched from the
//! `~/Code/Agent/SoulX-FlashHead` checkout). The service loads the distilled
//! `lite` model once and stays resident; this module is its client, with two
//! playout modes:
//!
//! - **stream** ([`LiveMode::Stream`], `POST /stream-events`): the server
//!   generates chunk-by-chunk and streams newline-delimited JSON, one
//!   base64-encoded playable mp4 segment per event. Each segment lands on
//!   disk and is forwarded to the frontend the moment it is encoded, so the
//!   mascot starts talking as soon as the first ~3 s of video exists while
//!   the rest renders behind it.
//! - **full** ([`LiveMode::Full`], `POST /generate`): the server renders the
//!   entire reply before answering; the complete mp4 is returned and played
//!   as a single segment. Slower to start, but the video is fully rendered,
//!   higher quality can be afforded, and playback never has to hold frames.
//!
//! If nothing is listening on 8000 the service is spawned from the FlashHead
//! venv and kept resident (model load included), so ncopy never blocks on a
//! cold model and one model instance serves the whole app. The pipeline is
//! best-effort — a dead GPU or failed request only logs and emits an error
//! event, never fails the read-aloud turn itself.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use base64::Engine;
use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::Mutex;

/// Frontend event fired for every playable segment of the current live clip;
/// the payload is a [`LiveSegment`].
pub const MASCOT_LIVE_SEGMENT_EVENT: &str = "thuki://mascot-live-segment";
/// Frontend event fired with the run's total audio duration (`{run,
/// total_secs}`) before its first segment, so the frontend can size its
/// pre-roll buffer.
pub const MASCOT_LIVE_META_EVENT: &str = "thuki://mascot-live-meta";
/// Frontend event fired when the pipeline has no more segments coming for the
/// current run; the payload is the `run` number.
pub const MASCOT_LIVE_DONE_EVENT: &str = "thuki://mascot-live-done";
/// Frontend event fired when the live pipeline errors or the service dies;
/// the stage should drop back to `idle`.
pub const MASCOT_LIVE_ERROR_EVENT: &str = "thuki://mascot-live-error";

/// Base URL of the FlashHead HTTP service.
const LIVE_SERVER_URL: &str = "http://127.0.0.1:8000";
/// Health endpoint; 200 means the model finished loading (uvicorn's lifespan
/// completes the `FlashHeadService::init` before it accepts any request).
const LIVE_SERVER_HEALTH_URL: &str = "http://127.0.0.1:8000/health";
/// Condition headshot seed, mirroring the resident script's `base_seed=42`.
const LIVE_SEED: u64 = 42;
/// How long to wait for a freshly spawned service (model load included).
const SERVER_SPAWN_TIMEOUT: Duration = Duration::from_secs(180);

/// A playable segment of the current run: `run` groups segments of one
/// read-aloud clip (bumped per generation), `path` is the mp4 to play and
/// `dur_secs` its content duration.
#[derive(Clone, Serialize)]
pub struct LiveSegment {
    pub run: u64,
    pub path: String,
    pub dur_secs: f64,
}

/// Metadata for one run, emitted before its first segment: `run` groups the
/// clip, `total_secs` is the full audio duration the segments will cover.
#[derive(Clone, Serialize)]
pub struct LiveMeta {
    pub run: u64,
    pub total_secs: f64,
}

/// How the current reply is generated: `Stream` renders chunk-by-chunk and
/// plays as soon as the first segment exists; `Full` renders the entire reply
/// before a single video is played.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LiveMode {
    Stream,
    Full,
}

impl LiveMode {
    /// Parses a mode from the `[voice].live_mode` config value. Unknown
    /// values fall back to `Stream` (the default playout).
    pub fn parse(value: &str) -> LiveMode {
        match value.trim().to_ascii_lowercase().as_str() {
            "full" | "complete" | "once" => LiveMode::Full,
            _ => LiveMode::Stream,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            LiveMode::Stream => "stream",
            LiveMode::Full => "full",
        }
    }
}

/// Denoise steps for live generation. 2 keeps generation ahead of the 25 fps
/// playback rate on an 8 GB 4060 (matches the old resident script's
/// `THUKI_LIVE_STEPS` default); raise for cleaner output on faster GPUs.
fn live_sample_steps() -> u32 {
    std::env::var("THUKI_LIVE_STEPS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2)
}

/// Resident HTTP-service bookkeeping. The process is spawned lazily on first
/// use; `run` groups the current generation.
struct LiveServer {
    child: Option<Child>,
    run: u64,
}

/// Global service state.
fn live_server_state() -> &'static Mutex<LiveServer> {
    static STATE: OnceLock<Mutex<LiveServer>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(LiveServer {
            child: None,
            run: 0,
        })
    })
}

/// Serializes generations: one GPU, one resident model — a second concurrent
/// request would only contend for the same device.
fn live_request_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Shared HTTP client (connection pooling keeps multipart uploads cheap).
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

/// SoulX-FlashHead project root. Lives under `~/Code/Agent` in this dev
/// checkout; the older `~/Code/Llm` location is honored as a fallback.
pub fn flashhead_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    for rel in ["Code/Agent/SoulX-FlashHead", "Code/Llm/SoulX-FlashHead"] {
        let candidate = home.join(rel);
        if candidate
            .join("flash_head_server")
            .join("main.py")
            .is_file()
        {
            return candidate;
        }
    }
    home.join("Code").join("Agent").join("SoulX-FlashHead")
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
pub(crate) async fn transcode_to_wav(mp3: &Path, wav: &Path) -> Result<(), String> {
    let status = TokioCommand::new("ffmpeg")
        .args(["-y", "-i"])
        .arg(mp3)
        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(wav)
        .status()
        .await
        .map_err(|e| format!("live: spawn ffmpeg: {e}"))?;
    if !status.success() {
        return Err(format!("live: ffmpeg exited with {status}"));
    }
    Ok(())
}

/// True when the FlashHead service answers `/health`.
async fn server_alive() -> bool {
    match http_client()
        .get(LIVE_SERVER_HEALTH_URL)
        .timeout(Duration::from_secs(1))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// The uvicorn command running from the FlashHead venv at the project root.
#[cfg_attr(coverage_nightly, coverage(off))]
fn server_command() -> TokioCommand {
    let mut cmd = TokioCommand::new(flashhead_dir().join(".venv").join("bin").join("python"));
    cmd.arg("-m")
        .arg("uvicorn")
        .arg("flash_head_server.main:app")
        .args([
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
            "--log-level",
            "warning",
        ]);
    // The server's model/config paths are relative to the project root.
    cmd.current_dir(flashhead_dir());
    cmd.stdin(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());
    cmd.env("CUDA_VISIBLE_DEVICES", "0");
    // The venv's editable-install `.pth` can point at a stale checkout
    // location; the `src/` layout is authoritative, so make it importable
    // regardless of the venv bookkeeping.
    let src = flashhead_dir().join("src");
    if src.is_dir() {
        cmd.env("PYTHONPATH", src);
    }
    cmd
}

/// Tears the resident service down (used on spawn failure).
async fn reset_server() {
    let mut state = live_server_state().lock().await;
    if let Some(mut child) = state.child.take() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

/// Makes sure a FlashHead service is answering on port 8000, spawning it from
/// the FlashHead venv if nothing is there yet (model load included), then
/// waits for `/health` to go green.
#[cfg_attr(coverage_nightly, coverage(off))]
async fn ensure_server() -> Result<(), String> {
    if server_alive().await {
        return Ok(());
    }
    let mut state = live_server_state().lock().await;
    if state.child.is_none() {
        let mut child = server_command()
            .spawn()
            .map_err(|e| format!("live: spawn uvicorn: {e}"))?;
        // Forward the service's stderr to our log for debugging model-load
        // failures; the process itself is otherwise unmanaged.
        let stderr = child.stderr.take();
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    eprintln!("[live] server: {line}");
                }
            });
        }
        state.child = Some(child);
    }
    drop(state);

    let deadline = Instant::now() + SERVER_SPAWN_TIMEOUT;
    while Instant::now() < deadline {
        if server_alive().await {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(800)).await;
    }
    // The spawn never became healthy; drop it so the next request retries.
    reset_server().await;
    Err("live: FlashHead server did not become healthy".to_string())
}

/// Builds the multipart form the server endpoints expect (`image` + `audio`).
async fn multipart_form(
    image_path: &Path,
    wav_path: &Path,
) -> Result<reqwest::multipart::Form, String> {
    let img_bytes = tokio::fs::read(image_path)
        .await
        .map_err(|e| format!("live: read cond image: {e}"))?;
    let img_ext = image_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    let img_mime = match img_ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let image = reqwest::multipart::Part::bytes(img_bytes)
        .file_name(format!("cond.{img_ext}"))
        .mime_str(img_mime)
        .map_err(|e| format!("live: cond mime: {e}"))?;

    let audio_bytes = tokio::fs::read(wav_path)
        .await
        .map_err(|e| format!("live: read wav: {e}"))?;
    let audio = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("live: wav mime: {e}"))?;

    Ok(reqwest::multipart::Form::new()
        .part("image", image)
        .part("audio", audio))
}

/// Parses the total seconds of a 16 kHz mono PCM WAV (`ffmpeg`-transcoded by
/// [`crate::voice`]) from its RIFF header. Returns `0.0` for anything
/// unparseable so the frontend still gets a `meta` event to open its gate.
fn parse_wav_seconds(bytes: &[u8]) -> f64 {
    let Some(data_size) = wav_data_bytes(bytes) else {
        return 0.0;
    };
    let (sample_rate, channels, bits) = wav_format(bytes);
    let bytes_per_frame = channels.max(1) * bits.max(1) / 8;
    if sample_rate == 0 || bytes_per_frame == 0 {
        return 0.0;
    }
    data_size as f64 / (sample_rate as f64 * bytes_per_frame as f64)
}

/// Walks the RIFF chunk list and returns the `data` chunk size.
fn wav_data_bytes(bytes: &[u8]) -> Option<u64> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        if id == b"data" {
            return Some(size as u64);
        }
        offset += 8 + size + (size & 1); // chunks are word-aligned
    }
    None
}

/// Reads `(sample_rate, channels, bits_per_sample)` from the `fmt ` chunk.
fn wav_format(bytes: &[u8]) -> (u32, u16, u16) {
    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap_or([0u8; 4]))
            as usize;
        if id == b"fmt " && offset + 8 + 16 <= bytes.len() {
            let fmt = &bytes[offset + 8..offset + 8 + 16];
            let sample_rate = u32::from_le_bytes(fmt[4..8].try_into().unwrap_or([0u8; 4]));
            let channels = u16::from_le_bytes(fmt[2..4].try_into().unwrap_or([0u8; 2]));
            let bits = u16::from_le_bytes(fmt[14..16].try_into().unwrap_or([0u8; 2]));
            return (sample_rate, channels, bits);
        }
        offset += 8 + size + (size & 1);
    }
    (0, 0, 0)
}

/// Total seconds of a WAV on disk (best-effort; `0.0` if unreadable).
#[cfg_attr(coverage_nightly, coverage(off))]
async fn wav_total_secs(path: &Path) -> f64 {
    match tokio::fs::read(path).await {
        Ok(bytes) => parse_wav_seconds(&bytes),
        Err(_) => 0.0,
    }
}

/// Streams one reply (`/stream-events`): each complete base64 segment is
/// written to disk and forwarded to the frontend the moment it arrives.
#[cfg_attr(coverage_nightly, coverage(off))]
async fn stream_run(app: &AppHandle, run: u64, wav_path: &Path) -> Result<(), String> {
    let steps = live_sample_steps();
    let resp = http_client()
        .post(format!(
            "{LIVE_SERVER_URL}/stream-events?seed={LIVE_SEED}&sample_steps={steps}"
        ))
        .multipart(multipart_form(&cond_image_path(), wav_path).await?)
        .send()
        .await
        .map_err(|e| format!("live: stream-events request: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("live: stream-events HTTP {status}: {body}"));
    }

    let out_dir = live_output_dir(app);
    let _ = std::fs::create_dir_all(&out_dir);
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut segment_idx: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("live: stream recv: {e}"))?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line[..line.len() - 1]);
            if line.trim().is_empty() {
                continue;
            }
            let Ok(msg) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
                continue;
            };
            match msg.get("event").and_then(|e| e.as_str()) {
                Some("meta") => {
                    let total_secs = msg
                        .get("total_secs")
                        .and_then(|t| t.as_f64())
                        .unwrap_or(0.0);
                    let _ = app.emit(MASCOT_LIVE_META_EVENT, LiveMeta { run, total_secs });
                }
                Some("segment") => {
                    let data = msg.get("data").and_then(|d| d.as_str()).unwrap_or("");
                    let dur_secs = msg.get("dur_secs").and_then(|d| d.as_f64()).unwrap_or(0.0);
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(data)
                        .map_err(|e| format!("live: segment base64: {e}"))?;
                    let path = out_dir.join(format!("live-{run}-{segment_idx:04}.mp4"));
                    tokio::fs::write(&path, &bytes)
                        .await
                        .map_err(|e| format!("live: write segment: {e}"))?;
                    let _ = app.emit(
                        MASCOT_LIVE_SEGMENT_EVENT,
                        LiveSegment {
                            run,
                            path: path.to_string_lossy().into_owned(),
                            dur_secs,
                        },
                    );
                    segment_idx += 1;
                }
                Some("done") => {
                    let _ = app.emit(MASCOT_LIVE_DONE_EVENT, run);
                }
                Some("error") => {
                    let msg = msg
                        .get("msg")
                        .and_then(|m| m.as_str())
                        .unwrap_or("stream error");
                    return Err(format!("live: server: {msg}"));
                }
                _ => {}
            }
        }
    }
    // Stream ended cleanly (or the connection dropped); close the run.
    let _ = app.emit(MASCOT_LIVE_DONE_EVENT, run);
    Ok(())
}

/// Renders one reply completely (`/generate`) and plays the single mp4.
#[cfg_attr(coverage_nightly, coverage(off))]
async fn full_run(app: &AppHandle, run: u64, wav_path: &Path) -> Result<(), String> {
    let total_secs = wav_total_secs(wav_path).await;
    let _ = app.emit(MASCOT_LIVE_META_EVENT, LiveMeta { run, total_secs });

    let steps = live_sample_steps();
    let resp = http_client()
        .post(format!(
            "{LIVE_SERVER_URL}/generate?seed={LIVE_SEED}&sample_steps={steps}"
        ))
        .multipart(multipart_form(&cond_image_path(), wav_path).await?)
        .send()
        .await
        .map_err(|e| format!("live: generate request: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("live: generate HTTP {status}: {body}"));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("live: read video: {e}"))?;
    let out_dir = live_output_dir(app);
    let _ = std::fs::create_dir_all(&out_dir);
    let path = out_dir.join(format!("live-{run}-full.mp4"));
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| format!("live: write video: {e}"))?;
    let _ = app.emit(
        MASCOT_LIVE_SEGMENT_EVENT,
        LiveSegment {
            run,
            path: path.to_string_lossy().into_owned(),
            dur_secs: total_secs,
        },
    );
    let _ = app.emit(MASCOT_LIVE_DONE_EVENT, run);
    Ok(())
}

/// Kicks off live-video generation for a finished read-aloud clip in the
/// given [`LiveMode`], taking ownership of the WAV lifecycle (deleted once the
/// service consumed it). Serialized by the single-model request lock.
#[cfg_attr(coverage_nightly, coverage(off))]
pub async fn start_live_generation(
    app: &AppHandle,
    wav_path: &Path,
    mode: LiveMode,
) -> Result<(), String> {
    ensure_server().await?;
    let _guard = live_request_lock().lock().await;
    let mut state = live_server_state().lock().await;
    state.run += 1;
    let run = state.run;
    drop(state);

    match mode {
        LiveMode::Stream => stream_run(app, run, wav_path).await,
        LiveMode::Full => full_run(app, run, wav_path).await,
    }
}

/// Transcodes `mp3` to a uniquely-named 16 kHz WAV and hands it to the FlashHead
/// service. Returns the wav path on success (deleted when the generation
/// consumes it).
#[cfg_attr(coverage_nightly, coverage(off))]
pub async fn trigger_live_generation(app: &AppHandle, mp3_path: &Path, mode: LiveMode) {
    let out_dir = live_output_dir(app);
    let _ = std::fs::create_dir_all(&out_dir);
    let wav_path = out_dir.join(format!("live-{}.wav", uuid::Uuid::new_v4()));
    if let Err(e) = transcode_to_wav(mp3_path, &wav_path).await {
        eprintln!("[live] transcode failed: {e}");
        let _ = std::fs::remove_file(mp3_path);
        return;
    }
    let _ = std::fs::remove_file(mp3_path);
    if let Err(e) = start_live_generation(app, &wav_path, mode).await {
        eprintln!("[live] generation failed ({mode:?}): {e}");
        let _ = app.emit(MASCOT_LIVE_ERROR_EVENT, e);
        let _ = std::fs::remove_file(&wav_path);
    } else {
        let _ = std::fs::remove_file(&wav_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flashhead_dir_points_at_the_sibling_project() {
        let dir = flashhead_dir();
        assert!(dir.ends_with("SoulX-FlashHead"), "dir was {dir:?}");
        assert!(
            dir.join("flash_head_server").join("main.py").is_file(),
            "flash_head_server/main.py must exist at {dir:?}"
        );
    }

    #[test]
    fn cond_image_path_resolves_to_an_existing_file() {
        let path = cond_image_path();
        assert!(path.is_file(), "cond image must exist at {path:?}");
        assert_eq!(path.file_name().unwrap(), "girl.png");
    }

    #[test]
    fn live_mode_parse_maps_known_and_unknown_values() {
        assert_eq!(LiveMode::parse("full"), LiveMode::Full);
        assert_eq!(LiveMode::parse(" FULL "), LiveMode::Full);
        assert_eq!(LiveMode::parse("complete"), LiveMode::Full);
        assert_eq!(LiveMode::parse("stream"), LiveMode::Stream);
        assert_eq!(LiveMode::parse(""), LiveMode::Stream);
        assert_eq!(LiveMode::parse("garbage"), LiveMode::Stream);
    }

    #[test]
    fn live_mode_as_str_roundtrips() {
        assert_eq!(LiveMode::Stream.as_str(), "stream");
        assert_eq!(LiveMode::Full.as_str(), "full");
    }

    #[test]
    fn live_segment_serializes_run_path_and_duration() {
        let json = serde_json::to_string(&LiveSegment {
            run: 3,
            path: "/tmp/seg_3_0000.mp4".to_string(),
            dur_secs: 2.88,
        })
        .unwrap();
        assert!(json.contains("\"run\":3"));
        assert!(json.contains("\"path\":\"/tmp/seg_3_0000.mp4\""));
        assert!(json.contains("\"dur_secs\":2.88"));
    }

    #[test]
    fn parse_wav_seconds_reads_a_16khz_mono_wav() {
        // Minimal RIFF header: WAVE + fmt (PCM, 1 ch, 16000 Hz, 16 bit) +
        // data chunk of 16000 frames == 1 second.
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&36u32.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&1u16.to_le_bytes()); // mono
        wav.extend_from_slice(&16000u32.to_le_bytes()); // sample rate
        wav.extend_from_slice(&32000u32.to_le_bytes()); // byte rate
        wav.extend_from_slice(&2u16.to_le_bytes()); // block align
        wav.extend_from_slice(&16u16.to_le_bytes()); // bits
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(16000u32 * 2).to_le_bytes());
        wav.extend_from_slice(&vec![0u8; 16000 * 2]);
        assert_eq!(parse_wav_seconds(&wav), 1.0);
    }

    #[test]
    fn parse_wav_seconds_handles_stereo_and_garbage() {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&36u32.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes()); // stereo
        wav.extend_from_slice(&16000u32.to_le_bytes());
        wav.extend_from_slice(&64000u32.to_le_bytes());
        wav.extend_from_slice(&4u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(8000u32 * 4).to_le_bytes());
        assert_eq!(parse_wav_seconds(&wav), 0.5);

        assert_eq!(parse_wav_seconds(b"not a wav"), 0.0);
        assert_eq!(parse_wav_seconds(&[]), 0.0);
    }
}
