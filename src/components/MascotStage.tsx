import { memo } from 'react';
import { SeamlessLoopVideo } from './SeamlessLoopVideo';

/**
 * The companion mascot's lifecycle states. The active state picks which
 * looping video plays:
 *
 * - `idle`: the resting state (nothing is being asked).
 * - `listening`: the ask-bar input holds focus, the mascot is "hearing" a
 *   request take shape.
 * - `thinking`: a response is streaming from the engine.
 * - `live`: the mascot speaking the just-finished reply — the read-aloud
 *   audio (`/voice`) drives SoulX-FlashHead to a 512x512 talking-head video
 *   that plays once.
 */
export type MascotStageState = 'idle' | 'listening' | 'thinking' | 'live';

/** Every state the stage can render, in stable order. */
export const MASCOT_STAGE_STATES: readonly MascotStageState[] = [
  'idle',
  'listening',
  'thinking',
  'live',
] as const;

/**
 * Public asset per static state. All three videos are 512x512 H.264 loops.
 * `live` is dynamic (per-turn `live.mp4`), so it is not in this map.
 */
export const MASCOT_STAGE_VIDEO_SRC: Record<
  Exclude<MascotStageState, 'live'>,
  string
> = {
  idle: '/idle.mp4',
  listening: '/listening.mp4',
  thinking: '/thinking.mp4',
};

interface MascotStageProps {
  /** Which mascot animation is currently active. */
  state: MascotStageState;
  /**
   * Asset URL of the current `live.mp4` (only meaningful while `state` is
   * `live`). Plays once; `onLiveEnded` fires when it finishes.
   */
  liveSrc?: string | null;
  /**
   * Monotonic counter bumped on every live-ready event. Used as the live
   * `<video>` key so a fresh clip (same output path, overwritten in place)
   * rebuilds the element and replays instead of showing a stale frame.
   */
  liveKey?: number;
  /** Called when the `live` video reaches its end (return to `idle`). */
  onLiveEnded?: () => void;
}

/**
 * 512x512 video area that shows the mascot's current lifecycle state.
 *
 * All panels stay mounted so a state switch is an opacity crossfade (CSS
 * `mascot-stage-video-active`), never a reload flash. The static panels own a
 * `SeamlessLoopVideo`, which replaces the browser's native `loop` re-seek (a
 * one-frame flash at the loop point) with a two-instance handover. The `live`
 * panel is a single plain `<video>` that plays the generated clip once —
 * looping a talking-head video would snap at the loop point.
 */
function MascotStageComponent({
  state,
  liveSrc,
  liveKey,
  onLiveEnded,
}: MascotStageProps) {
  return (
    <div
      className="mascot-stage self-center"
      data-testid="mascot-stage"
      role="status"
      aria-label={`Thuki is ${state}`}
    >
      {MASCOT_STAGE_STATES.map((s) => (
        <div
          key={s}
          data-state={s}
          aria-hidden={s !== state}
          className={`mascot-stage-video${
            s === state ? ' mascot-stage-video-active' : ''
          }`}
        >
          {s === 'live' ? (
            <video
              key={liveKey}
              src={liveSrc ?? undefined}
              autoPlay
              muted
              playsInline
              onEnded={onLiveEnded}
              className="mascot-stage-live-video"
            />
          ) : (
            <SeamlessLoopVideo src={MASCOT_STAGE_VIDEO_SRC[s]} />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Memoized so token-streaming re-renders in App never reconcile the video
 * elements; the stage only re-renders when the active state changes.
 */
export const MascotStage = memo(MascotStageComponent);
