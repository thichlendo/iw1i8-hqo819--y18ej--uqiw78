import React, {useState} from 'react';
import {Search, ExternalLink, ArrowUpRight, CheckCircle2, Loader2} from 'lucide-react';
import {
  PLATFORM_LIST,
  PLATFORMS,
  CLOUD_BACKEND_ORIGIN,
  searchLiveVideos,
  buildPlatformSearchUrl,
  formatDuration,
  type PlatformId,
  type LiveSearchVideoItem,
} from '../lib/socialDetector';
import {PlatformIcon} from './PlatformIcon';

interface ExactVideoFinderProps {
  onSelectVideoForDownload: (videoUrl: string) => void;
  activeVideoId?: string;
}

export const ExactVideoFinder: React.FC<ExactVideoFinderProps> = ({
  onSelectVideoForDownload,
  activeVideoId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId | 'all'>('all');
  const [results, setResults] = useState<LiveSearchVideoItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const primaryPlatformForDeepSearch: PlatformId =
    selectedPlatform === 'all' ? 'tiktok' : selectedPlatform;

  const handleRunLiveSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setIsSearching(true);
    setHasSearched(true);
    try {
      const items = await searchLiveVideos(q, selectedPlatform);
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <section
      id="exact-finder"
      aria-labelledby="finder-heading"
      className="border-t border-slate-800/80 pt-10"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="finder-heading" className="text-2xl font-bold tracking-tight text-white">
            02. Tìm kiếm video chính xác trên từng Mạng Xã Hội (Qua Backend Render)
          </h2>
          <p className="mt-1 text-sm text-slate-400 max-w-2xl">
            Nhập từ khóa, mã ID hoặc dán link để truy vấn trực tiếp qua máy chủ Render ({CLOUD_BACKEND_ORIGIN}) hoặc mở kết quả tìm kiếm chính xác trên mạng xã hội bạn chọn.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={buildPlatformSearchUrl(
              primaryPlatformForDeepSearch,
              searchQuery || 'trending',
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
          >
            <span>
              Tìm trực tiếp trên {PLATFORMS[primaryPlatformForDeepSearch].name}
            </span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Live Search Form + Platform Filter Tabs */}
      <div className="mt-6 flex flex-col gap-4">
        <form onSubmit={handleRunLiveSearch} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <label htmlFor="exact-social-search-input" className="sr-only">
              Nhập từ khóa hoặc mã ID video cần tìm
            </label>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="exact-social-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Nhập từ khóa video, @tác_giả hoặc dán link cần phân tích qua Render..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900/90 py-3 pl-11 pr-4 text-sm text-white placeholder-slate-500 transition-colors focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {isSearching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Đang tìm qua Render...</span>
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                <span>Tìm Video Thực Tế</span>
              </>
            )}
          </button>
        </form>

        {/* Interactive Platform Filter Segmented Bar */}
        <div
          role="tablist"
          aria-label="Lọc theo mạng xã hội"
          className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/60 p-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedPlatform === 'all'}
            onClick={() => setSelectedPlatform('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              selectedPlatform === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
            }`}
          >
            Tất cả MXH
          </button>

          {PLATFORM_LIST.slice(0, 10).map((plat) => {
            const isSelected = selectedPlatform === plat.id;
            return (
              <button
                key={plat.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedPlatform(plat.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                }`}
              >
                <PlatformIcon platformId={plat.id} className="h-3.5 w-3.5" />
                <span>{plat.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results Area (Zero pre-filled fake items) */}
      {!hasSearched ? (
        <div className="mt-6 rounded-xl border border-slate-800/80 bg-slate-900/30 p-6">
          <p className="text-sm font-medium text-slate-300">
            Mở tìm kiếm trực tiếp trên từng mạng xã hội hoặc nhập từ khóa ở ô trên để truy vấn video thực tế qua máy chủ Render:
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PLATFORM_LIST.map((plat) => (
              <a
                key={plat.id}
                href={buildPlatformSearchUrl(plat.id, searchQuery || 'video')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                <PlatformIcon platformId={plat.id} className="h-3.5 w-3.5 text-blue-400" />
                <span>Tìm trên {plat.name}</span>
                <ExternalLink className="h-3 w-3 text-slate-500" />
              </a>
            ))}
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
          <p className="text-sm font-semibold text-slate-200">
            Mạng xã hội {selectedPlatform === 'all' ? '' : PLATFORMS[selectedPlatform].name} yêu cầu mở trang tìm kiếm trực tiếp cho từ khóa "{searchQuery}"
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <a
              href={buildPlatformSearchUrl(primaryPlatformForDeepSearch, searchQuery)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Mở kết quả "{searchQuery}" trên {PLATFORMS[primaryPlatformForDeepSearch].name}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {results.map((item) => {
            const plat = PLATFORMS[item.platformId];
            const isLoaded = activeVideoId === item.videoId;
            const thumbSrc =
              item.thumbnailUrl &&
              (item.thumbnailUrl.includes('fbcdn.net') ||
                item.thumbnailUrl.includes('cdninstagram.com') ||
                item.thumbnailUrl.includes('fbsbx.com'))
                ? `${CLOUD_BACKEND_ORIGIN}/api/stream-proxy?url=${encodeURIComponent(
                    item.thumbnailUrl,
                  )}`
                : item.thumbnailUrl;

            return (
              <article
                key={item.id}
                className={`flex flex-col justify-between rounded-xl border p-4 transition-colors ${
                  isLoaded
                    ? 'border-blue-500 bg-slate-900'
                    : 'border-slate-800/90 bg-slate-900/50 hover:border-slate-700'
                }`}
              >
                <div>
                  {thumbSrc && (
                    <div className="mb-3 aspect-video w-full overflow-hidden rounded-lg bg-slate-950">
                      <img
                        src={thumbSrc}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5 font-medium text-slate-300">
                      <PlatformIcon platformId={item.platformId} className="h-3.5 w-3.5" />
                      <span>{plat.name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatDuration(item.durationSec)}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      ID: {item.videoId.slice(0, 10)}
                    </span>
                  </div>

                  <h3 className="mt-2 text-sm font-semibold leading-snug text-slate-100 line-clamp-2">
                    {item.title}
                  </h3>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span className="font-medium text-slate-300">{item.authorHandle}</span>
                    {item.viewCount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {item.viewCount.toLocaleString('vi-VN')} lượt xem
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                  <button
                    type="button"
                    onClick={() => onSelectVideoForDownload(item.url)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      isLoaded
                        ? 'bg-emerald-600 text-white'
                        : 'bg-blue-600 text-white hover:bg-blue-500'
                    }`}
                  >
                    {isLoaded ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Đang nạp trong trình tải</span>
                      </>
                    ) : (
                      <>
                        <span>Nạp vào trình tải</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0"
                  >
                    <span>Link gốc</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
