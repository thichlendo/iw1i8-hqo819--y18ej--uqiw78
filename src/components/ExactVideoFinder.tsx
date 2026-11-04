import React, {useState, useMemo} from 'react';
import {Search, ExternalLink, ArrowUpRight, CheckCircle2, Film} from 'lucide-react';
import {
  PLATFORM_LIST,
  PLATFORMS,
  searchExactVideos,
  buildPlatformSearchUrl,
  formatDuration,
  type PlatformId,
  type CatalogVideoItem,
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

  const results = useMemo(
    () => searchExactVideos(searchQuery, selectedPlatform),
    [searchQuery, selectedPlatform],
  );

  const primaryPlatformForDeepSearch: PlatformId =
    selectedPlatform === 'all' ? 'tiktok' : selectedPlatform;

  return (
    <section
      id="exact-finder"
      aria-labelledby="finder-heading"
      className="border-t border-slate-800/80 pt-10"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="finder-heading" className="text-2xl font-bold tracking-tight text-white">
            02. Tìm kiếm video chính xác trên từng Mạng Xã Hội
          </h2>
          <p className="mt-1 text-sm text-slate-400 max-w-2xl">
            Tìm nhanh video theo từ khóa, mã ID, hashtag hoặc tài khoản <span className="font-mono text-slate-300">@creator</span> trên đúng mạng xã hội bạn cần và nạp thẳng vào bộ tải chỉ với 1 chạm.
          </p>
        </div>

        {/* Direct Deep-Search link on the target social network */}
        <div className="flex items-center gap-3">
          <a
            href={buildPlatformSearchUrl(
              primaryPlatformForDeepSearch,
              searchQuery || 'trending video',
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
          >
            <span>
              Mở tìm kiếm gốc trên {PLATFORMS[primaryPlatformForDeepSearch].name}
            </span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Search bar + Platform Filter Tabs */}
      <div className="mt-6 flex flex-col gap-4">
        <div className="relative">
          <label htmlFor="exact-social-search-input" className="sr-only">
            Tìm video theo tên, mã ID, tác giả hoặc hashtag
          </label>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="exact-social-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Nhập tên video, mã ID (VD: 7398451209384719632, BV1GJ411x7h7), @tác_giả hoặc từ khóa..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/90 py-3 pl-11 pr-28 text-sm text-white placeholder-slate-500 transition-colors focus:border-blue-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 whitespace-nowrap shrink-0"
            >
              Xóa lọc
            </button>
          )}
        </div>

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
            Tất cả MXH ({searchExactVideos(searchQuery, 'all').length})
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

      {/* Results Grid */}
      {results.length === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
          <Film className="mx-auto h-8 w-8 text-slate-500" />
          <p className="mt-3 text-base font-semibold text-slate-200">
            Không tìm thấy video khớp trong bộ nhớ đệm nhanh
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Bạn có thể dán trực tiếp link hoặc bấm nút bên dưới để nạp từ khóa này vào trình phân tích trực tiếp.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onSelectVideoForDownload(searchQuery || PLATFORMS[primaryPlatformForDeepSearch].sampleUrl)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
            >
              Phân tích & Tải theo từ khóa "{searchQuery}"
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedPlatform('all');
              }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Hiển thị lại tất cả video
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {results.map((item: CatalogVideoItem) => {
            const plat = PLATFORMS[item.platformId];
            const isLoaded = activeVideoId === item.videoId;

            return (
              <article
                key={item.id}
                className={`flex flex-col justify-between rounded-xl border p-5 transition-colors ${
                  isLoaded
                    ? 'border-blue-500 bg-slate-900'
                    : 'border-slate-800/90 bg-slate-900/50 hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Quiet 1-line unboxed metadata kicker with typographic separators */}
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5 font-medium text-slate-300">
                      <PlatformIcon platformId={item.platformId} className="h-3.5 w-3.5" />
                      <span>{plat.name}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.contentType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatDuration(item.durationSec)}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      ID: {item.videoId.slice(0, 10)}
                    </span>
                  </div>

                  {/* Primary Title */}
                  <h3 className="mt-2.5 text-base font-semibold leading-snug text-slate-100 line-clamp-2">
                    {item.title}
                  </h3>

                  {/* Creator & Stats unboxed line */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span className="font-medium text-slate-300">{item.authorHandle}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {(item.viewCount / 1000).toFixed(0)}K lượt xem
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{item.publishedAt}</span>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3.5">
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
                        <span>Đang chọn trong trình tải</span>
                      </>
                    ) : (
                      <>
                        <span>Chọn tải video này</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Mở link gốc ${item.title} trên ${plat.name}`}
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
