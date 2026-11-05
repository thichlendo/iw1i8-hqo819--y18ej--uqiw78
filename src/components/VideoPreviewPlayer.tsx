import React, {useEffect, useRef, useState} from 'react';
import {
  Volume2,
  VolumeX,
  Music,
  Film,
  ExternalLink,
  Image as ImageIcon,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
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
  activeImageIndex: number;
  onSelectImageIndex: (idx: number) => void;
  onToggleAudioMode: (nextMode: AudioMode) => void;
  onDownloadSpecificImage: (imageUrl: string, index: number) => void;
}

function buildProxyUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  return `${CLOUD_BACKEND_ORIGIN}/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`;
}

function shouldProxyImage(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  const lower = rawUrl.toLowerCase();
  return (
    lower.includes('fbsbx.com') ||
    lower.includes('fbcdn.net') ||
    lower.includes('cdninstagram.com') ||
    lower.includes('instagram.com') ||
    lower.includes('facebook.com')
  );
}

export const VideoPreviewPlayer: React.FC<VideoPreviewPlayerProps> = ({
  video,
  selectedQuality,
  audioMode,
  activeImageIndex,
  onSelectImageIndex,
  onToggleAudioMode,
  onDownloadSpecificImage,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamError, setStreamError] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [useProxiedImg, setUseProxiedImg] = useState(false);
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);

  const isMuted = audioMode === 'muted_video';
  const isImageMode =
    audioMode === 'image_only' ||
    (video.contentType === 'Photo' && !video.videoStreamUrl && !video.hdStreamUrl);

  const rawStreamUrl =
    selectedQuality === '1080p'
      ? video.hdStreamUrl || video.videoStreamUrl
      : video.videoStreamUrl || video.hdStreamUrl;

  const playableSrc = rawStreamUrl || undefined;
  const proxyStreamUrl = buildProxyUrl(rawStreamUrl);

  const images = video.images || [];
  const safeImgIndex =
    images.length > 0 ? Math.min(activeImageIndex, images.length - 1) : 0;
  const activeImageItem = images[safeImgIndex];
  const rawDisplayImgUrl = activeImageItem?.url || video.thumbnailUrl;
  const displayImgUrl =
    useProxiedImg || shouldProxyImage(rawDisplayImgUrl)
      ? buildProxyUrl(rawDisplayImgUrl)
      : rawDisplayImgUrl;

  useEffect(() => {
    setStreamError(false);
    setImgError(false);
    setUseProxiedImg(false);
    setSnapshotNotice(null);
  }, [video.id, rawStreamUrl, rawDisplayImgUrl]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const handleCaptureVideoFrame = () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || v.videoWidth === 0) {
      if (rawDisplayImgUrl) {
        onDownloadSpecificImage(rawDisplayImgUrl, safeImgIndex);
      }
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${video.platformId}_${video.videoId}_frame_${Math.floor(v.currentTime)}s.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setSnapshotNotice(`Đã chụp & tải khung hình (${v.videoWidth}×${v.videoHeight} JPG)`);
      setTimeout(() => setSnapshotNotice(null), 3000);
    } catch {
      if (rawDisplayImgUrl) {
        onDownloadSpecificImage(rawDisplayImgUrl, safeImgIndex);
      }
    }
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center overflow-hidden">
        {!isImageMode && playableSrc && !streamError ? (
          <video
            ref={videoRef}
            key={playableSrc}
            src={playableSrc}
            poster={!imgError ? displayImgUrl : undefined}
            muted={isMuted}
            controls
            playsInline
            preload="metadata"
            data-testid="real-html5-video-player"
            onError={() => {
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
        ) : displayImgUrl && !imgError ? (
          <div className="relative h-full w-full flex items-center justify-center bg-black">
            <img
              src={displayImgUrl}
              alt={activeImageItem?.label || video.title}
              referrerPolicy="no-referrer"
              onError={() => {
                if (!useProxiedImg && rawDisplayImgUrl) {
                  setUseProxiedImg(true);
                } else {
                  setImgError(true);
                }
              }}
              className="h-full w-full object-contain"
            />

            {/* Carousel Left / Right Navigation if multiple photos exist */}
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Ảnh trước"
                  onClick={() =>
                    onSelectImageIndex((safeImgIndex - 1 + images.length) % images.length)
                  }
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-white hover:bg-slate-800 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Ảnh tiếp theo"
                  onClick={() => onSelectImageIndex((safeImgIndex + 1) % images.length)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-white hover:bg-slate-800 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}

            {/* Top-right overlay action to download this exact image immediately */}
            {rawDisplayImgUrl && (
              <div className="absolute right-3 top-3 flex items-center gap-2">
                {images.length > 1 && (
                  <span className="rounded-md border border-slate-700 bg-slate-950/90 px-2.5 py-1 text-xs font-mono font-semibold text-white">
                    Ảnh {safeImgIndex + 1} / {images.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onDownloadSpecificImage(rawDisplayImgUrl, safeImgIndex)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Tải Ảnh Gốc Này (JPG)</span>
                </button>
              </div>
            )}

            {!isImageMode && !playableSrc && (
              <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/90 px-3.5 py-2 text-xs">
                <span className="font-mono text-slate-300">
                  Đã trích xuất ảnh gốc độ phân giải cao từ {video.platformName}
                </span>
                <a
                  href={video.directPlatformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-blue-400 hover:text-blue-300"
                >
                  <span>Mở bài đăng gốc</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <Film className="h-8 w-8 text-blue-400 mb-2" />
            <p className="text-sm font-semibold text-slate-200">
              {video.platformName} · Mã Media: {video.videoId}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Độ phân giải đã chọn: {selectedQuality} · Thời lượng: {formatDuration(video.durationSec)}
            </p>
          </div>
        )}
      </div>

      {/* Bottom control bar with quick Audio / Muted / Image toggle + Frame Snapshot */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-900/90 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onToggleAudioMode(
                audioMode === 'muted_video'
                  ? 'with_audio'
                  : audioMode === 'image_only'
                    ? 'with_audio'
                    : 'muted_video',
              )
            }
            className={`inline-flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
              audioMode === 'muted_video'
                ? 'text-amber-400 hover:text-amber-300'
                : audioMode === 'image_only'
                  ? 'text-pink-400 hover:text-pink-300'
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
            ) : audioMode === 'image_only' ? (
              <>
                <ImageIcon className="h-4 w-4" />
                <span>Chế độ: Tải Ảnh Gốc Độ Phân Giải Cao (JPG)</span>
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4" />
                <span>Chế độ: Tải Có Tiếng (Đầy đủ Audio)</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {playableSrc && !isImageMode && (
            <button
              type="button"
              onClick={handleCaptureVideoFrame}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Camera className="h-3.5 w-3.5 text-blue-400" />
              <span>{snapshotNotice || 'Chụp & Tải Ảnh Khung Hình'}</span>
            </button>
          )}

          {rawDisplayImgUrl && (
            <button
              type="button"
              onClick={() => onDownloadSpecificImage(rawDisplayImgUrl, safeImgIndex)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <ImageIcon className="h-3.5 w-3.5 text-pink-400" />
              <span>Tải Ảnh Bìa / Ảnh Gốc ({images.length || 1})</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
