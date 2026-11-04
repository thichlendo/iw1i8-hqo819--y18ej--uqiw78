import React from 'react';
import {Download, Trash2, Volume2, VolumeX, Music, CheckCircle2, RotateCcw} from 'lucide-react';
import {formatBytes, type PlatformId, type QualityId, type AudioMode} from '../lib/socialDetector';
import {PlatformIcon} from './PlatformIcon';

export interface DownloadHistoryItem {
  id: string;
  timestamp: string;
  platformId: PlatformId;
  platformName: string;
  videoId: string;
  title: string;
  authorHandle: string;
  qualityId: QualityId;
  audioMode: AudioMode;
  sizeBytes: number;
  filename: string;
  originalUrl: string;
}

interface DownloadHistoryTableProps {
  items: DownloadHistoryItem[];
  onClearHistory: () => void;
  onReloadVideo: (url: string, quality: QualityId, audioMode: AudioMode) => void;
  onTriggerRedownload: (item: DownloadHistoryItem) => void;
}

export const DownloadHistoryTable: React.FC<DownloadHistoryTableProps> = ({
  items,
  onClearHistory,
  onReloadVideo,
  onTriggerRedownload,
}) => {
  const renderAudioLabel = (mode: AudioMode) => {
    if (mode === 'with_audio') {
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
          <Volume2 className="h-3.5 w-3.5" />
          <span>Có tiếng (Full Audio)</span>
        </span>
      );
    }
    if (mode === 'muted_video') {
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
          <VolumeX className="h-3.5 w-3.5" />
          <span>Không tiếng (Muted)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-blue-400 font-medium">
        <Music className="h-3.5 w-3.5" />
        <span>Chỉ âm thanh (MP3)</span>
      </span>
    );
  };

  return (
    <section
      id="download-history"
      aria-labelledby="history-heading"
      className="border-t border-slate-800/80 pt-10"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="history-heading" className="text-2xl font-bold tracking-tight text-white">
            03. Lịch sử & Hàng đợi Tải xuống ({items.length})
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Theo dõi các tệp video đã trích xuất kèm thông số độ phân giải, trạng thái âm thanh (Có tiếng / Không tiếng) và dung lượng thực tế.
          </p>
        </div>

        {items.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-red-500/50 hover:text-red-300 transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Xóa lịch sử tải</span>
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
          <p className="text-sm font-medium text-slate-300">
            Chưa có video nào trong danh sách đã tải xuống phiên này.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Chọn chất lượng video và chế độ âm thanh (Có tiếng hoặc Không tiếng) ở bảng điều khiển phía trên rồi nhấn "Tải xuống ngay".
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/90 text-xs font-semibold text-slate-400">
                <th className="py-3 pl-4 pr-3">Mạng xã hội</th>
                <th className="px-3 py-3">Video & Tác giả</th>
                <th className="px-3 py-3">Chất lượng</th>
                <th className="px-3 py-3">Chế độ âm thanh</th>
                <th className="px-3 py-3 text-right">Dung lượng</th>
                <th className="px-3 py-3">Trạng thái</th>
                <th className="py-3 pl-3 pr-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 pl-4 pr-3 whitespace-nowrap">
                    <div className="flex items-center gap-2 font-medium text-slate-200">
                      <PlatformIcon platformId={item.platformId} className="h-4 w-4 text-blue-400" />
                      <span>{item.platformName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 max-w-xs">
                    <div className="font-medium text-slate-100 truncate">{item.title}</div>
                    <div className="mt-0.5 text-slate-400 font-mono text-[11px] truncate">
                      {item.authorHandle} · {item.filename}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono font-semibold text-slate-200 whitespace-nowrap tabular-nums">
                    {item.audioMode === 'audio_only' ? '320kbps MP3' : `${item.qualityId} MP4`}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {renderAudioLabel(item.audioMode)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                    {formatBytes(item.sizeBytes)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Đã hoàn tất ({item.timestamp})</span>
                    </span>
                  </td>
                  <td className="py-3 pl-3 pr-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onReloadVideo(item.originalUrl, item.qualityId, item.audioMode)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Cấu hình lại</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onTriggerRedownload(item)}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap shrink-0"
                      >
                        <Download className="h-3 w-3" />
                        <span>Lưu tệp</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
