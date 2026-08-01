import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';

/**
 * How early (seconds before the loop point) the active video re-parks the
 * other instance, so its handover frame is decoded well in advance and never
 * races the moment the active one ends.
 */
const PRIME_AHEAD_S = 1;
/** Tolerance for "already parked at the first frame". */
const PARKED_TOLERANCE_S = 0.01;

interface SeamlessLoopVideoProps {
  /** The looping video source. */
  src: string;
}

/**
 * Plays `src` as an endless, flicker-free loop.
 *
 * A plain `loop` attribute makes the browser re-seek to 0 when the media ends,
 * and on some engines (WKWebView, WebKitGTK) that re-seek drops a rendered
 * frame at the boundary — the classic one-frame flash at the loop point.
 *
 * This component owns the loop with a two-instance handover instead:
 *
 * - Both instances stay fully opaque and stacked. The active one sits on top
 *   (z-index) and plays; the parked one sits underneath, parked on the FIRST
 *   frame (`loadedmetadata` parks it there), so its handover frame is decoded
 *   AND still composited — it can never lose its picture.
 * - When the active one ends, the roles swap and the parked one resumes from
 *   the first frame, which is already on screen. Because the source loops
 *   (last frame ≈ first frame), the swap is pixel-continuous: no re-seek
 *   happens at the boundary at all.
 *
 * The parked instance is never hidden (no opacity 0 / display none), which is
 * what makes the handover deterministic across engines.
 */
function SeamlessLoopVideoComponent({ src }: SeamlessLoopVideoProps) {
  const primaryRef = useRef<HTMLVideoElement>(null);
  const standbyRef = useRef<HTMLVideoElement>(null);
  const [primaryActive, setPrimaryActive] = useState(true);
  /**
   * Mirror of `primaryActive` for the event handlers, which are stable
   * callbacks and must read the freshest role without re-subscribing.
   */
  const primaryActiveRef = useRef(true);

  /**
   * Park the standby on its first frame as soon as it has metadata, so the
   * handover frame is decoded long before it is ever needed. This is the
   * load-bearing park: a parked-at-zero instance is ready to take over on
   * `ended` with no re-seek at the boundary.
   */
  useEffect(() => {
    // The ref is always set after render, and this effect runs post-mount.
    const standby = standbyRef.current!;
    const park = () => {
      standby.currentTime = 0;
      standby.pause();
    };
    standby.addEventListener('loadedmetadata', park);
    return () => standby.removeEventListener('loadedmetadata', park);
  }, []);

  /**
   * Re-parks the currently-parked instance on the first frame if it has
   * drifted (a previous turn ended it at the last frame). A parked-at-zero
   * instance is left alone.
   */
  const primeStandby = useCallback(() => {
    const target = primaryActiveRef.current
      ? standbyRef.current!
      : primaryRef.current!;
    if (Math.abs(target.currentTime) > PARKED_TOLERANCE_S) {
      target.currentTime = 0;
      target.pause();
    }
  }, []);

  /** Re-parks the parked instance once the active one nears its end. */
  const handleTimeUpdate = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const active = primaryActiveRef.current
        ? primaryRef.current!
        : standbyRef.current!;
      if (event.currentTarget !== active) return;
      if (
        active.duration > 0 &&
        active.currentTime >= active.duration - PRIME_AHEAD_S
      ) {
        primeStandby();
      }
    },
    [primeStandby],
  );

  /**
   * Hands playback over to the parked instance, which is already parked on the
   * first frame and composited — it just resumes from where it is.
   */
  const handleEnded = useCallback(() => {
    const next = primaryActiveRef.current
      ? standbyRef.current!
      : primaryRef.current!;
    primaryActiveRef.current = !primaryActiveRef.current;
    setPrimaryActive(primaryActiveRef.current);
    void next.play();
  }, []);

  return (
    <div className="seamless-loop-video">
      <video
        ref={primaryRef}
        src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        className={`seamless-loop-video-primary${
          primaryActive ? ' seamless-loop-video-active' : ''
        }`}
      />
      <video
        ref={standbyRef}
        src={src}
        muted
        playsInline
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        className={`seamless-loop-video-standby${
          primaryActive ? '' : ' seamless-loop-video-active'
        }`}
      />
    </div>
  );
}

/**
 * Memoized so a parent re-render never reconciles the video pair; only a
 * change to `src` (never the case for a fixed stage state) re-renders it.
 */
export const SeamlessLoopVideo = memo(SeamlessLoopVideoComponent);
