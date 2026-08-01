import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeamlessLoopVideo } from '../SeamlessLoopVideo';

/** The two <video> instances, primary first. */
function getVideos(
  container: HTMLElement,
): [HTMLVideoElement, HTMLVideoElement] {
  const videos = container.querySelectorAll('video');
  return [videos[0] as HTMLVideoElement, videos[1] as HTMLVideoElement];
}

/** Sets a readable duration on a jsdom <video> (its default is NaN). */
function setDuration(video: HTMLVideoElement, seconds: number): void {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    value: seconds,
  });
}

describe('SeamlessLoopVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a primary and standby instance of the same source', () => {
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);
    expect(primary).toHaveAttribute('src', '/idle.mp4');
    expect(standby).toHaveAttribute('src', '/idle.mp4');
    expect(primary.autoplay).toBe(true);
    expect(primary.muted).toBe(true);
    expect(standby.muted).toBe(true);
  });

  it('stacks the active instance on top and never uses the native loop', () => {
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);
    expect(primary.className).toContain('seamless-loop-video-active');
    expect(standby.className).not.toContain('seamless-loop-video-active');
    // The whole point: handover is owned here, not by the browser's `loop`
    // re-seek (which drops a frame at the boundary).
    expect(primary.loop).toBe(false);
    expect(standby.loop).toBe(false);
  });

  it('parks the standby on the first frame once its metadata loads', () => {
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [, standby] = getVideos(container);

    fireEvent(standby, new Event('loadedmetadata'));

    expect(standby.currentTime).toBe(0);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it('re-parks the standby when it drifted (a previous turn ended it)', () => {
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);
    setDuration(primary, 5);
    primary.currentTime = 4.5; // within PRIME_AHEAD_S (1s) of the end
    // The standby ended a previous turn, so it sits at the last frame.
    setDuration(standby, 5);
    standby.currentTime = 5;

    fireEvent(primary, new Event('timeupdate'));

    expect(standby.currentTime).toBe(0);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-seek an already-parked standby on repeat timeupdates', () => {
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);
    setDuration(primary, 5);
    primary.currentTime = 4.5;
    standby.currentTime = 0; // already parked on the first frame

    fireEvent(primary, new Event('timeupdate'));

    expect(standby.currentTime).toBe(0);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('re-parks the primary when the standby is the active instance', () => {
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);

    // Standby takes over as the active instance; the primary sits at the last
    // frame where its previous turn ended.
    fireEvent(primary, new Event('ended'));
    setDuration(primary, 5);
    primary.currentTime = 5;
    setDuration(standby, 5);
    standby.currentTime = 4.5; // within PRIME_AHEAD_S of the end

    fireEvent(standby, new Event('timeupdate'));

    // The parked primary is re-parked on the first frame.
    expect(primary.currentTime).toBe(0);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it('does not prime far from the loop point', () => {
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);
    setDuration(primary, 5);
    primary.currentTime = 1;

    fireEvent(primary, new Event('timeupdate'));

    expect(standby.currentTime).toBe(0);
  });

  it('does not prime while the media duration is unknown', () => {
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);

    // duration stays NaN (jsdom default) → no priming.
    primary.currentTime = 4.5;
    fireEvent(primary, new Event('timeupdate'));

    expect(standby.currentTime).toBe(0);
  });

  it('swaps roles and resumes the standby when the active video ends', () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);

    fireEvent(primary, new Event('ended'));

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(standby.className).toContain('seamless-loop-video-active');
    expect(primary.className).not.toContain('seamless-loop-video-active');
  });

  it('hands playback back to the primary when the standby ends', () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);

    fireEvent(primary, new Event('ended')); // standby now active
    fireEvent(standby, new Event('ended')); // primary takes over again

    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(primary.className).toContain('seamless-loop-video-active');
    expect(standby.className).not.toContain('seamless-loop-video-active');
  });

  it('ignores timeupdate from the parked instance', () => {
    const { container } = render(<SeamlessLoopVideo src="/idle.mp4" />);
    const [primary, standby] = getVideos(container);
    setDuration(standby, 5);
    standby.currentTime = 4.5;

    // Standby is not the active instance, so its timeupdate is a no-op.
    fireEvent(standby, new Event('timeupdate'));

    expect(primary.currentTime).toBe(0);
  });
});
