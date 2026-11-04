import React, {useEffect, useRef, useState} from 'react';
import {Volume2, VolumeX, Music, Film, ExternalLink} from 'lucide-react';
import {
  formatDuration,
  CLOUD_BACKEND_ORIGIN,
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamError, setStreamError] = useState(false);
  const [imgError, setImgError] = useState(false);

  const isMuted = audioMode === 'muted_video';

  // Pick the best available stream URL for preview
  const rawStreamUrl =
    selectedQuality === '1080p'
      ? video.hdStreamUrl || video.videoStreamUrl
      : video.videoStreamUrl || video.hdStreamUrl;

  // Use direct CDN URL if CORS-friendly (e.g. TikWM / Twimg) or proxy via backend if needed
  const playableSrc = rawStreamUrl || undefined;

  useEffect(() => {
    setStreamError(false);
    setImgError(false);
  }, [video.id, rawStreamUrl, video.thumbnailUrl]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const proxyStreamUrl =
    rawStreamUrl && typeof window !== 'undefined'
      ? `${
          window.location.hostname.includes('github.io') ||
          window.location.hostname.includes('thichlendo.site')
            ? CLOUD_BACKEND_ORIGIN
            : ''
        }/api/stream-proxy?url=${encodeURIComponent(rawStreamUrl)}`
      : undefined;

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center overflow-hidden">
        {playableSrc && !streamError ? (
          <video
            ref={videoRef}
            key={playableSrc}
            src={playableSrc}
            poster={!imgError ? video.thumbnailUrl : undefined}
            muted={isMuted}
            controls
            playsInline
            preload="metadata"
            data-testid="real-html5-video-player"
            onError={() => {
              // If direct CDN blocked by CORP, try proxy once before falling back to thumbnail
              if (
                videoRef.current &&
                proxyStreamUrl &&
                videoRef.current.src !== proxyStreamUrl
              ) {
                videoRef.current.src = proxyStreamUrl;
              } else {
                setStreamError(true);
              }
            }}
            className="h-full w-full object-contain bg-black"
          />
        ) : video.thumbnailUrl && !imgError ? (
          <div className="relative h-full w-full">
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-slate-950/60 flex flex-col items-center justify-center p-6 text-center">
              <p className="text-xs font-mono text-slate-300">
                Đã lấy ảnh bìa & siêu dữ liệu gốc từ {video.platformName} ({selectedQuality})
              </p>
              <a
                href={video.directPlatformUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
              >
                <span>Xem trực tiếp trên {video.platformName}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <Film className="h-8 w-8 text-blue-400 mb-2" />
            <p className="text-sm font-semibold text-slate-200">
              {video.platformName} · Mã Video: {video.videoId}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Độ phân giải đã chọn: {selectedQuality} · Thời lượng: {formatDuration(video.durationSec)}
            </p>
          </div>
        )}
      </div>

      {/* Bottom control bar with quick Audio / Muted toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-900/90 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-3">
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
                <span>Chế độ: Tải Không Tiếng (Tắt âm -an)</span>
              </>
            ) : audioMode === 'audio_only' ? (
              <>
                <Music className="h-4 w-4" />
                <span>Chế độ: Chỉ Âm Thanh (MP3)</span>
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4" />
                <span>Chế độ: Tải Có Tiếng (Đầy đủ Audio)</span>
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
          <span className="truncate max-w-[240px]">
            {video.videoStreamUrl ? 'Luồng Video Gốc Trực Tiếp (CDN)' : video.audioTrackTitle}
          </span>
        </div>
      </div>
    </div>
  );
};
