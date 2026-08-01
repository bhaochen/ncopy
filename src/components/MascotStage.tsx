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
 *
 * A fourth `live` state (the mascot speaking the text reply as it streams)
 * is planned but has no video asset yet, so it is intentionally absent.
 */
export type MascotStageState = 'idle' | 'listening' | 'thinking';

/** Every state the stage can render, in stable order. */
export const MASCOT_STAGE_STATES: readonly MascotStageState[] = [
  'idle',
  'listening',
  'thinking',
] as const;

/**
 * Public asset per state. All three videos are 512x512 H.264 loops.
 */
export const MASCOT_STAGE_VIDEO_SRC: Record<MascotStageState, string> = {
  idle: '/idle.mp4',
  listening: '/listening.mp4',
  thinking: '/thinking.mp4',
};

interface MascotStageProps {
  /** Which mascot animation is currently active. */
  state: MascotStageState;
}

/**
 * 512x512 video area that shows the mascot's current lifecycle state.
 *
 * All three panels stay mounted so a state switch is an opacity crossfade
 * (CSS `mascot-stage-video-active`), never a reload flash. Each panel owns a
 * `SeamlessLoopVideo`, which replaces the browser's native `loop` re-seek
 * (a one-frame flash at the loop point) with a two-instance handover.
 */
function MascotStageComponent({ state }: MascotStageProps) {
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
          <SeamlessLoopVideo src={MASCOT_STAGE_VIDEO_SRC[s]} />
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
