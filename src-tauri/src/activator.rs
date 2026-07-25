//! Platform-adaptive activation listener for the Thuki overlay.
//!
//! On macOS the listener uses `CGEventTap` (Core Graphics) to detect a
//! double-tap of the Control key at the HID level. On Linux it reads raw
//! `/dev/input/` event devices to do the same.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

// ─── Constants ───────────────────────────────────────────────────────────────

/// Maximum temporal proximity between trigger events to qualify as an activation.
const ACTIVATION_WINDOW: Duration = Duration::from_millis(400);

/// Minimum interval between successive activations to prevent accidental toggles.
const ACTIVATION_COOLDOWN: Duration = Duration::from_millis(600);

// ─── Activation State Machine ────────────────────────────────────────────────

/// Internal state tracking for the activation sequence.
struct ActivationState {
    /// Timestamp of the last verified event in the sequence.
    last_trigger: Option<Instant>,
    /// Tracks the current physical state of the trigger key.
    is_pressed: bool,
    /// Timestamp of the last successful activation to enforce cooldown.
    last_activation: Option<Instant>,
}

/// Evaluates a raw input event to determine if the activation sequence is complete.
///
/// Implements a state machine that filters for state transitions (press/release)
/// and enforces temporal constraints defined by [`ACTIVATION_WINDOW`].
/// Accepts an explicit `now` instant so tests can inject deterministic time.
fn evaluate_activation_at(state: &mut ActivationState, is_press: bool, now: Instant) -> bool {
    if is_press && !state.is_pressed {
        state.is_pressed = true;

        if let Some(last_act) = state.last_activation {
            if now.duration_since(last_act) < ACTIVATION_COOLDOWN {
                return false;
            }
        }

        if let Some(last) = state.last_trigger {
            if now.duration_since(last) < ACTIVATION_WINDOW {
                state.last_trigger = None;
                state.last_activation = Some(now);
                return true;
            }
        }
        state.last_trigger = Some(now);
    } else if !is_press {
        state.is_pressed = false;
    }

    false
}

fn evaluate_activation(state: &mut ActivationState, is_press: bool) -> bool {
    evaluate_activation_at(state, is_press, Instant::now())
}

// ─── macOS-specific (CGEventTap) ─────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos_impl {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_foundation::string::CFString;
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
        CGEventTapPlacement, CGEventType, CallbackResult, EventField,
    };

    use super::{ActivationState, evaluate_activation, ACTIVATION_COOLDOWN, ACTIVATION_WINDOW};

    const KC_PRIMARY_L: i64 = 0x3b;
    const KC_PRIMARY_R: i64 = 0x3e;
    const MAX_PERMISSION_ATTEMPTS: u32 = 6;
    const PERMISSION_POLL_INTERVAL: Duration = Duration::from_secs(5);

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    }

    fn request_authorization(prompt: bool) -> bool {
        unsafe {
            if AXIsProcessTrusted() {
                return true;
            }
            if prompt {
                let key = CFString::new("AXTrustedCheckOptionPrompt");
                let value = CFBoolean::true_value();
                let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
                AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as *const c_void);
            }
            false
        }
    }

    enum TapExitReason {
        Deactivated,
        CreationFailed,
        TapDied,
    }

    pub(crate) fn run_loop_with_retry<F>(is_active: Arc<AtomicBool>, on_activation: Arc<F>)
    where
        F: Fn() + Send + Sync + 'static,
    {
        request_authorization(false);
        let mut permission_failures: u32 = 0;
        loop {
            if !is_active.load(Ordering::SeqCst) {
                return;
            }
            match try_initialize_tap(&is_active, &on_activation) {
                TapExitReason::Deactivated => return,
                TapExitReason::TapDied => {
                    eprintln!("thuki: [activator] tap died - reinstalling");
                    permission_failures = 0;
                }
                TapExitReason::CreationFailed => {
                    permission_failures += 1;
                    if permission_failures >= MAX_PERMISSION_ATTEMPTS {
                        eprintln!(
                            "thuki: [error] activation listener failed after max retries"
                        );
                        return;
                    }
                    eprintln!(
                        "thuki: [activator] tap creation failed (attempt {}/{}); retrying in {}s",
                        permission_failures, MAX_PERMISSION_ATTEMPTS,
                        PERMISSION_POLL_INTERVAL.as_secs()
                    );
                    std::thread::sleep(PERMISSION_POLL_INTERVAL);
                }
            }
        }
    }

    fn try_initialize_tap<F>(
        is_active: &Arc<AtomicBool>,
        on_activation: &Arc<F>,
    ) -> TapExitReason
    where
        F: Fn() + Send + Sync + 'static,
    {
        let state = Arc::new(Mutex::new(ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        }));

        let cb_active = is_active.clone();
        let cb_on_activation = on_activation.clone();
        let cb_state = state.clone();

        let tap_result = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            vec![CGEventType::FlagsChanged],
            move |_proxy, event_type, event: &CGEvent| -> CallbackResult {
                if matches!(
                    event_type,
                    CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput
                ) {
                    CFRunLoop::get_current().stop();
                    return CallbackResult::Keep;
                }
                if !cb_active.load(Ordering::SeqCst) {
                    CFRunLoop::get_current().stop();
                    return CallbackResult::Keep;
                }
                let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                let flags = event.get_flags();
                if keycode != KC_PRIMARY_L && keycode != KC_PRIMARY_R {
                    return CallbackResult::Keep;
                }
                let is_press = flags.contains(CGEventFlags::CGEventFlagControl);
                let mut s = cb_state.lock().unwrap();
                if evaluate_activation(&mut s, is_press) {
                    cb_on_activation();
                }
                CallbackResult::Keep
            },
        );

        match tap_result {
            Ok(tap) => {
                unsafe {
                    let loop_source = tap
                        .mach_port()
                        .create_runloop_source(0)
                        .expect("failed to create run loop source");
                    let run_loop = CFRunLoop::get_current();
                    run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
                    tap.enable();
                    CFRunLoop::run_current();
                }
                if is_active.load(Ordering::SeqCst) {
                    TapExitReason::TapDied
                } else {
                    TapExitReason::Deactivated
                }
            }
            Err(()) => {
                eprintln!("thuki: [activator] tap creation failed; check Accessibility permission");
                TapExitReason::CreationFailed
            }
        }
    }
}

// ─── Linux-specific (evdev via /dev/input/) ──────────────────────────────────

#[cfg(target_os = "linux")]
mod linux_impl {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use super::{ActivationState, evaluate_activation};

    const KEY_LEFTCTRL: u16 = 29;
    const KEY_RIGHTCTRL: u16 = 97;
    const EV_KEY: u16 = 0x01;
    const POLL_TIMEOUT_MS: i32 = 100;

    /// Bytes of a single `struct input_event` from the kernel.
    const INPUT_EVENT_SIZE: usize = 24;

    /// Finds keyboard input event device paths.
    fn find_keyboard_devices() -> Vec<std::path::PathBuf> {
        let mut devices = Vec::new();

        // Check by-path for keyboard symlinks
        if let Ok(entries) = std::fs::read_dir("/dev/input/by-path") {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.contains("kbd") || name.contains("keyboard") || name.ends_with("-event") {
                    if let Ok(target) = std::fs::canonicalize(entry.path()) {
                        devices.push(target);
                    }
                }
            }
        }

        // Check by-id for keyboard symlinks
        if devices.is_empty() {
            if let Ok(entries) = std::fs::read_dir("/dev/input/by-id") {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    if name.contains("kbd") || name.contains("keyboard") {
                        if let Ok(target) = std::fs::canonicalize(entry.path()) {
                            devices.push(target);
                        }
                    }
                }
            }
        }

        devices.sort();
        devices.dedup();
        devices
    }

    fn read_input_event(
        file: &mut std::fs::File,
    ) -> Result<(u16, u16, i32), std::io::Error> {
        use std::io::Read;
        let mut buf = [0u8; INPUT_EVENT_SIZE];
        file.read_exact(&mut buf)?;
        let type_ = u16::from_ne_bytes([buf[16], buf[17]]);
        let code = u16::from_ne_bytes([buf[18], buf[19]]);
        let value = i32::from_ne_bytes([buf[20], buf[21], buf[22], buf[23]]);
        Ok((type_, code, value))
    }

    /// Run the Linux evdev-based activator loop.
    pub(crate) fn run_activator<F>(is_active: Arc<AtomicBool>, on_activation: Arc<F>)
    where
        F: Fn() + Send + Sync + 'static,
    {
        let dev_paths = find_keyboard_devices();

        let devices: Vec<std::path::PathBuf> = if dev_paths.is_empty() {
            // Fallback: scan all event devices
            let mut fallback = Vec::new();
            if let Ok(entries) = std::fs::read_dir("/dev/input") {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    if name.starts_with("event") {
                        fallback.push(entry.path());
                    }
                }
            }
            fallback.sort();
            fallback
        } else {
            dev_paths
        };

        if devices.is_empty() {
            eprintln!("thuki: [activator] no input devices found on Linux");
            return;
        }

        let mut files: Vec<std::fs::File> = Vec::new();
        let mut poll_fds: Vec<libc::pollfd> = Vec::new();

        for path in &devices {
            match std::fs::File::open(path) {
                Ok(file) => {
                    use std::os::fd::AsRawFd;
                    poll_fds.push(libc::pollfd {
                        fd: file.as_raw_fd(),
                        events: libc::POLLIN,
                        revents: 0,
                    });
                    files.push(file);
                }
                Err(e) => {
                    eprintln!("thuki: [activator] failed to open {:?}: {e}", path);
                }
            }
        }

        if files.is_empty() {
            eprintln!("thuki: [activator] no keyboard devices accessible on Linux");
            return;
        }

        eprintln!("thuki: [activator] listening on {} device(s)", files.len());

        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        loop {
            if !is_active.load(Ordering::SeqCst) {
                return;
            }

            let ret = unsafe {
                libc::poll(poll_fds.as_mut_ptr(), poll_fds.len() as libc::nfds_t, POLL_TIMEOUT_MS)
            };

            if ret < 0 {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }

            if ret == 0 {
                continue;
            }

            for (i, pfd) in poll_fds.iter().enumerate() {
                if pfd.revents & libc::POLLIN == 0 {
                    continue;
                }

                match read_input_event(&mut files[i]) {
                    Ok((type_, code, value)) => {
                        if type_ == EV_KEY && (code == KEY_LEFTCTRL || code == KEY_RIGHTCTRL) {
                            let is_press = value == 1;
                            if evaluate_activation(&mut state, is_press) {
                                on_activation();
                            }
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                        // device disconnected
                        eprintln!("thuki: [activator] device disconnected");
                        break;
                    }
                    Err(e) => {
                        eprintln!("thuki: [activator] read error: {e}");
                    }
                }
            }
        }
    }
}

// ─── Public Interface ─────────────────────────────────────────────────────────

/// Orchestrates the lifecycle and threading of the background activation listener.
pub struct OverlayActivator {
    is_active: Arc<AtomicBool>,
}

impl OverlayActivator {
    /// Creates a new, inactive instance of the activator.
    pub fn new() -> Self {
        Self {
            is_active: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Spawns the background monitoring thread and initializes the event loop.
    ///
    /// On macOS this uses CGEventTap; on Linux it reads `/dev/input/` event
    /// devices. The callback is invoked each time a double-tap of the Control
    /// key is detected.
    #[cfg_attr(coverage_nightly, coverage(off))]
    pub fn start<F>(&self, on_activation: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        if self.is_active.load(Ordering::SeqCst) {
            return;
        }
        self.is_active.store(true, Ordering::SeqCst);

        let is_active = self.is_active.clone();
        let on_activation = Arc::new(on_activation);

        std::thread::spawn(move || {
            #[cfg(target_os = "macos")]
            macos_impl::run_loop_with_retry(is_active, on_activation);

            #[cfg(target_os = "linux")]
            linux_impl::run_activator(is_active, on_activation);
        });
    }
}

impl Default for OverlayActivator {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_activator_is_inactive() {
        let activator = OverlayActivator::new();
        assert!(!activator.is_active.load(Ordering::SeqCst));
    }

    #[test]
    fn validates_activation_sequence() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        assert!(!evaluate_activation(&mut state, true));
        evaluate_activation(&mut state, false);

        assert!(evaluate_activation(&mut state, true));
    }

    #[test]
    fn rejects_stale_sequence() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        evaluate_activation(&mut state, true);
        evaluate_activation(&mut state, false);

        state.last_trigger = Some(Instant::now() - Duration::from_millis(500));

        assert!(!evaluate_activation(&mut state, true));
    }

    #[test]
    fn cooldown_rejects_activation_within_window() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        evaluate_activation(&mut state, true);
        evaluate_activation(&mut state, false);
        assert!(evaluate_activation(&mut state, true));
        evaluate_activation(&mut state, false);

        evaluate_activation(&mut state, true);
        evaluate_activation(&mut state, false);
        assert!(!evaluate_activation(&mut state, true));
    }

    #[test]
    fn cooldown_allows_activation_after_expiry() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        evaluate_activation(&mut state, true);
        evaluate_activation(&mut state, false);
        assert!(evaluate_activation(&mut state, true));
        evaluate_activation(&mut state, false);

        state.last_activation = Some(Instant::now() - Duration::from_millis(700));

        evaluate_activation(&mut state, true);
        evaluate_activation(&mut state, false);
        assert!(evaluate_activation(&mut state, true));
    }

    #[test]
    fn boundary_timing_at_exactly_400ms_is_rejected() {
        let base = Instant::now();
        let mut state = ActivationState {
            last_trigger: Some(base),
            is_pressed: false,
            last_activation: None,
        };
        assert!(!evaluate_activation_at(
            &mut state,
            true,
            base + Duration::from_millis(400),
        ));
    }

    #[test]
    fn boundary_timing_at_399ms_is_accepted() {
        let base = Instant::now();
        let mut state = ActivationState {
            last_trigger: Some(base),
            is_pressed: false,
            last_activation: None,
        };
        assert!(evaluate_activation_at(
            &mut state,
            true,
            base + Duration::from_millis(399),
        ));
    }

    #[test]
    fn first_tap_records_timestamp() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        assert!(!evaluate_activation(&mut state, true));
        assert!(state.last_trigger.is_some());
    }

    #[test]
    fn state_resets_after_successful_activation() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        evaluate_activation(&mut state, true);
        evaluate_activation(&mut state, false);
        assert!(evaluate_activation(&mut state, true));

        assert!(state.last_trigger.is_none());
        assert!(state.last_activation.is_some());
    }

    #[test]
    fn repeated_press_without_release_is_ignored() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        evaluate_activation(&mut state, true);
        assert!(!evaluate_activation(&mut state, true));
    }

    #[test]
    fn release_without_press_does_nothing() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_activation: None,
        };

        assert!(!evaluate_activation(&mut state, false));
        assert!(state.last_trigger.is_none());
    }
}
