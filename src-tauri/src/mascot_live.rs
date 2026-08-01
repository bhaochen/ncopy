//! Live mascot video: turns each read-aloud audio clip into a 512x512
//! talking-head video via SoulX-FlashHead, played in the mascot stage's
//! `live` state.
//!
//! The TTS MP3 is transcoded to a 16 kHz mono WAV, fed to
//! `generate_video.py` (distilled `lite` model, `public/girl.png` as the
//! condition headshot), and the finished `live.mp4` is advertised to the
//! frontend with a `mascot://live-ready` event carrying the file path; the
//! frontend turns it into an asset URL and plays it once.
//!
//! Generation is serialized behind a managed mutex: a new clip that arrives
//! while a generation is still running is dropped, because the GPU can run
//! one inference at a time and the newest audio is the one the user is
//! hearing. The whole pipeline is best-effort — a dead GPU, missing model,
//! or failed transcode only logs, never fails the read-aloud turn itself.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;

/// Frontend event fired when a fresh `live.mp4` is ready to play.
pub const MASCOT_LIVE_READY_EVENT: &str = "thuki://mascot-live-ready";
/// FlashHead model flavor: `lite` (distilled, ~96 FPS on a 4090) runs on the
/// 8 GB laptop 4060; `pro` (20 sample steps) would take minutes per clip.
const LIVE_MODEL_TYPE: &str = "lite";
/// Model checkpoint dirs relative to the FlashHead project root.
const FLASHHEAD_MODELS_DIR: &str = "models/SoulX-FlashHead-1_3B";
const WAV2VEC_MODELS_DIR: &str = "models/wav2vec2-base-960h";
/// TTS audio is resampled to the mono 16 kHz the model expects.
const LIVE_SAMPLE_RATE_HZ: &str = "16000";

/// Global serialization lock: a `MutexGuard<'static, ()>` is what lets the
/// spawned generation task own the lock while it runs. `try_lock` drops a
/// generation that would have to wait behind an older one.
fn live_generation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// SoulX-FlashHead project root (`~/Code/Llm/SoulX-FlashHead`).
pub fn flashhead_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join("Code")
        .join("Llm")
        .join("SoulX-FlashHead")
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

/// Where generated live videos land (`app_data_dir/live/`).
pub fn live_output_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("live")
}

/// The fixed output path — every turn overwrites the same `live.mp4`.
pub fn live_output_path(app: &AppHandle) -> PathBuf {
    live_output_dir(app).join("live.mp4")
}

/// The `generate_video.py` argument list for `wav_path -> output`, as plain
/// strings so it is unit-testable without constructing a `Command`.
pub fn flashhead_args(output: &Path, wav_path: &Path) -> Vec<String> {
    let project = flashhead_dir();
    let owned = |p: PathBuf| p.to_string_lossy().into_owned();
    vec![
        "generate_video.py".to_string(),
        "--ckpt_dir".to_string(),
        owned(project.join(FLASHHEAD_MODELS_DIR)),
        "--wav2vec_dir".to_string(),
        owned(project.join(WAV2VEC_MODELS_DIR)),
        "--model_type".to_string(),
        LIVE_MODEL_TYPE.to_string(),
        "--cond_image".to_string(),
        owned(cond_image_path()),
        "--audio_path".to_string(),
        owned(wav_path.to_path_buf()),
        "--audio_encode_mode".to_string(),
        "stream".to_string(),
        "--save_file".to_string(),
        owned(output.to_path_buf()),
    ]
}

/// The `generate_video.py` invocation turning `wav_path` into `output`.
pub fn flashhead_command(output: &Path, wav_path: &Path) -> TokioCommand {
    let project = flashhead_dir();
    let mut cmd = TokioCommand::new(project.join(".venv").join("bin").join("python"));
    cmd.current_dir(&project)
        .args(flashhead_args(output, wav_path));
    cmd.env("CUDA_VISIBLE_DEVICES", "0");
    cmd
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

/// Runs one generation end-to-end, holding the serialization lock for its
/// whole lifetime. Always cleans up the WAV and (once consumed) the MP3.
#[cfg_attr(coverage_nightly, coverage(off))]
async fn run_generation(
    app: AppHandle,
    mp3_path: PathBuf,
    _guard: tokio::sync::MutexGuard<'static, ()>,
) {
    let out_dir = live_output_dir(&app);
    let _ = std::fs::create_dir_all(&out_dir);
    let wav_path = out_dir.join("latest.wav");

    if let Err(e) = transcode_to_wav(&mp3_path, &wav_path).await {
        eprintln!("[live] transcode failed: {e}");
        let _ = std::fs::remove_file(&mp3_path);
        return;
    }

    let output = flashhead_command(&live_output_path(&app), &wav_path)
        .output()
        .await;
    match output {
        Ok(out) if out.status.success() => {
            let path = live_output_path(&app);
            eprintln!("[live] generated {}", path.display());
            let _ = app.emit(MASCOT_LIVE_READY_EVENT, path.to_string_lossy().to_string());
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let tail: String = stderr.lines().rev().take(8).collect::<Vec<_>>().join("\n");
            eprintln!("[live] generation failed: {tail}");
        }
        Err(e) => eprintln!("[live] spawn generate_video.py failed: {e}"),
    }

    let _ = std::fs::remove_file(&wav_path);
    let _ = std::fs::remove_file(&mp3_path);
}

/// Kicks off live-video generation for a finished read-aloud clip, taking
/// ownership of the MP3 lifecycle. No-ops (and deletes the MP3) when voice is
/// off or a generation is already running.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn trigger_live_generation(app: &AppHandle, mp3_path: &Path) {
    let Ok(guard) = live_generation_lock().try_lock() else {
        eprintln!("[live] generation already running; dropping new clip");
        let _ = std::fs::remove_file(mp3_path);
        return;
    };
    let app = app.clone();
    let mp3_path = mp3_path.to_path_buf();
    tokio::spawn(run_generation(app, mp3_path, guard));
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
        // Either the app's public/girl.png or the FlashHead example exists on
        // the dev machine.
        let path = cond_image_path();
        assert!(path.is_file(), "cond image must exist at {path:?}");
        assert_eq!(path.file_name().unwrap(), "girl.png");
    }

    #[test]
    fn flashhead_args_name_the_lite_model_and_girl_cond_image() {
        let args = flashhead_args(Path::new("/out/live.mp4"), Path::new("/tmp/tts.wav"));
        let pos = |needle: &str| args.iter().position(|a| a == needle).unwrap();
        assert_eq!(args[pos("--model_type") + 1], "lite");
        assert_eq!(
            args[pos("--cond_image") + 1],
            cond_image_path().to_string_lossy().into_owned()
        );
        assert_eq!(args[pos("--audio_path") + 1], "/tmp/tts.wav");
        assert_eq!(args[pos("--save_file") + 1], "/out/live.mp4");
        assert!(args.iter().any(|a| a == "--audio_encode_mode"));
        assert!(args[pos("--ckpt_dir") + 1].ends_with("SoulX-FlashHead-1_3B"));
    }
}
