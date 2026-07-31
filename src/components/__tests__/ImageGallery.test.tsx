import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ImageGallery } from '../ImageGallery';
import type { ImageSearchHit } from '../../types/search';

const HITS: ImageSearchHit[] = [
  {
    title: 'Cat photo',
    url: 'https://ex.com/cat',
    img_src: 'https://ex.com/cat.jpg',
    thumbnail_src: 'https://ex.com/cat-t.jpg',
    source: 'unsplash',
  },
  {
    title: 'Dog photo',
    url: 'https://ex.com/dog',
    img_src: 'https://ex.com/dog.jpg',
    thumbnail_src: 'https://ex.com/dog-t.jpg',
    source: 'unsplash',
  },
];

describe('ImageGallery', () => {
  it('renders nothing when there are no hits', () => {
    const { container } = render(<ImageGallery hits={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders one thumbnail button per hit with a title aria-label', () => {
    render(<ImageGallery hits={HITS} />);
    const thumbs = screen.getAllByRole('button', { name: /photo/i });
    expect(thumbs).toHaveLength(2);
  });

  it('renders the thumbnail img with the hit src and alt text', () => {
    render(<ImageGallery hits={HITS} />);
    const img = screen.getByAltText('Cat photo');
    expect(img).toHaveAttribute('src', 'https://ex.com/cat.jpg');
  });

  it('drops a hit from the gallery once its image fails to load', () => {
    render(<ImageGallery hits={HITS} />);
    fireEvent.error(screen.getByAltText('Cat photo'));
    expect(screen.queryByAltText('Cat photo')).not.toBeInTheDocument();
    expect(screen.getByAltText('Dog photo')).toBeInTheDocument();
  });

  it('ignores repeated load failures for the same image', () => {
    // Two hits sharing one img_src: when both report an error in the same
    // task, React batches the two updaters and the second one sees the url
    // already in the failed set (the guarded `return prev` branch).
    const first = { ...HITS[0], title: 'Copy A' };
    const second = { ...HITS[0], title: 'Copy B' };
    render(<ImageGallery hits={[first, second]} />);
    const imgs = screen.getAllByAltText(/Copy/);
    act(() => {
      imgs[0].dispatchEvent(new Event('error', { bubbles: true }));
      imgs[1].dispatchEvent(new Event('error', { bubbles: true }));
    });
    expect(screen.queryByAltText(/Copy/)).not.toBeInTheDocument();
  });

  it('opens the preview overlay when a thumbnail is clicked', () => {
    render(<ImageGallery hits={HITS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cat photo' }));
    expect(
      screen.getByRole('button', { name: 'Close preview' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('closes the preview overlay via the close button', () => {
    render(<ImageGallery hits={HITS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cat photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(
      screen.queryByRole('button', { name: 'Close preview' }),
    ).not.toBeInTheDocument();
  });

  it('closes the preview overlay when clicking the backdrop', () => {
    render(<ImageGallery hits={HITS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cat photo' }));
    const overlay = screen
      .getByRole('button', { name: 'Close preview' })
      .closest('[class*="overlay"]');
    fireEvent.click(overlay!);
    expect(
      screen.queryByRole('button', { name: 'Close preview' }),
    ).not.toBeInTheDocument();
  });

  it('navigates with the prev/next buttons and hides them at the ends', () => {
    render(<ImageGallery hits={HITS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cat photo' }));
    // First image: no previous button, next button present.
    expect(
      screen.queryByRole('button', { name: 'Previous image' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    // Last image: next button hidden, previous button present.
    expect(
      screen.queryByRole('button', { name: 'Next image' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('supports Arrow keys and Escape while the preview is open', () => {
    render(<ImageGallery hits={HITS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cat photo' }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    // At the last index ArrowRight clamps (no crash, still 2 / 2).
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    // At the first index ArrowLeft clamps (still 1 / 2).
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByRole('button', { name: 'Close preview' }),
    ).not.toBeInTheDocument();
  });

  it('scrolls the track horizontally with the wheel event', () => {
    const { container } = render(<ImageGallery hits={HITS} />);
    const track = container.querySelector('[class*="track"]')!;
    // jsdom does not implement Element.scrollBy; define it so the wheel
    // handler can invoke it and we can assert the payload.
    const scrollBy = vi.fn();
    Object.defineProperty(track, 'scrollBy', {
      value: scrollBy,
      configurable: true,
    });
    fireEvent.wheel(track, { deltaY: 40 });
    expect(scrollBy).toHaveBeenCalledWith({ left: 40, behavior: 'instant' });
  });

  it('falls back to "Image N" aria-label and empty alt for title-less hits', () => {
    const titleless: ImageSearchHit = {
      title: '',
      url: 'https://ex.com/x',
      img_src: 'https://ex.com/x.jpg',
      thumbnail_src: 'https://ex.com/x-t.jpg',
      source: 'unsplash',
    };
    render(<ImageGallery hits={[titleless]} />);
    // Thumbnail falls back to `Image 1` and empty alt.
    expect(screen.getByRole('button', { name: 'Image 1' })).toBeInTheDocument();
    expect(screen.getByAltText('')).toBeInTheDocument();
    // Preview overlay alt also falls back to empty.
    fireEvent.click(screen.getByRole('button', { name: 'Image 1' }));
    const previewImgs = screen.getAllByAltText('');
    expect(previewImgs).toHaveLength(2);
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('keeps the preview open when clicking the preview image (stopPropagation)', () => {
    render(<ImageGallery hits={HITS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cat photo' }));
    // Two imgs share the alt while the preview is open: the thumbnail and the
    // preview. Clicking the preview img must not close the overlay.
    const previewImg = screen.getAllByAltText('Cat photo')[1];
    fireEvent.click(previewImg);
    expect(
      screen.getByRole('button', { name: 'Close preview' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('renders a single-hit gallery without nav buttons', () => {
    render(<ImageGallery hits={[HITS[0]]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cat photo' }));
    expect(
      screen.queryByRole('button', { name: 'Previous image' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Next image' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('detaches the keydown listener on unmount while preview is open', () => {
    const { unmount } = render(<ImageGallery hits={HITS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cat photo' }));
    unmount();
    // No listener should remain after unmount; a stray keydown must not throw.
    fireEvent.keyDown(window, { key: 'Escape' });
  });
});
