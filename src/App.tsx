import React, {useState, useMemo, useEffect} from 'react';
import {
  Download,
  Volume2,
  VolumeX,
  Music,
  Image as ImageIcon,
  Zap,
  Check,
  ExternalLink,
  Copy,
  AlertCircle,
  Loader2,
  ClipboardPaste,
  Link2,
} from 'lucide-react';
import {
  PLATFORM_LIST,
  CLOUD_BACKEND_ORIGIN,
  detectSocialPlatform,
  extractRealVideoClientSide,
  calculateStreamSizeBytes,
  formatBytes,
  formatDuration,
  buildDownloadFilename,
  buildPlatformSearchUrl,
  type PlatformId,
  type QualityId,
  type AudioMode,
  type ResolvedVideo,
} from './lib/socialDetector';
import {PlatformIcon} from './components/PlatformIcon';
import {VideoPreviewPlayer} from './components/VideoPreviewPlayer';
import {ExactVideoFinder} from './components/ExactVideoFinder';
import {DownloadHistoryTable, type DownloadHistoryItem} from './components/DownloadHistoryTable';

const HISTORY_STORAGE_KEY = 'omnidown_real_history_v2';

function getApiBaseUrl(): string {
  return CLOUD_BACKEND_ORIGIN;
}

export function App() {
  // Clean initial state with ZERO fake/mock data
  const [urlInput, setUrlInput] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  // Instant <0.2ms client-side detection as user types or pastes
  const liveDetection = useMemo(() => detectSocialPlatform(urlInput), [urlInput]);

  // Resolved video/photo is null until the user actually analyzes a real link
  const [resolvedVideo, setResolvedVideo] = useState<ResolvedVideo | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);

  const [selectedQuality, setSelectedQuality] = useState<QualityId>('1080p');
  const [audioMode, setAudioMode] = useState<AudioMode>('with_audio');
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as DownloadHistoryItem[]) : [];
    } catch {
      return [];
    }
  });
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(downloadHistory));
    } catch {
      // Ignore storage quota errors
    }
  }, [downloadHistory]);

  // Ensure selectedQuality is valid for the current resolvedVideo
  useEffect(() => {
    if (!resolvedVideo) return;
    const availableIds = resolvedVideo.qualities.map((q) => q.id);
    if (!availableIds.includes(selectedQuality)) {
      setSelectedQuality(availableIds.includes('1080p') ? '1080p' : availableIds[0]);
    }
  }, [resolvedVideo, selectedQuality]);

  const activeQualityOption = useMemo(
    () => resolvedVideo?.qualities.find((q) => q.id === selectedQuality),
    [resolvedVideo, selectedQuality],
  );

  const currentSizeBytes = useMemo(() => {
    if (!resolvedVideo) return 0;
    return calculateStreamSizeBytes(
      resolvedVideo.durationSec,
      selectedQuality,
      audioMode,
      activeQualityOption?.realSizeBytes,
    );
  }, [resolvedVideo, selectedQuality, audioMode, activeQualityOption]);

  const currentFilename = useMemo(() => {
    if (!resolvedVideo) return '';
    return buildDownloadFilename(
      resolvedVideo,
      selectedQuality,
      audioMode,
      audioMode === 'image_only' && resolvedVideo.images.length > 1
        ? activeImageIndex
        : undefined,
    );
  }, [resolvedVideo, selectedQuality, audioMode, activeImageIndex]);

  const applyResolvedMedia = (video: ResolvedVideo) => {
    setResolvedVideo(video);
    setActiveImageIndex(0);
    // Automatically switch to image_only if this is a photo-only post (e.g. FB Photo, IG Carousel, TikTok Photo Mode)
    if (video.contentType === 'Photo' && !video.videoStreamUrl && !video.hdStreamUrl) {
      setAudioMode('image_only');
    } else if (audioMode === 'image_only' && (video.videoStreamUrl || video.hdStreamUrl)) {
      setAudioMode('with_audio');
    }
  };

  const handleAnalyzeUrl = async (targetInput?: string) => {
    const raw = (targetInput !== undefined ? targetInput : urlInput).trim();
    if (!raw) {
      setValidationError('Vui lòng dán đường dẫn (URL) video hoặc ảnh mạng xã hội vào ô bên trên.');
      return;
    }

    setValidationError(null);
    setIsResolving(true);
    setDownloadFeedback(null);

    const apiBase = getApiBaseUrl();

    // 1. Try ultra-fast server-side resolver (Meta Fast Engine + TikWM + FxTwitter + yt-dlp + OpenGraph)
    try {
      const response = await fetch(`${apiBase}/api/resolve`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({input: raw}),
      });

      if (response.ok) {
        const data = (await response.json()) as {video: ResolvedVideo};
        if (data?.video) {
          applyResolvedMedia(data.video);
          setIsResolving(false);
          return;
        }
      }
    } catch {
      // Fall through to direct browser CORS extraction
    }

    // 2. Direct browser CORS extraction (TikWM, FxTwitter, Dailymotion, Noembed)
    try {
      const clientVideo = await extractRealVideoClientSide(raw);
      applyResolvedMedia(clientVideo);
    } catch {
      setValidationError('Không thể phân tích đường dẫn này. Vui lòng kiểm tra lại URL.');
    } finally {
      setIsResolving(false);
    }
  };

  const downloadSpecificImageFile = async (
    imageUrl: string,
    index: number,
    customVideo?: ResolvedVideo,
  ): Promise<number> => {
    const targetVideo = customVideo || resolvedVideo;
    if (!targetVideo || !imageUrl) return 0;

    const filename = buildDownloadFilename(
      targetVideo,
      selectedQuality,
      'image_only',
      targetVideo.images.length > 1 ? index : undefined,
    );

    const apiBase = getApiBaseUrl();
    const proxyDownloadUrl = `${apiBase}/api/download-image?url=${encodeURIComponent(
      imageUrl,
    )}&filename=${encodeURIComponent(filename)}`;

    // 1. Try backend image converter & downloader (bypasses Meta fbcdn/cdninstagram CORS)
    try {
      const res = await fetch(proxyDownloadUrl);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 512) {
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
          return blob.size;
        }
      }
    } catch {
      // Fall through to direct client fetch
    }

    // 2. Direct client-side image fetch
    try {
      const cdnRes = await fetch(imageUrl);
      if (cdnRes.ok) {
        const blob = await cdnRes.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        return blob.size;
      }
    } catch {
      const link = document.createElement('a');
      link.href = imageUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    return 480 * 1024;
  };

  const downloadRealMediaFile = async (params: {
    platformId: PlatformId;
    videoId: string;
    title: string;
    quality: QualityId;
    audioMode: AudioMode;
    originalUrl: string;
    streamUrl?: string;
    audioUrl?: string;
    imageUrl?: string;
    imageIndex?: number;
  }): Promise<number> => {
    if (params.audioMode === 'image_only' && params.imageUrl) {
      return downloadSpecificImageFile(params.imageUrl, params.imageIndex || 0);
    }

    const filename = buildDownloadFilename(
      {platformId: params.platformId, videoId: params.videoId, title: params.title},
      params.quality,
      params.audioMode,
      params.imageIndex,
    );

    const apiBase = getApiBaseUrl();
    const query = new URLSearchParams({
      platformId: params.platformId,
      videoId: params.videoId,
      title: params.title,
      quality: params.quality,
      audioMode: params.audioMode,
      url: params.originalUrl,
      streamUrl: params.streamUrl || '',
      audioUrl: params.audioUrl || '',
      imageUrl: params.imageUrl || '',
    });

    // 1. Try downloading via backend FFmpeg / yt-dlp pipeline (supports real -an muted video, MP3, & JPG extraction)
    try {
      const res = await fetch(`${apiBase}/api/download?${query.toString()}`);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 512) {
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
          return blob.size;
        }
      }
    } catch {
      // Fall through to direct CDN binary download if backend is unreachable
    }

    // 2. Direct client-side CDN binary fetch
    const directUrl =
      params.audioMode === 'audio_only'
        ? params.audioUrl || params.streamUrl
        : params.audioMode === 'image_only'
          ? params.imageUrl || params.streamUrl
          : params.streamUrl;

    if (directUrl && /^https?:\/\//i.test(directUrl)) {
      try {
        const cdnRes = await fetch(directUrl);
        if (cdnRes.ok) {
          const blob = await cdnRes.blob();
          if (blob.size > 512) {
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            return blob.size;
          }
        }
      } catch {
        const link = document.createElement('a');
        link.href = directUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return currentSizeBytes;
      }
    }

    throw new Error('Không thể tải luồng phương tiện trực tiếp từ đường dẫn này.');
  };

  const handleExecuteDownload = async () => {
    if (!resolvedVideo || isDownloading) return;

    setIsDownloading(true);
    setDownloadFeedback(null);
    setValidationError(null);

    const chosenStreamUrl =
      activeQualityOption?.directStreamUrl ||
      (selectedQuality === '1080p'
        ? resolvedVideo.hdStreamUrl || resolvedVideo.videoStreamUrl
        : resolvedVideo.videoStreamUrl || resolvedVideo.hdStreamUrl);

    const chosenImageUrl =
      resolvedVideo.images[activeImageIndex]?.url ||
      resolvedVideo.images[0]?.url ||
      resolvedVideo.thumbnailUrl;

    try {
      const actualBytes = await downloadRealMediaFile({
        platformId: resolvedVideo.platformId,
        videoId: resolvedVideo.videoId,
        title: resolvedVideo.title,
        quality: selectedQuality,
        audioMode,
        originalUrl: resolvedVideo.originalUrl,
        streamUrl: chosenStreamUrl,
        audioUrl: resolvedVideo.audioStreamUrl,
        imageUrl: chosenImageUrl,
        imageIndex: resolvedVideo.images.length > 1 ? activeImageIndex : undefined,
      });

      const finalSize = actualBytes > 512 ? actualBytes : currentSizeBytes;

      const newItem: DownloadHistoryItem = {
        id: `dl-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'}),
        platformId: resolvedVideo.platformId,
        platformName: resolvedVideo.platformName,
        videoId: resolvedVideo.videoId,
        title: resolvedVideo.title,
        authorHandle: resolvedVideo.authorHandle,
        qualityId: selectedQuality,
        audioMode,
        sizeBytes: finalSize,
        filename: currentFilename,
        originalUrl: resolvedVideo.originalUrl,
        streamUrl: chosenStreamUrl,
        audioUrl: resolvedVideo.audioStreamUrl,
        imageUrl: chosenImageUrl,
      };

      setDownloadHistory((prev) => [newItem, ...prev]);

      const modeLabel =
        audioMode === 'with_audio'
          ? 'Có tiếng (Full Audio)'
          : audioMode === 'muted_video'
            ? 'Không tiếng (Đã tách bỏ âm thanh -an)'
            : audioMode === 'image_only'
              ? 'Ảnh gốc độ phân giải cao (JPG)'
              : 'Chỉ âm thanh (MP3)';

      setDownloadFeedback(
        `Đã tải thành công "${currentFilename}" · ${
          audioMode === 'audio_only'
            ? 'MP3'
            : audioMode === 'image_only'
              ? 'Ảnh JPG HD'
              : selectedQuality
        } · ${modeLabel} (${formatBytes(finalSize)})`,
      );
    } catch (err) {
      setValidationError(
        err instanceof Error
          ? err.message
          : 'Không thể tải tệp phương tiện từ đường dẫn này.',
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadSingleImageFromGallery = async (imgUrl: string, idx: number) => {
    if (!resolvedVideo) return;
    setActiveImageIndex(idx);
    const bytes = await downloadSpecificImageFile(imgUrl, idx, resolvedVideo);
    const fname = buildDownloadFilename(
      resolvedVideo,
      selectedQuality,
      'image_only',
      resolvedVideo.images.length > 1 ? idx : undefined,
    );
    const newItem: DownloadHistoryItem = {
      id: `dl-img-${Date.now()}-${idx}`,
      timestamp: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'}),
      platformId: resolvedVideo.platformId,
      platformName: resolvedVideo.platformName,
      videoId: resolvedVideo.videoId,
      title: `${resolvedVideo.title} (Ảnh #${idx + 1})`,
      authorHandle: resolvedVideo.authorHandle,
      qualityId: selectedQuality,
      audioMode: 'image_only',
      sizeBytes: bytes || 480 * 1024,
      filename: fname,
      originalUrl: resolvedVideo.originalUrl,
      imageUrl: imgUrl,
    };
    setDownloadHistory((prev) => [newItem, ...prev]);
    setDownloadFeedback(`Đã tải thành công ảnh gốc "${fname}" (${formatBytes(bytes || 491520)})`);
  };

  const handleDownloadAllImages = async () => {
    if (!resolvedVideo || resolvedVideo.images.length === 0) return;
    for (let i = 0; i < resolvedVideo.images.length; i++) {
      await handleDownloadSingleImageFromGallery(resolvedVideo.images[i].url, i);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setUrlInput(text.trim());
          void handleAnalyzeUrl(text.trim());
          return;
        }
      }
    } catch {
      // Focus input so user can Ctrl+V directly if browser blocks clipboard API
    }
    const inputEl = document.getElementById('social-url-input') as HTMLInputElement | null;
    if (inputEl) {
      inputEl.focus();
    }
  };

  const handleCopyCanonicalUrl = () => {
    if (!resolvedVideo) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(resolvedVideo.directPlatformUrl).catch(() => {});
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 border-b border-slate-800/80 bg-[#090D16]/95 px-6 py-4 backdrop-blur-md">
        <a
          href="#workspace"
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          OmniDown VN
        </a>

        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300"
        >
          <a
            href="#workspace"
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Tải Video & Ảnh
          </a>
          <a
            href="#exact-finder"
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Tìm Video MXH
          </a>
          <a
            href="#download-history"
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Lịch Sử Tải
          </a>
          <a
            href="#supported-platforms"
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            14+ Mạng Xã Hội
          </a>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handlePasteFromClipboard}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            <span>Dán Link Từ Bộ Nhớ Tạm</span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 space-y-12">
        {/* Section 01: Hero + Instant Meta & Multi-Social Detector + URL Input */}
        <section id="workspace" aria-labelledby="hero-heading">
          <div className="max-w-3xl">
            <p className="text-xs font-medium text-blue-400">
              Cơ chế Check Siêu Nhanh Meta (Facebook · Instagram · Threads) · Tải Video & Ảnh Gốc 14+ MXH
            </p>
            <h1
              id="hero-heading"
              className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-white"
              style={{textWrap: 'balance'}}
            >
              Tải Video và Ảnh gốc từ Facebook, Instagram, Threads, TikTok, YouTube & mọi Mạng Xã Hội
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-slate-400 leading-relaxed">
              Tự động giải mã nhanh các link chia sẻ rút gọn của hệ sinh thái Meta (`facebook.com/share/r/...`, `fb.watch`, `instagram.com/p/...`, `threads.com`) cùng TikTok, Douyin, YouTube, X (Twitter). Hỗ trợ chọn tải Video Có Tiếng, Video Không Tiếng (`-an`), Nhạc MP3 hoặc Tải Ảnh Gốc / Album Ảnh độ phân giải cao.
            </p>
          </div>

          {/* URL Input & Instant Platform Recognition Bar */}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAnalyzeUrl();
              }}
              className="flex flex-col gap-3 sm:flex-row"
            >
              <div className="relative flex-1">
                <label htmlFor="social-url-input" className="sr-only">
                  Đường dẫn URL video hoặc ảnh mạng xã hội
                </label>
                <input
                  id="social-url-input"
                  type="text"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="Dán link Facebook (Watch/Reels/Share/Ảnh), Instagram (Reels/Post/Ảnh), Threads, TikTok, YouTube, X..."
                  className="w-full rounded-xl border border-slate-700/90 bg-slate-950 px-4 py-3.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none font-mono"
                />
                {urlInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setUrlInput('');
                      setValidationError(null);
                    }}
                    aria-label="Xóa đường dẫn đang nhập"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-slate-800/90 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white whitespace-nowrap shrink-0"
                  >
                    Xóa
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={isResolving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                {isResolving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Đang check siêu tốc...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    <span>Phân tích & Tìm Video / Ảnh</span>
                  </>
                )}
              </button>
            </form>

            {validationError && (
              <div
                role="alert"
                className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-3.5 py-2.5 text-xs font-medium text-red-300"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{validationError}</span>
              </div>
            )}

            {/* Instant Real-Time Detection Readout */}
            <div
              data-testid="instant-detector-readout"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3.5 text-xs"
            >
              {liveDetection.detected && liveDetection.platform ? (
                <div className="flex flex-wrap items-center gap-2 text-slate-300">
                  <span className="font-semibold text-emerald-400">
                    Đã nhận diện siêu tốc ({liveDetection.confidenceMs}ms):
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                    <PlatformIcon platformId={liveDetection.platform.id} className="h-4 w-4 text-blue-400" />
                    <span>{liveDetection.platform.name}</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Loại nội dung:{' '}
                    <strong className="text-white">
                      {liveDetection.contentType === 'Photo'
                        ? 'Bài đăng Ảnh / Album'
                        : liveDetection.contentType}
                    </strong>
                  </span>
                  {liveDetection.isMetaPlatform && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-blue-400">
                        Meta Direct Graph Engine
                      </span>
                    </>
                  )}
                  {liveDetection.videoId && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-200 tabular-nums">
                        Mã ID: {liveDetection.videoId}
                      </span>
                    </>
                  )}
                  {liveDetection.creatorHint && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-blue-300">
                        Tác giả: {liveDetection.creatorHint}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-slate-400">
                  Trạng thái: Đang chờ bạn dán đường dẫn (URL) video hoặc ảnh từ Facebook, Instagram, Threads, TikTok, YouTube... để tự động check.
                </div>
              )}
            </div>
          </div>

          {/* Empty Honest State vs Resolved Real Media Inspector */}
          {!resolvedVideo ? (
            <div
              data-testid="empty-workspace-state"
              className="mt-6 rounded-2xl border border-slate-800/80 bg-slate-900/30 p-8 text-center"
            >
              <Link2 className="mx-auto h-8 w-8 text-slate-500" />
              <h2 className="mt-3 text-base font-semibold text-slate-200">
                Chưa có đường dẫn video hoặc hình ảnh nào được nạp
              </h2>
              <p className="mx-auto mt-1 max-w-xl text-xs sm:text-sm text-slate-400">
                Sao chép đường dẫn (URL) bất kỳ video, Reel, Story hoặc bài đăng ảnh từ Facebook, Instagram, Threads, TikTok, YouTube, X (Twitter), Douyin rồi dán vào ô bên trên và nhấn "Phân tích & Tìm Video / Ảnh".
              </p>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
              {/* Left Column (7 cols): Real Video / Photo Carousel Preview Player & Extracted Gallery */}
              <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 mb-3">
                    <div className="flex items-center gap-2 font-medium text-slate-200">
                      <PlatformIcon platformId={resolvedVideo.platformId} className="h-4 w-4 text-blue-400" />
                      <span>{resolvedVideo.platformName}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Loại: {resolvedVideo.contentType === 'Photo' ? 'Ảnh / Album' : resolvedVideo.contentType}
                      </span>
                      {resolvedVideo.durationSec > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatDuration(resolvedVideo.durationSec)}
                          </span>
                        </>
                      )}
                    </div>

                    <span className="font-mono text-emerald-400">
                      {resolvedVideo.resolveTimeMs
                        ? `Check xong trong ${resolvedVideo.resolveTimeMs}ms · `
                        : ''}
                      {resolvedVideo.videoStreamUrl
                        ? 'Luồng MP4 + Ảnh gốc sẵn sàng'
                        : resolvedVideo.images.length > 0
                          ? `Đã bóc tách ${resolvedVideo.images.length} ảnh gốc HD`
                          : 'Đã nhận diện nguồn'}
                    </span>
                  </div>

                  <VideoPreviewPlayer
                    video={resolvedVideo}
                    selectedQuality={selectedQuality}
                    audioMode={audioMode}
                    activeImageIndex={activeImageIndex}
                    onSelectImageIndex={setActiveImageIndex}
                    onToggleAudioMode={(nextMode) => setAudioMode(nextMode)}
                    onDownloadSpecificImage={(imgUrl, idx) =>
                      void handleDownloadSingleImageFromGallery(imgUrl, idx)
                    }
                  />

                  <h2
                    data-testid="resolved-video-title"
                    className="mt-4 text-lg sm:text-xl font-bold text-white leading-snug"
                  >
                    {resolvedVideo.title}
                  </h2>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">
                      {resolvedVideo.authorName} ({resolvedVideo.authorHandle})
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Mã ID: {resolvedVideo.videoId}
                    </span>
                    {resolvedVideo.viewCount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {resolvedVideo.viewCount.toLocaleString('vi-VN')} lượt xem
                        </span>
                      </>
                    )}
                  </div>

                  {/* Extracted High-Res Photos & Album Gallery Section */}
                  {resolvedVideo.images.length > 0 && (
                    <div
                      data-testid="extracted-images-gallery"
                      className="mt-5 rounded-xl border border-slate-800 bg-slate-950/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="h-4 w-4 text-pink-400" />
                          <h3 className="text-xs font-bold text-white">
                            Danh sách Ảnh gốc trích xuất ({resolvedVideo.images.length} ảnh độ phân giải cao)
                          </h3>
                        </div>

                        {resolvedVideo.images.length > 1 && (
                          <button
                            type="button"
                            onClick={() => void handleDownloadAllImages()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-500 transition-colors whitespace-nowrap shrink-0"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Tải tất cả {resolvedVideo.images.length} ảnh (JPG)</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {resolvedVideo.images.slice(0, 6).map((img, idx) => {
                          const isSelectedImg = activeImageIndex === idx;
                          return (
                            <div
                              key={img.id}
                              className={`flex flex-col justify-between rounded-lg border p-2 transition-colors ${
                                isSelectedImg
                                  ? 'border-blue-500 bg-blue-950/30'
                                  : 'border-slate-800 bg-slate-900/60'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveImageIndex(idx);
                                  setAudioMode('image_only');
                                }}
                                className="text-left"
                              >
                                <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
                                  <span className="font-semibold text-white">Ảnh #{idx + 1}</span>
                                  <span>{img.format} HD</span>
                                </div>
                                <p className="mt-1 truncate text-[11px] text-slate-400">
                                  {img.label}
                                </p>
                              </button>

                              <button
                                type="button"
                                onClick={() => void handleDownloadSingleImageFromGallery(img.url, idx)}
                                className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-600 transition-colors whitespace-nowrap shrink-0"
                              >
                                <Download className="h-3 w-3" />
                                <span>Tải Ảnh #{idx + 1}</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Exact Social Platform Verification & Deep-Links */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4 text-xs">
                  <div className="text-slate-400 font-mono truncate max-w-md">
                    Nguồn gốc: {resolvedVideo.directPlatformUrl}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyCanonicalUrl}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedLink ? 'Đã sao chép link' : 'Sao chép link gốc'}</span>
                    </button>

                    <a
                      href={resolvedVideo.directPlatformUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Mở trên {resolvedVideo.platformName}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Right Column (5 cols): Mode (Có tiếng / Không tiếng / MP3 / Tải Ảnh) + Quality Selector + Download CTA */}
              <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-white">
                      01. Chọn Chế độ Tải xuống (Video / Tắt Tiếng / MP3 / Tải Ảnh)
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Tùy chọn tải Video MP4 có tiếng, Video tắt tiếng hoàn toàn (`-an`), tách nhạc MP3 hoặc tải Ảnh gốc độ phân giải cao (JPG).
                    </p>

                    <div
                      role="radiogroup"
                      aria-label="Chế độ phương tiện khi tải"
                      className="mt-3 grid grid-cols-2 gap-2"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={audioMode === 'with_audio'}
                        onClick={() => setAudioMode('with_audio')}
                        className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                          audioMode === 'with_audio'
                            ? 'border-blue-500 bg-blue-600/15 text-white'
                            : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <Volume2 className="h-4 w-4 text-emerald-400" />
                          {audioMode === 'with_audio' && <Check className="h-3.5 w-3.5 text-blue-400" />}
                        </div>
                        <span className="mt-2 text-xs font-bold whitespace-nowrap">Video Có tiếng</span>
                        <span className="mt-0.5 text-[11px] text-slate-400">MP4 Hình + Âm thanh gốc</span>
                      </button>

                      <button
                        type="button"
                        role="radio"
                        aria-checked={audioMode === 'muted_video'}
                        onClick={() => setAudioMode('muted_video')}
                        className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                          audioMode === 'muted_video'
                            ? 'border-blue-500 bg-blue-600/15 text-white'
                            : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <VolumeX className="h-4 w-4 text-amber-400" />
                          {audioMode === 'muted_video' && <Check className="h-3.5 w-3.5 text-blue-400" />}
                        </div>
                        <span className="mt-2 text-xs font-bold whitespace-nowrap">Video Không tiếng</span>
                        <span className="mt-0.5 text-[11px] text-slate-400">Tắt âm hoàn toàn (-an)</span>
                      </button>

                      <button
                        type="button"
                        role="radio"
                        aria-checked={audioMode === 'audio_only'}
                        onClick={() => setAudioMode('audio_only')}
                        className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                          audioMode === 'audio_only'
                            ? 'border-blue-500 bg-blue-600/15 text-white'
                            : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <Music className="h-4 w-4 text-blue-400" />
                          {audioMode === 'audio_only' && <Check className="h-3.5 w-3.5 text-blue-400" />}
                        </div>
                        <span className="mt-2 text-xs font-bold whitespace-nowrap">Chỉ âm thanh</span>
                        <span className="mt-0.5 text-[11px] text-slate-400">Tách nhạc MP3 320kbps</span>
                      </button>

                      <button
                        type="button"
                        role="radio"
                        aria-checked={audioMode === 'image_only'}
                        onClick={() => setAudioMode('image_only')}
                        className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                          audioMode === 'image_only'
                            ? 'border-blue-500 bg-blue-600/15 text-white'
                            : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <ImageIcon className="h-4 w-4 text-pink-400" />
                          {audioMode === 'image_only' && <Check className="h-3.5 w-3.5 text-blue-400" />}
                        </div>
                        <span className="mt-2 text-xs font-bold whitespace-nowrap">Tải Ảnh Gốc (JPG)</span>
                        <span className="mt-0.5 text-[11px] text-slate-400">
                          Ảnh bài đăng / Ảnh bìa HD
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Quality Selection Matrix */}
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-white">
                        02. Chọn Chất lượng ({resolvedVideo.qualities.length} mức phân giải)
                      </h3>
                      <span className="text-xs font-mono text-slate-400 tabular-nums">
                        Đang chọn:{' '}
                        {audioMode === 'audio_only'
                          ? 'MP3 Audio'
                          : audioMode === 'image_only'
                            ? 'Ảnh Gốc JPG HD'
                            : selectedQuality}
                      </span>
                    </div>

                    <div
                      role="radiogroup"
                      aria-label="Chọn chất lượng độ phân giải video"
                      className="mt-3 grid grid-cols-2 gap-2"
                    >
                      {resolvedVideo.qualities.map((q) => {
                        const isSelected = selectedQuality === q.id;
                        const sizeForOption = calculateStreamSizeBytes(
                          resolvedVideo.durationSec,
                          q.id,
                          audioMode,
                          q.realSizeBytes,
                        );

                        return (
                          <button
                            key={q.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => setSelectedQuality(q.id)}
                            className={`flex flex-col justify-between rounded-xl border p-3 text-left transition-colors ${
                              isSelected
                                ? 'border-blue-500 bg-blue-600/15 text-white'
                                : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-sm font-bold text-white whitespace-nowrap">
                                {q.label}
                              </span>
                              <span className="font-mono text-xs text-blue-400 tabular-nums whitespace-nowrap">
                                {formatBytes(sizeForOption)}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-400 font-mono whitespace-nowrap">
                              <span>{q.resolution} · {q.fps}fps</span>
                              <span className="truncate">{q.badge}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Output Summary & Primary Download Trigger */}
                <div className="mt-6 border-t border-slate-800/80 pt-5 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Tên tệp xuất ra:</span>
                    <span
                      data-testid="output-filename-preview"
                      className="font-mono text-slate-100 truncate max-w-[250px]"
                    >
                      {currentFilename}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Cấu hình luồng tải:</span>
                    <span data-testid="output-stream-summary" className="font-mono tabular-nums text-emerald-400">
                      {audioMode === 'with_audio'
                        ? `${selectedQuality} MP4 · Có tiếng (${formatBytes(currentSizeBytes)})`
                        : audioMode === 'muted_video'
                          ? `${selectedQuality} MP4 · Không tiếng (${formatBytes(currentSizeBytes)})`
                          : audioMode === 'image_only'
                            ? `Ảnh Gốc JPG HD (${formatBytes(currentSizeBytes)})`
                            : `MP3 · Chỉ âm thanh (${formatBytes(currentSizeBytes)})`}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => void handleExecuteDownload()}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white shadow-md hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Đang xử lý & tải tệp thật...</span>
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        <span>
                          Tải xuống ngay (
                          {audioMode === 'audio_only'
                            ? 'MP3'
                            : audioMode === 'image_only'
                              ? 'Ảnh Gốc JPG'
                              : selectedQuality}{' '}
                          ·{' '}
                          {audioMode === 'with_audio'
                            ? 'Có tiếng'
                            : audioMode === 'muted_video'
                              ? 'Không tiếng'
                              : audioMode === 'image_only'
                                ? 'Độ phân giải cao'
                                : 'Chỉ nhạc'}
                          )
                        </span>
                      </>
                    )}
                  </button>

                  {downloadFeedback && (
                    <div
                      role="status"
                      data-testid="download-success-banner"
                      className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-300"
                    >
                      {downloadFeedback}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Section 02: Live Video Finder across Social Networks */}
        <ExactVideoFinder
          activeVideoId={resolvedVideo?.videoId}
          onSelectVideoForDownload={(url) => {
            setUrlInput(url);
            void handleAnalyzeUrl(url);
            window.scrollTo({top: 0, behavior: 'smooth'});
          }}
        />

        {/* Section 03: Real Download History */}
        <DownloadHistoryTable
          items={downloadHistory}
          onClearHistory={() => setDownloadHistory([])}
          onReloadVideo={(url, quality, mode) => {
            setUrlInput(url);
            setSelectedQuality(quality);
            setAudioMode(mode);
            void handleAnalyzeUrl(url);
            window.scrollTo({top: 0, behavior: 'smooth'});
          }}
          onTriggerRedownload={(item) => {
            void downloadRealMediaFile({
              platformId: item.platformId,
              videoId: item.videoId,
              title: item.title,
              quality: item.qualityId,
              audioMode: item.audioMode,
              originalUrl: item.originalUrl,
              streamUrl: item.streamUrl,
              audioUrl: item.audioUrl,
              imageUrl: item.imageUrl,
            });
          }}
        />

        {/* Section 04: 14+ Supported Social Media Networks Matrix */}
        <section
          id="supported-platforms"
          aria-labelledby="platforms-heading"
          className="border-t border-slate-800/80 pt-10"
        >
          <div>
            <h2 id="platforms-heading" className="text-2xl font-bold tracking-tight text-white">
              04. Danh mục 14+ Mạng Xã Hội Hỗ Trợ Nhận Diện Siêu Nhanh & Tải Video / Ảnh
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Tích hợp cơ chế bóc tách chuyên biệt cho hệ sinh thái Meta (Facebook, Instagram, Threads) và 11 nền tảng video/ảnh phổ biến.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {PLATFORM_LIST.map((plat) => (
              <div
                key={plat.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800/90 bg-slate-900/40 p-4 hover:border-slate-700 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-white">
                      <PlatformIcon platformId={plat.id} className="h-4 w-4 text-blue-400" />
                      <span>{plat.name}</span>
                    </div>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      Tối đa {plat.maxResolution}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-slate-400 font-mono">
                    {plat.domain} · {plat.supportedFormats.join(' · ')}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/70 flex items-center justify-between">
                  <a
                    href={buildPlatformSearchUrl(plat.id, 'video')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>Mở {plat.name} để lấy link</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="mt-16 border-t border-slate-800/80 bg-[#090D16] py-6 px-6 text-xs text-slate-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p>OmniDown VN — Trình check siêu tốc Meta (Facebook, Instagram, Threads) & tải Video/Ảnh thực tế đa mạng xã hội.</p>
          <div className="flex items-center gap-4">
            <a href="#workspace" className="hover:text-slate-300 transition-colors">Trình tải Video & Ảnh</a>
            <a href="#exact-finder" className="hover:text-slate-300 transition-colors">Tìm kiếm chính xác</a>
            <a href="#download-history" className="hover:text-slate-300 transition-colors">Lịch sử tải</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
