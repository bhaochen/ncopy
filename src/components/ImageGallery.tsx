import { motion, AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageSearchHit } from '../types/search';
import styles from './ImageGallery.module.css';

interface ImageGalleryProps {
  hits: ImageSearchHit[];
}

export function ImageGallery({ hits }: ImageGalleryProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: e.deltaY, behavior: 'instant' });
  }, []);

  const openPreview = useCallback((index: number) => {
    setPreviewIndex(index);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
  }, []);

  const goNext = useCallback(() => {
    setPreviewIndex((prev) =>
      prev !== null ? Math.min(prev + 1, hits.length - 1) : null,
    );
  }, [hits.length]);

  const goPrev = useCallback(() => {
    setPreviewIndex((prev) =>
      prev !== null ? Math.max(prev - 1, 0) : null,
    );
  }, []);

  useEffect(() => {
    if (previewIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewIndex, closePreview, goNext, goPrev]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.track} ref={trackRef} onWheel={onWheel}>
        {hits.map((hit, i) => (
          <button
            key={hit.img_src}
            type="button"
            className={styles.thumb}
            onClick={() => openPreview(i)}
            aria-label={hit.title || `Image ${i + 1}`}
          >
            <img
              src={hit.img_src}
              alt={hit.title || ''}
              loading="lazy"
              className={styles.thumbImg}
            />
          </button>
        ))}
      </div>

      <AnimatePresence>
        {previewIndex !== null && (
          <motion.div
            key="preview-overlay"
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closePreview}
          >
            <button
              type="button"
              className={styles.closeBtn}
              onClick={closePreview}
              aria-label="Close preview"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            {previewIndex > 0 && (
              <button
                type="button"
                className={`${styles.navBtn} ${styles.navPrev}`}
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                aria-label="Previous image"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {previewIndex < hits.length - 1 && (
              <button
                type="button"
                className={`${styles.navBtn} ${styles.navNext}`}
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                aria-label="Next image"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}

            <div className={styles.counter}>
              {previewIndex + 1} / {hits.length}
            </div>

            <motion.img
              key={hits[previewIndex].img_src}
              src={hits[previewIndex].img_src}
              alt={hits[previewIndex].title || ''}
              className={styles.previewImg}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
