import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  MascotStage,
  MASCOT_STAGE_STATES,
  MASCOT_STAGE_VIDEO_SRC,
} from '../MascotStage';
import type { MascotStageState } from '../MascotStage';

/** The static (looping) states — `live` is dynamic. */
const STATIC_STATES = MASCOT_STAGE_STATES.filter((s) => s !== 'live');

/** The panel for a state, or null if it is not rendered. */
function panelFor(state: MascotStageState): HTMLElement | null {
  return screen
    .getByTestId('mascot-stage')
    .querySelector(`.mascot-stage-video[data-state="${state}"]`);
}

describe('MascotStage', () => {
  it('renders the stage container for every state', () => {
    for (const state of MASCOT_STAGE_STATES) {
      const { unmount } = render(<MascotStage state={state} />);
      expect(screen.getByTestId('mascot-stage')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        `Thuki is ${state}`,
      );
      unmount();
    }
  });

  it('keeps every static panel mounted with a handover video pair', () => {
    render(<MascotStage state="idle" />);
    for (const state of STATIC_STATES) {
      const panel = panelFor(state);
      expect(panel).not.toBeNull();
      const videos = panel!.querySelectorAll('video');
      expect(videos).toHaveLength(2);
      for (const video of videos) {
        expect(video).toHaveAttribute('src', MASCOT_STAGE_VIDEO_SRC[state]);
        // The browser's native `loop` re-seek is disabled; the seamless
        // handover inside each panel owns the looping instead.
        expect(video).not.toHaveAttribute('loop');
      }
    }
  });

  it('renders the live panel as a single once-playing video', () => {
    const onLiveEnded = vi.fn();
    render(
      <MascotStage
        state="live"
        liveSrc="asset://localhost/live.mp4"
        liveKey={3}
        onLiveEnded={onLiveEnded}
      />,
    );
    const panel = panelFor('live')!;
    const videos = panel.querySelectorAll('video');
    expect(videos).toHaveLength(1);
    const video = videos[0] as HTMLVideoElement;
    expect(video).toHaveAttribute('src', 'asset://localhost/live.mp4');
    expect(video.className).toBe('mascot-stage-live-video');
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    // A talking-head clip plays once; the loop pair is not used.
    expect(video).not.toHaveAttribute('loop');
    fireEvent.ended(video);
    expect(onLiveEnded).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the live video element when liveKey changes', () => {
    const { rerender } = render(
      <MascotStage state="live" liveSrc="asset://a" liveKey={1} />,
    );
    const first = panelFor('live')!.querySelector('video');
    rerender(
      <MascotStage state="live" liveSrc="asset://a" liveKey={2} />,
    );
    expect(panelFor('live')!.querySelector('video')).not.toBe(first);
  });

  it('starts the primary instance autoplaying in the idle panel', () => {
    render(<MascotStage state="idle" />);
    const primary = panelFor('idle')!.querySelector(
      'video.seamless-loop-video-active',
    ) as HTMLVideoElement;
    expect(primary.autoplay).toBe(true);
    expect(primary.muted).toBe(true);
    expect(primary.playsInline).toBe(true);
    expect(primary).toHaveAttribute('preload', 'auto');
  });

  it.each(MASCOT_STAGE_STATES)(
    'marks only the %s panel active and hides the others',
    (state) => {
      const { unmount } = render(<MascotStage state={state} />);
      for (const s of MASCOT_STAGE_STATES) {
        const panel = panelFor(s)!;
        if (s === state) {
          expect(panel.className).toContain('mascot-stage-video-active');
          expect(panel).toHaveAttribute('aria-hidden', 'false');
        } else {
          expect(panel.className).not.toContain('mascot-stage-video-active');
          expect(panel).toHaveAttribute('aria-hidden', 'true');
        }
      }
      unmount();
    },
  );

  it('maps a loop source for every static state and excludes live', () => {
    expect(MASCOT_STAGE_STATES).toContain('live');
    expect(Object.keys(MASCOT_STAGE_VIDEO_SRC)).toEqual(STATIC_STATES);
    for (const state of STATIC_STATES) {
      expect(MASCOT_STAGE_VIDEO_SRC[state]).toMatch(/\.mp4$/);
    }
  });
});
