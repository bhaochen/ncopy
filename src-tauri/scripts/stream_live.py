#!/usr/bin/env python3
"""Resident streaming live-video service for the Thuki mascot.

Loads the SoulX-FlashHead `lite` model once, then serves `generate` requests
over a line protocol:

  stdin  -> {"cmd":"generate","wav":"<path>","out_dir":"<dir>","run":<int>}
  stdout <- one JSON line per event:
             {"event":"ready"}                       model loaded, service up
             {"event":"segment","run":N,"path":P}    a playable mp4 segment
             {"event":"done","run":N}                 generation finished
             {"event":"error","run":N,"msg":"..."}   generation failed

The `lite` model with 2 denoise steps generates ~25.5 fps on an RTX 4060, just
faster than the 25 fps playback rate, so segments can be streamed back-to-back
with no stutter. Every segment is an mp4 with its own AAC track (the audio
slice that drove it), so the frontend gets sight *and* sound from the video
element instead of a separate speaker playback.

Kept deliberately dependency-light (numpy/librosa/torch/imageio + ffmpeg on
PATH), mirroring the official gradio streaming demo's chunk+segment structure.
"""

import json
import os
import sys
import time
from collections import deque
from pathlib import Path

# The model project is a sibling checkout; its .venv python runs this script,
# so torch/librosa/imageio are importable from there.
FLASHHEAD_PROJECT = os.path.expanduser("~/Code/Llm/SoulX-FlashHead")
MODELS_DIR = os.path.join(FLASHHEAD_PROJECT, "models")
FLASHHEAD_CKPT_DIR = os.path.join(MODELS_DIR, "SoulX-FlashHead-1_3B")
WAV2VEC_DIR = os.path.join(MODELS_DIR, "wav2vec2-base-960h")
# The app's own condition headshot, falling back to the model example.
COND_IMAGE = os.path.expanduser("~/Code/Agent/ncopy/public/girl.png")
if not os.path.isfile(COND_IMAGE):
    COND_IMAGE = os.path.join(FLASHHEAD_PROJECT, "examples", "girl.png")

# 2 denoise steps: ~25.5 fps on a 4060 vs 25 fps playback (4 steps is ~23.6
# fps and stalls the stream). Quality is lower but the mouth stays in sync.
SAMPLE_STEPS = 2
# Frames are produced in chunks of `slice_len`; group this many chunks into
# one playable segment (~2.9 s) so encode overhead and segment switches stay
# low while the first segment still lands within ~3 s.
CHUNKS_PER_SEGMENT = 3

# The model's streaming mode predicts the current frames from the last
# `cached_audio_duration` seconds of audio; the official scripts pre-fill the
# deque with silence so the first chunk can already be generated.
# (All values are read from infer_params at runtime.)

import numpy as np
import librosa

import torch
import imageio

sys.path.insert(0, FLASHHEAD_PROJECT)
import flash_head.inference as fi
from flash_head.inference import (
    get_pipeline,
    get_base_data,
    get_infer_params,
    get_audio_embedding,
    run_pipeline,
)


def emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def write_segment_mp4(frames, segment_path, wav_path, fps):
    """Writes `frames` (B,F,H,W,3 uint8 tensor batch) to an mp4 whose audio
    track is the 16 kHz slice in `wav_path`. Video-only first, then mux."""
    tmp = str(segment_path).replace(".mp4", "_tmp.mp4")
    with imageio.get_writer(
        tmp, format="mp4", mode="I", fps=fps, codec="h264",
        ffmpeg_params=["-bf", "0"],
    ) as writer:
        for frames_batch in frames:
            arr = frames_batch.numpy().astype(np.uint8)
            for i in range(arr.shape[0]):
                writer.append_data(arr[i])
    try:
        import subprocess

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", tmp,
                "-i", wav_path,
                "-c:v", "copy",
                "-c:a", "aac",
                "-shortest",
                str(segment_path),
            ],
            check=True,
            capture_output=True,
        )
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def save_slice_wav(audio: np.ndarray, wav_path, sample_rate=16000):
    """Writes a float32 [-1,1] mono array as a 16-bit PCM wav (the slice that
    drove this segment, so its mp4 is self-contained with matching audio)."""
    samples = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    import wave

    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(samples.tobytes())


def main() -> int:
    try:
        pipeline = get_pipeline(
            world_size=1,
            ckpt_dir=FLASHHEAD_CKPT_DIR,
            wav2vec_dir=WAV2VEC_DIR,
            model_type="lite",
        )
        # get_pipeline hardcodes sample_steps=4 for non-pretrained models;
        # override to 2 *before* get_base_data so prepare_params sees it.
        fi.infer_params["sample_steps"] = SAMPLE_STEPS
        get_base_data(
            pipeline,
            cond_image_path_or_dir=COND_IMAGE,
            base_seed=42,
            use_face_crop=False,
        )
    except Exception as e:  # model load failure is fatal for the service
        emit({"event": "error", "msg": f"load: {e}"})
        return 1

    ip = get_infer_params()
    sample_rate = ip["sample_rate"]
    tgt_fps = ip["tgt_fps"]
    cached_audio_duration = ip["cached_audio_duration"]
    frame_num = ip["frame_num"]
    motion_frames_num = ip["motion_frames_num"]
    slice_len = frame_num - motion_frames_num
    slice_audio_len = slice_len * sample_rate // tgt_fps
    cached_audio_length_sum = sample_rate * cached_audio_duration
    audio_end_idx = cached_audio_duration * tgt_fps
    audio_start_idx = audio_end_idx - frame_num

    emit({"event": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"event": "error", "msg": f"bad request: {e}"})
            continue
        if req.get("cmd") != "generate":
            continue
        run = int(req.get("run", 0))
        wav_path = req.get("wav")
        out_dir = Path(req.get("out_dir", "."))
        if not wav_path or not os.path.isfile(wav_path):
            emit({"event": "error", "run": run, "msg": "wav missing"})
            continue
        try:
            _generate(
                pipeline,
                wav_path,
                out_dir,
                run,
                sample_rate,
                tgt_fps,
                slice_len,
                slice_audio_len,
                cached_audio_length_sum,
                audio_start_idx,
                audio_end_idx,
                motion_frames_num,
            )
            emit({"event": "done", "run": run})
        except Exception as e:
            emit({"event": "error", "run": run, "msg": str(e)})
    return 0


def _generate(
    pipeline,
    wav_path,
    out_dir,
    run,
    sample_rate,
    tgt_fps,
    slice_len,
    slice_audio_len,
    cached_audio_length_sum,
    audio_start_idx,
    audio_end_idx,
    motion_frames_num,
):
    audio, _ = librosa.load(wav_path, sr=sample_rate, mono=True)
    remainder = len(audio) % slice_audio_len
    if remainder > 0:
        audio = np.concatenate(
            [audio, np.zeros(slice_audio_len - remainder, dtype=audio.dtype)]
        )
    slices = audio.reshape(-1, slice_audio_len)

    # The audio that will drive each segment, pre-cut so the segment mp4 can
    # carry its own matching track.
    num_segments = (len(slices) + CHUNKS_PER_SEGMENT - 1) // CHUNKS_PER_SEGMENT
    segment_wavs = []
    for seg in range(num_segments):
        start = seg * CHUNKS_PER_SEGMENT
        end = min(start + CHUNKS_PER_SEGMENT, len(slices))
        seg_wav = out_dir / f"seg_{run}_{seg:04d}.wav"
        save_slice_wav(np.concatenate(slices[start:end]), seg_wav, sample_rate)
        segment_wavs.append(seg_wav)

    audio_dq = deque([0.0] * cached_audio_length_sum, maxlen=cached_audio_length_sum)
    frame_buffer = []
    emitted_segments = 0
    for chunk_idx, chunk in enumerate(slices):
        audio_dq.extend(chunk.tolist())
        audio_array = np.array(audio_dq)
        embedding = get_audio_embedding(pipeline, audio_array, audio_start_idx, audio_end_idx)
        video = run_pipeline(pipeline, embedding)
        video = video[motion_frames_num:]
        frame_buffer.append(video.cpu())
        if len(frame_buffer) == CHUNKS_PER_SEGMENT:
            seg = emitted_segments
            seg_path = out_dir / f"seg_{run}_{seg:04d}.mp4"
            write_segment_mp4(frame_buffer, seg_path, segment_wavs[seg], tgt_fps)
            emit({"event": "segment", "run": run, "path": str(seg_path)})
            frame_buffer = []
            emitted_segments += 1

    if frame_buffer:
        seg = emitted_segments
        seg_path = out_dir / f"seg_{run}_{seg:04d}.mp4"
        write_segment_mp4(frame_buffer, seg_path, segment_wavs[seg], tgt_fps)
        emit({"event": "segment", "run": run, "path": str(seg_path)})
        emitted_segments += 1

    for w in segment_wavs:
        try:
            os.remove(w)
        except OSError:
            pass

    # The input wav was owned by the requester; the generation consumed it.
    try:
        os.remove(wav_path)
    except OSError:
        pass


if __name__ == "__main__":
    sys.exit(main())
