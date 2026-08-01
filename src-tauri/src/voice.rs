//! Edge TTS read-aloud backend (`/voice`).
//!
//! Speaks each finished assistant reply aloud by synthesizing the text with
//! Microsoft Edge's read-aloud service, then playing the MP3 through the
//! platform player (`afplay` on macOS, `ffplay` elsewhere). The protocol is
//! keyless and requires no user setup, exactly like the `node-edge-tts` npm
//! package the reference `/voice` implementation uses — but implemented
//! natively in Rust because a Tauri WebView cannot run Node.
//!
//! Wire protocol (reverse-engineered from `node-edge-tts`):
//! 1. Open a WSS to the Bing read-aloud endpoint. The `Sec-MS-GEC` query
//!    param is a time-windowed SHA-256 over the Windows file-time rounded
//!    down to a 5-minute bucket (a crude anti-abuse signature, see
//!    [`sec_ms_gec_token_at`]).
//! 2. Send a `speech.config` text frame (output format = 24 kHz mono MP3).
//! 3. Send an SSML text frame naming the voice and the (XML-escaped) text.
//! 4. Collect binary frames — each is the MP3 payload after a literal
//!    `Path:audio\r\n` prefix — until a `Path:turn.end` text frame arrives.
//!
//! The pure protocol helpers below are unit-tested; the socket I/O wrapper
//! ([`synthesize`]) and the Tauri command ([`tts_speak`]) are coverage-off
//! thin glue, matching the convention for the other network commands.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::process::Command as TokioCommand;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

#[cfg(test)]
use crate::config::defaults::DEFAULT_VOICE_EDGE_VOICE;
use crate::config::defaults::MAX_TTS_CHARS;
use crate::config::AppConfig;

/// Base read-aloud endpoint (without the rotating `Sec-MS-GEC` params, which
/// are appended at connect time).
const EDGE_WSS_URL: &str = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/// Client token used both in the URL and as the HMAC-style key for
/// `Sec-MS-GEC` (mirrors `node-edge-tts`).
const EDGE_TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/// Browser version the token window tracks (a changing version invalidates
/// old tokens, which is why it rides along in the query string).
const EDGE_SEC_MS_GEC_VERSION: &str = "1-143.0.3650.75";
/// The Edge read-aloud endpoint only serves requests from the Edge Read Aloud
/// extension origin.
const EDGE_ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const EDGE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
/// Offset between the Unix epoch and the Windows file-time epoch (1601-01-01).
const WINDOWS_FILE_TIME_EPOCH_SECS: u64 = 11_644_473_600;
/// 100-nanosecond ticks per Unix second.
const TICKS_PER_SEC: u64 = 10_000_000;
/// The token is constant within each 5-minute bucket; this is that bucket size
/// in file-time ticks.
const SEC_MS_GEC_ROUNDING_TICKS: u64 = 3_000_000_000;
/// Header line separating a frame's metadata from its body.
const SPEECH_CONFIG_HEADER: &str =
    "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n";
/// Binary audio frames are prefixed with this literal marker.
const AUDIO_FRAME_PREFIX: &[u8] = b"Path:audio\r\n";
/// Text frame marker that signals the synthesis is finished.
const TURN_END: &str = "Path:turn.end";
/// Hard cap on a single read-aloud request; Edge rejects overlong SSML.
const SYNTHESIS_TIMEOUT: Duration = Duration::from_secs(30);

/// Current Unix time in seconds.
fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The `Sec-MS-GEC` anti-abuse token for the given Unix time: the Windows
/// file-time tick count rounded down to the 5-minute bucket, SHA-256'd with
/// the client token appended, upper-case hex. Same algorithm as
/// `node-edge-tts`' `generateSecMsGecToken`.
pub fn sec_ms_gec_token_at(unix_secs: u64) -> String {
    let ticks = (unix_secs + WINDOWS_FILE_TIME_EPOCH_SECS) * TICKS_PER_SEC;
    let rounded = ticks - (ticks % SEC_MS_GEC_ROUNDING_TICKS);
    let mut hasher = Sha256::new();
    hasher.update(format!("{rounded}{EDGE_TRUSTED_CLIENT_TOKEN}").as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02X}")).collect()
}

/// The `Sec-MS-GEC` token for "now".
fn sec_ms_gec_token() -> String {
    sec_ms_gec_token_at(unix_secs())
}

/// Full WSS URL with the rotating token baked in.
fn edge_ws_url(sec_ms_gec: &str) -> String {
    format!("{EDGE_WSS_URL}&Sec-MS-GEC={sec_ms_gec}&Sec-MS-GEC-Version={EDGE_SEC_MS_GEC_VERSION}")
}

/// XML-escapes user text so it can never break out of the `<voice>` element.
fn escape_ssml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// The fixed `speech.config` frame: declares the MP3 output format Edge should
/// stream back. Matches `node-edge-tts`' defaults byte-for-byte in spirit.
fn build_speech_config_frame() -> String {
    format!(
        "{SPEECH_CONFIG_HEADER}\
         {{\n  \"context\": {{\n    \"synthesis\": {{\n      \"audio\": {{\n        \
         \"metadataoptions\": {{\n          \"sentenceBoundaryEnabled\": \"false\",\n          \
         \"wordBoundaryEnabled\": \"true\"\n        }},\n        \
         \"outputFormat\": \"audio-24khz-48kbitrate-mono-mp3\"\n      }}\n    }}\n  }}\n}}"
    )
}

/// Wraps the (already XML-escaped) text in the Edge SSML envelope with the
/// requested voice. `text` is escaped here too so a stray markdown/quote
/// character can never terminate the element early.
fn build_ssml(voice: &str, text: &str) -> String {
    let escaped = escape_ssml(text);
    format!(
        "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" \
         xmlns:mstts=\"https://www.w3.org/2001/mstts\" xml:lang=\"zh-CN\">\n\
         <voice name=\"{voice}\">\n<prosody rate=\"default\" pitch=\"default\" \
         volume=\"default\">\n{escaped}\n</prosody>\n</voice>\n</speak>"
    )
}

/// Assembles an SSML text frame around a 32-hex request id (see `request_id`).
fn build_ssml_frame(request_id: &str, ssml: &str) -> String {
    format!(
        "X-RequestId:{request_id}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n{ssml}"
    )
}

/// Fresh 32-hex request id for the SSML frame.
fn request_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Strips the `Path:audio\r\n` marker from a binary frame, returning the MP3
/// payload. `None` when the frame does not carry the audio marker (defensive:
/// Edge can interleave other binary control frames).
fn strip_audio_prefix(data: &[u8]) -> Option<&[u8]> {
    data.windows(AUDIO_FRAME_PREFIX.len())
        .position(|w| w == AUDIO_FRAME_PREFIX)
        .map(|i| &data[i + AUDIO_FRAME_PREFIX.len()..])
}

/// Caps read-aloud text at [`MAX_TTS_CHARS`]. Truncation is the real system
/// boundary: Edge rejects overlong SSML with an HTTP error, so this guards the
/// service call regardless of what the frontend sends.
fn truncate_tts_text(text: &str) -> String {
    if text.chars().count() > MAX_TTS_CHARS {
        text.chars().take(MAX_TTS_CHARS).collect()
    } else {
        text.to_string()
    }
}

/// Synthesizes `text` with `voice` over Edge's WebSocket and writes the MP3
/// to `out_path`. Network I/O: excluded from the external coverage pipeline.
#[cfg_attr(coverage_nightly, coverage(off))]
async fn synthesize(text: &str, voice: &str, out_path: &std::path::Path) -> Result<(), String> {
    let text = truncate_tts_text(text);

    // rustls 0.23 requires an explicit crypto backend. reqwest (native-tls)
    // never installs a rustls provider in this app, so do it here: idempotent,
    // first call wins, later calls are no-ops.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let mut request = edge_ws_url(&sec_ms_gec_token())
        .into_client_request()
        .map_err(|e| format!("voice: build request: {e}"))?;
    {
        let headers = request.headers_mut();
        headers.insert("Origin", HeaderValue::from_static(EDGE_ORIGIN));
        headers.insert("User-Agent", HeaderValue::from_static(EDGE_USER_AGENT));
        headers.insert("Pragma", HeaderValue::from_static("no-cache"));
        headers.insert("Cache-Control", HeaderValue::from_static("no-cache"));
    }

    let (mut ws, _response) = connect_async(request)
        .await
        .map_err(|e| format!("voice: connect: {e}"))?;

    let config_frame = build_speech_config_frame();
    ws.send(Message::Text(config_frame.into()))
        .await
        .map_err(|e| format!("voice: send speech.config: {e}"))?;

    let ssml_frame = build_ssml_frame(&request_id(), &build_ssml(voice, &text));
    ws.send(Message::Text(ssml_frame.into()))
        .await
        .map_err(|e| format!("voice: send ssml: {e}"))?;

    let synthesis = async {
        let mut file = tokio::fs::File::create(out_path)
            .await
            .map_err(|e| format!("voice: create output: {e}"))?;
        let mut got_turn_end = false;
        while let Some(frame) = ws.next().await {
            let frame = frame.map_err(|e| format!("voice: recv: {e}"))?;
            match frame {
                Message::Binary(data) => {
                    if let Some(payload) = strip_audio_prefix(&data) {
                        file.write_all(payload)
                            .await
                            .map_err(|e| format!("voice: write audio: {e}"))?;
                    }
                }
                Message::Text(text_frame) if text_frame.contains(TURN_END) => {
                    got_turn_end = true;
                    break;
                }
                _ => {}
            }
        }
        file.flush()
            .await
            .map_err(|e| format!("voice: flush audio: {e}"))?;
        if !got_turn_end {
            return Err("voice: connection closed before turn.end".to_string());
        }
        Ok(())
    };

    tokio::time::timeout(SYNTHESIS_TIMEOUT, synthesis)
        .await
        .map_err(|_| "voice: synthesis timed out".to_string())?
}

/// Plays an MP3 through the platform player. `afplay` ships with macOS;
/// `ffplay` is the Linux fallback (part of ffmpeg).
#[cfg_attr(coverage_nightly, coverage(off))]
async fn play_audio(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let args = {
        let mut v = Vec::new();
        v.push(path.to_string_lossy().into_owned());
        v
    };
    #[cfg(not(target_os = "macos"))]
    let args = {
        vec![
            "-nodisp".to_string(),
            "-autoexit".to_string(),
            "-loglevel".to_string(),
            "quiet".to_string(),
            path.to_string_lossy().into_owned(),
        ]
    };

    #[cfg(target_os = "macos")]
    let player = "afplay";
    #[cfg(not(target_os = "macos"))]
    let player = "ffplay";

    let status = TokioCommand::new(player)
        .args(&args)
        .status()
        .await
        .map_err(|e| format!("voice: spawn {player}: {e}"))?;
    if !status.success() {
        return Err(format!("voice: {player} exited with {status}"));
    }
    Ok(())
}

/// Speaks `text` aloud. The frontend calls this with the plain-text version of
/// a finished assistant reply; `[voice].enabled` is re-checked here as a
/// last-line defense so a stale caller can never trigger audio while voice is
/// off.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub async fn tts_speak(
    text: String,
    config: State<'_, parking_lot::RwLock<AppConfig>>,
) -> Result<(), String> {
    if !config.read().voice.enabled {
        return Ok(());
    }
    let voice = config.read().voice.voice.clone();
    let temp = std::env::temp_dir().join(format!("thuki-tts-{}.mp3", uuid::Uuid::new_v4()));
    eprintln!(
        "[voice] speaking {} chars with {voice}",
        text.chars().count()
    );
    if let Err(e) = synthesize(&text, &voice, &temp).await {
        eprintln!("[voice] synthesize failed: {e}");
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(e);
    }
    let result = play_audio(&temp).await;
    match &result {
        Ok(()) => eprintln!("[voice] played ok"),
        Err(e) => eprintln!("[voice] playback failed: {e}"),
    }
    let _ = tokio::fs::remove_file(&temp).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sec_ms_gec_token_matches_known_vectors() {
        // Reference values computed with the same algorithm from node-edge-tts.
        assert_eq!(
            sec_ms_gec_token_at(1_700_000_000),
            "42301B335578FEFDAE2637DED1ABD614505D432559EC08032B82048483726AFF"
        );
        assert_eq!(
            sec_ms_gec_token_at(1_752_480_000),
            "1F7CFB9D03E5AAD27ADAE5E98EF7B79E40ABB96881D597D0DEDC240BA06184A9"
        );
    }

    #[test]
    fn sec_ms_gec_token_constant_within_bucket_changes_across() {
        // The bucket is 5 minutes (300 s). The Windows epoch offset
        // (11644473600) is divisible by 300, so tick-space bucket boundaries
        // align with Unix-time 300 s multiples. Pick a bucket start (t mod
        // 300 == 0): the token must be stable through t+299 and change at the
        // t+300 boundary.
        let t = 1_700_000_100;
        assert_eq!(sec_ms_gec_token_at(t), sec_ms_gec_token_at(t + 299));
        assert_ne!(sec_ms_gec_token_at(t), sec_ms_gec_token_at(t + 300));
    }

    #[test]
    fn edge_ws_url_embeds_token_and_version() {
        let url = edge_ws_url("TOKEN123");
        assert!(url.contains("TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4"));
        assert!(url.contains("Sec-MS-GEC=TOKEN123"));
        assert!(url.contains("Sec-MS-GEC-Version=1-143.0.3650.75"));
    }

    #[test]
    fn escape_ssml_escapes_all_five_characters() {
        assert_eq!(
            escape_ssml("a & b < c > d \" e ' f"),
            "a &amp; b &lt; c &gt; d &quot; e &apos; f"
        );
    }

    #[test]
    fn escape_ssml_leaves_plain_text_untouched() {
        assert_eq!(
            escape_ssml("Hello, world! 你好 🎉"),
            "Hello, world! 你好 🎉"
        );
    }

    #[test]
    fn speech_config_frame_declares_mp3_output() {
        let frame = build_speech_config_frame();
        assert!(frame.starts_with(SPEECH_CONFIG_HEADER));
        assert!(frame.contains("audio-24khz-48kbitrate-mono-mp3"));
        assert!(frame.contains("\"wordBoundaryEnabled\": \"true\""));
    }

    #[test]
    fn ssml_envelope_names_voice_and_escapes_text() {
        let ssml = build_ssml("zh-CN-XiaoxiaoNeural", "a <b>");
        assert!(ssml.contains("<voice name=\"zh-CN-XiaoxiaoNeural\">"));
        assert!(ssml.contains("a &lt;b&gt;"));
        assert!(ssml.contains("</speak>"));
    }

    #[test]
    fn ssml_frame_carries_request_headers() {
        let frame = build_ssml_frame("0123456789abcdef0123456789abcdef", "<speak/>");
        assert!(frame.starts_with("X-RequestId:0123456789abcdef0123456789abcdef\r\n"));
        assert!(frame.contains("Content-Type:application/ssml+xml\r\n"));
        assert!(frame.contains("Path:ssml\r\n\r\n"));
        assert!(frame.ends_with("<speak/>"));
    }

    #[test]
    fn request_id_is_32_hex_chars() {
        let id = request_id();
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn strip_audio_prefix_removes_marker() {
        assert_eq!(
            strip_audio_prefix(b"Path:audio\r\nID3abc123"),
            Some(&b"ID3abc123"[..])
        );
        assert_eq!(strip_audio_prefix(b"Path:audio\r\n"), Some(&b""[..]));
    }

    #[test]
    fn strip_audio_prefix_returns_none_for_non_audio_frames() {
        assert_eq!(strip_audio_prefix(b"Path:response\r\n{}"), None);
        assert_eq!(strip_audio_prefix(b""), None);
    }

    #[test]
    fn truncate_short_text_passthrough() {
        assert_eq!(truncate_tts_text("short"), "short");
    }

    #[test]
    fn truncate_long_text_caps_at_max_chars() {
        let long: String = "a".repeat(MAX_TTS_CHARS + 50);
        let truncated = truncate_tts_text(&long);
        assert_eq!(truncated.chars().count(), MAX_TTS_CHARS);
    }

    #[test]
    fn truncate_respects_char_boundaries() {
        // "中" is a multi-byte char; the cap must never split it.
        let long: String = "中".repeat(MAX_TTS_CHARS + 1);
        assert_eq!(truncate_tts_text(&long).chars().count(), MAX_TTS_CHARS);
    }

    #[tokio::test]
    #[ignore = "hits the live Edge TTS endpoint and plays audio; run explicitly"]
    async fn live_synthesize_and_play() {
        let text = "你好,这是 Thuki 的声音测试。";
        let path = std::env::temp_dir().join("thuki-live-tts.mp3");
        synthesize(text, DEFAULT_VOICE_EDGE_VOICE, &path)
            .await
            .unwrap();
        let len = std::fs::metadata(&path).unwrap().len();
        println!("synthesized {len} bytes -> {}", path.display());
        assert!(len > 1000, "mp3 too small: {len}");
        play_audio(&path).await.unwrap();
        println!("played ok");
        let _ = std::fs::remove_file(&path);
    }
}
