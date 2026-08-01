import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  MascotStage,
  MASCOT_STAGE_STATES,
  MASCOT_STAGE_VIDEO_SRC,
} from '../MascotStage';
import type { MascotStageState } from '../MascotStage';

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

  it('keeps every state panel mounted with a handover video pair', () => {
    render(<MascotStage state="idle" />);
    for (const state of MASCOT_STAGE_STATES) {
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

  it('covers every declared state value in the video source map', () => {
    const declared: MascotStageState[] = ['idle', 'listening', 'thinking'];
    expect(declared).toEqual(MASCOT_STAGE_STATES);
    expect(Object.keys(MASCOT_STAGE_VIDEO_SRC)).toEqual(declared);
  });
});
