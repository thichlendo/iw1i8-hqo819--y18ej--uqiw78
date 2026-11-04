import React, {useEffect, useRef, useState} from 'react';
import {Play, Pause, Volume2, VolumeX, Music, Film, Sparkles} from 'lucide-react';
import {
  formatDuration,
  type ResolvedVideo,
  type QualityId,
  type AudioMode,
} from '../lib/socialDetector';

interface VideoPreviewPlayerProps {
  video: ResolvedVideo;
  selectedQuality: QualityId;
  audioMode: AudioMode;
  onToggleAudioMode: (nextMode: AudioMode) => void;
}

export const VideoPreviewPlayer: React.FC<VideoPreviewPlayerProps> = ({
  video,
  selectedQuality,
  audioMode,
  onToggleAudioMode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressSec, setProgressSec] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const isMuted = audioMode === 'muted_video';

  // Sync Web Audio synth tone when playing with audio enabled
  useEffect(() => {
    if (!isPlaying || isMuted) {
      if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
        audioCtxRef.current.suspend().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      if (!audioCtxRef.current && AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 220;
        gain.gain.value = 0.015;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        audioCtxRef.current = ctx;
        gainNodeRef.current = gain;
      } else if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    } catch {
      // Ignore Web Audio restriction in headless environments
    }

    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
        audioCtxRef.current.suspend().catch(() => {});
      }
    };
  }, [isPlaying, isMuted]);

  // Reset playback position on video change
  useEffect(() => {
    setProgressSec(0);
    setIsPlaying(false);
  }, [video.id]);

  // Draw procedural frame on canvas (on-demand + playback loop)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let lastTick = performance.now();

    const drawFrame = (timeSec: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Rich cinematic gradient backdrop tuned to platform accent
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#0B1120');
      grad.addColorStop(0.55, '#111C33');
      grad.addColorStop(1, '#090D16');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Subtle glowing orb in platform accent color
      const cx = w * 0.5 + Math.cos(timeSec * 0.9) * (w * 0.18);
      const cy = h * 0.45 + Math.sin(timeSec * 1.1) * (h * 0.12);
      const radGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, w * 0.48);
      radGrad.addColorStop(0, `${video.previewAccent}44`);
      radGrad.addColorStop(0.5, `${video.previewAccent}18`);
      radGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = radGrad;
      ctx.fillRect(0, 0, w, h);

      // Horizon grid / waveform bars
      const barCount = 32;
      const barWidth = (w - 80) / barCount;
      const baseLine = h * 0.72;

      for (let i = 0; i < barCount; i++) {
        const phase = timeSec * 3.2 + i * 0.35;
        const amp = isMuted
          ? 4
          : 12 + Math.abs(Math.sin(phase) * Math.cos(phase * 0.7)) * 36;
        const x = 40 + i * barWidth;
        ctx.fillStyle = isMuted ? 'rgba(148, 163, 184, 0.25)' : video.previewAccent;
        ctx.beginPath();
        ctx.roundRect(x, baseLine - amp / 2, Math.max(3, barWidth - 5), amp, 3);
        ctx.fill();
      }

      // Bottom audio status telemetry inside canvas
      ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
      ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
      const audioStatusText =
        audioMode === 'with_audio'
          ? `ÂM THANH: BẬT (${video.audioCodec})`
          : audioMode === 'muted_video'
            ? 'ÂM THANH: ĐÃ TẮT TIẾNG (STREAM VIDEO-ONLY -AN)'
            : 'CHẾ ĐỘ: CHỈ TẢI ÂM THANH (MP3 320KBPS)';
      ctx.fillText(audioStatusText, 24, h - 22);
    };

    drawFrame(progressSec);

    if (isPlaying) {
      const step = (now: number) => {
        const dt = (now - lastTick) / 1000;
        lastTick = now;
        setProgressSec((prev) => {
          const next = prev + dt;
          if (next >= video.durationSec) {
            setIsPlaying(false);
            return 0;
          }
          drawFrame(next);
          return next;
        });
        animId = requestAnimationFrame(step);
      };
      animId = requestAnimationFrame(step);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [video, selectedQuality, audioMode, isMuted, isPlaying, progressSec]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="relative aspect-video w-full bg-slate-950">
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          data-testid="video-preview-canvas"
          className="h-full w-full object-cover"
        />

        {/* Top overlay info */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-slate-950/85 via-slate-950/40 to-transparent px-4 py-3 text-xs text-slate-300">
          <div className="flex items-center gap-2 font-mono">
            <span>{video.platformName}</span>
            <span aria-hidden="true">·</span>
            <span>{selectedQuality}</span>
            <span aria-hidden="true">·</span>
            <span>{video.noWatermarkAvailable ? 'Không dính Logo' : 'Bản chuẩn'}</span>
          </div>
          <div className="font-mono tabular-nums text-slate-200">
            {formatDuration(progressSec)} / {formatDuration(video.durationSec)}
          </div>
        </div>

        {/* Center Play/Pause trigger */}
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? 'Tạm dừng xem trước' : 'Phát xem trước video'}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/90 text-white shadow-lg transition-transform duration-150 hover:scale-105 focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
          </button>
        </div>
      </div>

      {/* Bottom control bar with quick Audio / Muted toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-900/90 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="inline-flex items-center gap-1.5 font-medium text-slate-200 hover:text-white whitespace-nowrap shrink-0"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isPlaying ? 'Tạm dừng' : 'Xem thử'}</span>
          </button>

          <span className="text-slate-700" aria-hidden="true">|</span>

          <button
            type="button"
            onClick={() =>
              onToggleAudioMode(audioMode === 'muted_video' ? 'with_audio' : 'muted_video')
            }
            className={`inline-flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
              audioMode === 'muted_video'
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-emerald-400 hover:text-emerald-300'
            }`}
          >
            {audioMode === 'muted_video' ? (
              <>
                <VolumeX className="h-4 w-4" />
                <span>Đang chọn: Tải Không Tiếng (Tắt âm)</span>
              </>
            ) : audioMode === 'audio_only' ? (
              <>
                <Music className="h-4 w-4" />
                <span>Đang chọn: Chỉ Âm Thanh (MP3)</span>
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4" />
                <span>Đang chọn: Tải Có Tiếng (Đầy đủ Audio)</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 text-slate-400 font-mono">
          {audioMode === 'audio_only' ? (
            <Music className="h-3.5 w-3.5 text-blue-400" />
          ) : (
            <Film className="h-3.5 w-3.5 text-blue-400" />
          )}
          <span className="truncate max-w-[220px]">{video.audioTrackTitle}</span>
        </div>
      </div>
    </div>
  );
};
