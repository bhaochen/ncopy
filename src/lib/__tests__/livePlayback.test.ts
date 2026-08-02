import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toPlayableVideoSrc, revokeVideoSrc } from '../livePlayback';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

// Rebuild the blob-URL mocks per test: the global afterEach restores (empties)
// them, so history and implementations cannot be relied on across tests.
let blobUrlCounter = 0;
beforeEach(() => {
  blobUrlCounter = 0;
  URL.createObjectURL = vi.fn(
    () => `blob:http://localhost/fake-blob-${++blobUrlCounter}`,
  );
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toPlayableVideoSrc', () => {
  it('fetches the asset URL and returns a blob URL', async () => {
    const fetchMock = vi.fn(async () => ({
      blob: async () => new Blob(['fake-video'], { type: 'video/mp4' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const src = await toPlayableVideoSrc('/tmp/thuki/live.mp4');

    expect(fetchMock).toHaveBeenCalledWith('asset:///tmp/thuki/live.mp4');
    expect(src).toBe('blob:http://localhost/fake-blob-1');
  });

  it('falls back to the asset URL when the fetch fails', async () => {
    const error = new Error('network down');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(error)),
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const src = await toPlayableVideoSrc('/tmp/thuki/live.mp4');

    expect(consoleError).toHaveBeenCalledWith(
      '[live] could not load segment over the asset protocol',
      error,
    );
    expect(src).toBe('asset:///tmp/thuki/live.mp4');
  });

  it('falls back to the asset URL when the blob extraction fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        blob: async () => {
          throw new Error('empty body');
        },
      })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const src = await toPlayableVideoSrc('/tmp/thuki/live.mp4');

    expect(src).toBe('asset:///tmp/thuki/live.mp4');
  });
});

describe('revokeVideoSrc', () => {
  it('revokes blob URLs', () => {
    revokeVideoSrc('blob:http://localhost/fake-blob-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      'blob:http://localhost/fake-blob-1',
    );
  });

  it('leaves non-blob URLs alone', () => {
    revokeVideoSrc('asset:///tmp/thuki/live.mp4');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
