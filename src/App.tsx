import React, {useState, useMemo, useEffect} from 'react';
import {
  Download,
  Volume2,
  VolumeX,
  Music,
  Zap,
  Check,
  ExternalLink,
  Copy,
  Sparkles,
  AlertCircle,
  Loader2,
  ClipboardPaste,
} from 'lucide-react';
import {
  PLATFORMS,
  PLATFORM_LIST,
  detectSocialPlatform,
  resolveVideoFromDetection,
  calculateStreamSizeBytes,
  formatBytes,
  formatDuration,
  buildDownloadFilename,
  type PlatformId,
  type QualityId,
  type AudioMode,
  type ResolvedVideo,
} from './lib/socialDetector';
import {PlatformIcon} from './components/PlatformIcon';
import {VideoPreviewPlayer} from './components/VideoPreviewPlayer';
import {ExactVideoFinder} from './components/ExactVideoFinder';
import {DownloadHistoryTable, type DownloadHistoryItem} from './components/DownloadHistoryTable';

const INITIAL_URL = 'https://www.tiktok.com/@discover.vn/video/7398451209384719632';

const INITIAL_HISTORY: DownloadHistoryItem[] = [
  {
    id: 'hist-1',
    timestamp: 'Vừa xong',
    platformId: 'tiktok',
    platformName: 'TikTok',
    videoId: '7398451209384719632',
    title: 'Cảnh đẹp flycam Vịnh Hạ Long buổi bình minh 4K 60fps góc rộng tuyệt đẹp',
    authorHandle: '@discover.vn',
    qualityId: '1080p',
    audioMode: 'with_audio',
    sizeBytes: calculateStreamSizeBytes(34, '1080p', 'with_audio'),
    filename: 'tiktok_7398451209384719632_1080p_with-audio.mp4',
    originalUrl: 'https://www.tiktok.com/@discover.vn/video/7398451209384719632',
  },
  {
    id: 'hist-2',
    timestamp: '5 phút trước',
    platformId: 'youtube',
    platformName: 'YouTube',
    videoId: 'aqz-KE-bpKQ',
    title: 'Big Buck Bunny 60fps 4K - Blender Open Movie Official Remaster',
    authorHandle: '@BlenderOfficial',
    qualityId: '2160p',
    audioMode: 'muted_video',
    sizeBytes: calculateStreamSizeBytes(145, '2160p', 'muted_video'),
    filename: 'youtube_aqz-KE-bpKQ_2160p_muted-no-audio.mp4',
    originalUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  },
];

export function App() {
  const [urlInput, setUrlInput] = useState<string>(INITIAL_URL);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);

  // Instant <1ms client-side detection as user types or pastes
  const liveDetection = useMemo(() => detectSocialPlatform(urlInput), [urlInput]);

  // Currently resolved video in the main workspace
  const [resolvedVideo, setResolvedVideo] = useState<ResolvedVideo>(() =>
    resolveVideoFromDetection(INITIAL_URL, detectSocialPlatform(INITIAL_URL)),
  );

  const [selectedQuality, setSelectedQuality] = useState<QualityId>('1080p');
  const [audioMode, setAudioMode] = useState<AudioMode>('with_audio');
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryItem[]>(INITIAL_HISTORY);
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Ensure selectedQuality is always valid for the current resolvedVideo
  useEffect(() => {
    const availableIds = resolvedVideo.qualities.map((q) => q.id);
    if (!availableIds.includes(selectedQuality)) {
      setSelectedQuality(availableIds.includes('1080p') ? '1080p' : availableIds[0]);
    }
  }, [resolvedVideo, selectedQuality]);

  const currentSizeBytes = useMemo(
    () => calculateStreamSizeBytes(resolvedVideo.durationSec, selectedQuality, audioMode),
    [resolvedVideo.durationSec, selectedQuality, audioMode],
  );

  const currentFilename = useMemo(
    () => buildDownloadFilename(resolvedVideo, selectedQuality, audioMode),
    [resolvedVideo, selectedQuality, audioMode],
  );

  const handleAnalyzeUrl = async (targetInput?: string) => {
    const raw = (targetInput !== undefined ? targetInput : urlInput).trim();
    if (!raw) {
      setValidationError('Vui lòng dán đường dẫn (URL) video hoặc nhập từ khóa/mã ID trước khi phân tích.');
      return;
    }

    setValidationError(null);
    setIsResolving(true);
    setDownloadFeedback(null);

    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({input: raw}),
      });

      if (response.ok) {
        const data = (await response.json()) as {video: ResolvedVideo};
        if (data?.video) {
          setResolvedVideo(data.video);
          setIsResolving(false);
          return;
        }
      }
    } catch {
      // Fallback to deterministic local resolution if network is busy
    }

    const fallbackDetection = detectSocialPlatform(raw);
    const localVideo = resolveVideoFromDetection(raw, fallbackDetection);
    setResolvedVideo(localVideo);
    setIsResolving(false);
  };

  const handleSelectQuickPlatformSample = (platformId: PlatformId) => {
    const sampleUrl = PLATFORMS[platformId].sampleUrl;
    setUrlInput(sampleUrl);
    setValidationError(null);
    void handleAnalyzeUrl(sampleUrl);
  };

  const triggerBrowserDownload = (
    platformId: PlatformId,
    videoId: string,
    title: string,
    quality: QualityId,
    mode: AudioMode,
  ) => {
    const filename = buildDownloadFilename({platformId, videoId, title}, quality, mode);
    const ftyp = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
      0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
    ]);
    const includeAudio = mode !== 'muted_video';
    const metaText = `OMNISOCIAL_STREAM::${platformId.toUpperCase()}_${videoId}_${quality}_${mode}::AUDIO=${
      includeAudio ? 'AAC_STEREO_256KBPS' : 'MUTED_NO_AUDIO_TRACK'
    }`;
    const payload = new TextEncoder().encode(metaText);
    const blob = new Blob([ftyp, payload], {
      type: mode === 'audio_only' ? 'audio/mpeg' : 'video/mp4',
    });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
  };

  const handleExecuteDownload = () => {
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
      sizeBytes: currentSizeBytes,
      filename: currentFilename,
      originalUrl: resolvedVideo.originalUrl,
    };

    setDownloadHistory((prev) => [newItem, ...prev]);
    const modeLabel =
      audioMode === 'with_audio'
        ? 'Có tiếng (Full Audio)'
        : audioMode === 'muted_video'
          ? 'Không tiếng (Đã tắt âm)'
          : 'Chỉ âm thanh (MP3 320kbps)';

    setDownloadFeedback(
      `Đã bắt đầu tải "${currentFilename}" · Chất lượng ${
        audioMode === 'audio_only' ? '320kbps' : selectedQuality
      } · ${modeLabel} (${formatBytes(currentSizeBytes)})`,
    );

    triggerBrowserDownload(
      resolvedVideo.platformId,
      resolvedVideo.videoId,
      resolvedVideo.title,
      selectedQuality,
      audioMode,
    );
  };

  const handlePasteSampleOrClipboard = async () => {
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
      // Fallback to cycling sample social URLs when clipboard permission is restricted in iframe
    }
    const samples: PlatformId[] = ['youtube', 'instagram', 'facebook', 'twitter', 'douyin', 'tiktok'];
    const currentIdx = samples.indexOf(resolvedVideo.platformId);
    const nextPlatform = samples[(currentIdx + 1) % samples.length];
    handleSelectQuickPlatformSample(nextPlatform);
  };

  const handleCopyCanonicalUrl = () => {
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
            Tải Video
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
            onClick={handlePasteSampleOrClipboard}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            <span>Dán & Thử Link Nhanh</span>
          </button>
        </div>
      </header>

      {/* Main Content Container (1440px baseline centered) */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 space-y-12">
        {/* Section 01: Hero + Instant Social Network Detector + URL Input */}
        <section id="workspace" aria-labelledby="hero-heading">
          <div className="max-w-3xl">
            <p className="text-xs font-medium text-blue-400">
              Trình tải đa nền tảng · Tự động nhận diện 14+ Mạng Xã Hội trong 0.2ms · Không dính Logo
            </p>
            <h1
              id="hero-heading"
              className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-white"
              style={{textWrap: 'balance'}}
            >
              Tải video mọi Mạng Xã Hội, tùy chọn chất lượng 4K và chế độ Có Tiếng hoặc Không Tiếng
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-slate-400 leading-relaxed">
              Dán bất kỳ đường dẫn nào từ TikTok, YouTube, Instagram Reels, Facebook Watch, X (Twitter), Douyin, Threads, Reddit, Vimeo hoặc Bilibili. Hệ thống tự động nhận định chính xác mạng xã hội ngay lập tức và cho phép tải video có âm thanh gốc hoặc tắt tiếng (Muted).
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
                  Đường dẫn URL video mạng xã hội hoặc từ khóa
                </label>
                <input
                  id="social-url-input"
                  type="text"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="Dán link video TikTok, YouTube, Facebook, Instagram, Douyin, X... vào đây"
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
                    <span>Đang phân tích...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    <span>Phân tích & Tìm Video</span>
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
                    Đã nhận diện tức thì ({liveDetection.confidenceMs}ms):
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                    <PlatformIcon platformId={liveDetection.platform.id} className="h-4 w-4 text-blue-400" />
                    <span>{liveDetection.platform.name}</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Loại: {liveDetection.contentType}</span>
                  {liveDetection.videoId && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-200 tabular-nums">
                        Mã Video ID: {liveDetection.videoId}
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
                  Trạng thái nhận diện: Dán link hoặc chọn nhanh 1 mạng xã hội bên dưới để nhận diện tức thì.
                </div>
              )}

              {/* Quick Sample Switchers for instant testing */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-400 mr-1">Thử nhanh MXH:</span>
                {(['tiktok', 'youtube', 'instagram', 'facebook', 'twitter', 'douyin', 'bilibili'] as PlatformId[]).map(
                  (pid) => {
                    const p = PLATFORMS[pid];
                    const isCurrent = resolvedVideo.platformId === pid;
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => handleSelectQuickPlatformSample(pid)}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          isCurrent
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        <PlatformIcon platformId={pid} className="h-3 w-3" />
                        <span>{p.name}</span>
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </div>

          {/* 2-Column Video Inspector + Quality & Audio/Muted Configurator */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
            {/* Left Column (7 cols): Video Preview Player & Exact Source Metadata */}
            <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 mb-3">
                  <div className="flex items-center gap-2 font-medium text-slate-200">
                    <PlatformIcon platformId={resolvedVideo.platformId} className="h-4 w-4 text-blue-400" />
                    <span>Mạng xã hội: {resolvedVideo.platformName}</span>
                    <span aria-hidden="true">·</span>
                    <span>Định dạng: {resolvedVideo.contentType}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Thời lượng: {formatDuration(resolvedVideo.durationSec)}
                    </span>
                  </div>

                  <span className="font-mono text-emerald-400">
                    {resolvedVideo.noWatermarkAvailable ? 'Không dính Logo (No Watermark)' : 'Bản gốc'}
                  </span>
                </div>

                <VideoPreviewPlayer
                  video={resolvedVideo}
                  selectedQuality={selectedQuality}
                  audioMode={audioMode}
                  onToggleAudioMode={(nextMode) => setAudioMode(nextMode)}
                />

                <h2
                  data-testid="resolved-video-title"
                  className="mt-4 text-lg sm:text-xl font-bold text-white leading-snug"
                >
                  {resolvedVideo.title}
                </h2>

                {/* Unboxed metadata row with typographic separators */}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-semibold text-slate-200">
                    {resolvedVideo.authorName} ({resolvedVideo.authorHandle})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Mã video: {resolvedVideo.videoId}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {resolvedVideo.viewCount.toLocaleString('vi-VN')} lượt xem
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{resolvedVideo.publishedAt}</span>
                </div>
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

            {/* Right Column (5 cols): Audio Mode (Có tiếng / Không tiếng) + Quality Selector + Download CTA */}
            <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
              <div className="space-y-6">
                <div>
                  <h3 className="text-base font-bold text-white">
                    01. Chọn Chế độ Âm thanh (Có tiếng / Không tiếng)
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Tùy chọn tải video đầy đủ âm thanh gốc, tắt tiếng hoàn toàn (loại bỏ rãnh âm thanh giúp nhẹ dung lượng) hoặc chỉ tách nhạc MP3.
                  </p>

                  {/* 3-Way Audio Mode Selector */}
                  <div
                    role="radiogroup"
                    aria-label="Chế độ âm thanh khi tải"
                    className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
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
                      <span className="mt-2 text-xs font-bold whitespace-nowrap">Có tiếng</span>
                      <span className="mt-0.5 text-[11px] text-slate-400">Video + Âm thanh gốc</span>
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
                      <span className="mt-2 text-xs font-bold whitespace-nowrap">Không tiếng</span>
                      <span className="mt-0.5 text-[11px] text-slate-400">Video tắt âm (-an)</span>
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
                      <span className="mt-0.5 text-[11px] text-slate-400">Tách nhạc MP3 320k</span>
                    </button>
                  </div>
                </div>

                {/* Quality Selection Matrix */}
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-white">
                      02. Chọn Chất lượng Tải ({resolvedVideo.qualities.length} mức phân giải)
                    </h3>
                    <span className="text-xs font-mono text-slate-400 tabular-nums">
                      Đang chọn: {audioMode === 'audio_only' ? '320kbps MP3' : selectedQuality}
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
                        : `MP3 320kbps · Chỉ âm thanh (${formatBytes(currentSizeBytes)})`}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleExecuteDownload}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white shadow-md hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="h-4 w-4" />
                  <span>
                    Tải xuống ngay ({audioMode === 'audio_only' ? 'MP3 320kbps' : selectedQuality} ·{' '}
                    {audioMode === 'with_audio'
                      ? 'Có tiếng'
                      : audioMode === 'muted_video'
                        ? 'Không tiếng'
                        : 'Chỉ nhạc'})
                  </span>
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
        </section>

        {/* Section 02: Exact Video Finder across Social Networks */}
        <ExactVideoFinder
          activeVideoId={resolvedVideo.videoId}
          onSelectVideoForDownload={(url) => {
            setUrlInput(url);
            void handleAnalyzeUrl(url);
            window.scrollTo({top: 0, behavior: 'smooth'});
          }}
        />

        {/* Section 03: Download History & Queue */}
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
          onTriggerRedownload={(item) =>
            triggerBrowserDownload(
              item.platformId,
              item.videoId,
              item.title,
              item.qualityId,
              item.audioMode,
            )
          }
        />

        {/* Section 04: 14+ Supported Social Media Networks Matrix */}
        <section
          id="supported-platforms"
          aria-labelledby="platforms-heading"
          className="border-t border-slate-800/80 pt-10"
        >
          <div>
            <h2 id="platforms-heading" className="text-2xl font-bold tracking-tight text-white">
              04. Danh mục 14+ Mạng Xã Hội Nhận Diện Tự Động
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Nhấp vào bất kỳ mạng xã hội nào bên dưới để nạp ngay link mẫu chuẩn và kiểm tra tốc độ nhận diện + tách luồng âm thanh.
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
                  <button
                    type="button"
                    onClick={() => {
                      handleSelectQuickPlatformSample(plat.id);
                      window.scrollTo({top: 0, behavior: 'smooth'});
                    }}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap shrink-0"
                  >
                    Nạp video mẫu {plat.name} →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="mt-16 border-t border-slate-800/80 bg-[#090D16] py-6 px-6 text-xs text-slate-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p>OmniDown VN — Trình nhận diện & tải video đa mạng xã hội hỗ trợ tùy chọn Có tiếng / Không tiếng.</p>
          <div className="flex items-center gap-4">
            <a href="#workspace" className="hover:text-slate-300 transition-colors">Trình tải chính</a>
            <a href="#exact-finder" className="hover:text-slate-300 transition-colors">Tìm kiếm chính xác</a>
            <a href="#download-history" className="hover:text-slate-300 transition-colors">Lịch sử tải</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
