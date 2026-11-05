export type PlatformId =
  | 'tiktok'
  | 'youtube'
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'douyin'
  | 'threads'
  | 'reddit'
  | 'vimeo'
  | 'bilibili'
  | 'pinterest'
  | 'soundcloud'
  | 'twitch'
  | 'dailymotion';

export type QualityId = '2160p' | '1440p' | '1080p' | '720p' | '480p' | '360p';

export type AudioMode = 'with_audio' | 'muted_video' | 'audio_only' | 'image_only';

export interface PlatformInfo {
  id: PlatformId;
  name: string;
  shortName: string;
  domain: string;
  accentHex: string;
  supportsNoWatermark: boolean;
  maxResolution: QualityId;
  searchUrlTemplate: string;
  supportedFormats: string[];
}

export interface DetectionResult {
  detected: boolean;
  isUrl: boolean;
  platform: PlatformInfo | null;
  videoId: string | null;
  contentType:
    | 'Video'
    | 'Shorts'
    | 'Reel'
    | 'Story'
    | 'Photo'
    | 'Clip'
    | 'Track'
    | 'Pin'
    | 'Post'
    | 'Search';
  normalizedUrl: string;
  creatorHint: string | null;
  confidenceMs: number;
  directPlatformUrl: string | null;
  platformSearchUrl: string | null;
  isMetaPlatform?: boolean;
}

export interface QualityOption {
  id: QualityId;
  label: string;
  resolution: string;
  fps: number;
  codec: string;
  videoBitrateKbps: number;
  badge: string;
  noWatermark: boolean;
  directStreamUrl?: string;
  realSizeBytes?: number;
}

export interface ExtractedImageItem {
  id: string;
  url: string;
  label: string;
  width?: number;
  height?: number;
  format: 'JPG' | 'PNG' | 'WEBP';
}

export interface ResolvedVideo {
  id: string;
  videoId: string;
  platformId: PlatformId;
  platformName: string;
  contentType: string;
  title: string;
  authorName: string;
  authorHandle: string;
  authorUrl: string;
  durationSec: number;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  originalUrl: string;
  directPlatformUrl: string;
  noWatermarkAvailable: boolean;
  audioTrackTitle: string;
  audioCodec: string;
  videoCodec: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  previewAccent: string;
  thumbnailUrl?: string;
  videoStreamUrl?: string;
  hdStreamUrl?: string;
  wmStreamUrl?: string;
  audioStreamUrl?: string;
  images: ExtractedImageItem[];
  qualities: QualityOption[];
  resolveTimeMs?: number;
  resolvedVia:
    | 'meta-fast-engine'
    | 'real-stream-api'
    | 'yt-dlp-live'
    | 'oembed-live'
    | 'url-inspector'
    | 'tikwm-live'
    | 'fxtwitter-live'
    | 'dailymotion-live'
    | 'direct-metadata';
}

export interface LiveSearchVideoItem {
  id: string;
  videoId: string;
  platformId: PlatformId;
  contentType: 'Video' | 'Shorts' | 'Reel' | 'Photo' | 'Clip' | 'Track' | 'Pin' | 'Post';
  title: string;
  authorName: string;
  authorHandle: string;
  durationSec: number;
  publishedAt: string;
  viewCount: number;
  url: string;
  thumbnailUrl?: string;
  videoStreamUrl?: string;
}

/**
 * Render Backend Origin — All analysis, video streaming, FFmpeg processing, and photo extraction
 * requests are routed through this Node.js backend (`server.ts`).
 */
export const CLOUD_BACKEND_ORIGIN = 'https://iw1i8-hqo819--y18ej--uqiw78.onrender.com';

export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    shortName: 'TT',
    domain: 'tiktok.com',
    accentHex: '#00F2FE',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.tiktok.com/search/video?q={query}',
    supportedFormats: [
      'MP4 Không Logo',
      'MP4 Có Tiếng',
      'MP4 Tắt Tiếng (-an)',
      'Ảnh Slideshow Gốc',
      'MP3 Nhạc Nền',
    ],
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    shortName: 'YT',
    domain: 'youtube.com',
    accentHex: '#EF4444',
    supportsNoWatermark: true,
    maxResolution: '2160p',
    searchUrlTemplate: 'https://www.youtube.com/results?search_query={query}',
    supportedFormats: [
      '4K 2160p60',
      '1440p60',
      '1080p60',
      'MP4 Tắt Tiếng (-an)',
      'Ảnh Bìa MaxRes JPG',
      'MP3 320kbps',
    ],
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram (Meta)',
    shortName: 'IG',
    domain: 'instagram.com',
    accentHex: '#EC4899',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.instagram.com/explore/search/keyword/?q={query}',
    supportedFormats: [
      'Reels 1080p',
      'Ảnh Carousel / Post JPG',
      'Story MP4/JPG',
      'MP4 Không Tiếng (-an)',
      'AAC/MP3 Audio',
    ],
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook (Meta)',
    shortName: 'FB',
    domain: 'facebook.com',
    accentHex: '#3B82F6',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.facebook.com/watch/search/?q={query}',
    supportedFormats: [
      'FB Watch 1080p',
      'FB Reels HD',
      'Ảnh FB / Album Gốc JPG',
      'MP4 Tắt Tiếng (-an)',
      'MP3 Audio',
    ],
  },
  threads: {
    id: 'threads',
    name: 'Threads (Meta)',
    shortName: 'TH',
    domain: 'threads.net',
    accentHex: '#CBD5E1',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.threads.net/search?q={query}',
    supportedFormats: [
      'Threads MP4 1080p',
      'Ảnh Threads Gốc JPG',
      'MP4 Tắt Tiếng (-an)',
      'MP3 Audio',
    ],
  },
  twitter: {
    id: 'twitter',
    name: 'X (Twitter)',
    shortName: 'X',
    domain: 'x.com',
    accentHex: '#94A3B8',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://x.com/search?q={query}&f=video',
    supportedFormats: ['MP4 1080p', 'Ảnh Tweet 4K JPG', 'MP4 Không Tiếng (-an)', 'MP3 Audio'],
  },
  douyin: {
    id: 'douyin',
    name: 'Douyin (抖音)',
    shortName: 'DY',
    domain: 'douyin.com',
    accentHex: '#22D3EE',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.douyin.com/search/{query}?type=video',
    supportedFormats: ['Douyin Gốc Không Logo', 'Ảnh Album Douyin', 'MP4 Không Tiếng (-an)', 'MP3'],
  },
  reddit: {
    id: 'reddit',
    name: 'Reddit',
    shortName: 'RD',
    domain: 'reddit.com',
    accentHex: '#F97316',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.reddit.com/search/?q={query}&type=media',
    supportedFormats: [
      'DASH Muxed Audio+Video',
      'Ảnh Reddit Gallery JPG',
      'Video Không Tiếng (-an)',
      'Audio MP3',
    ],
  },
  vimeo: {
    id: 'vimeo',
    name: 'Vimeo',
    shortName: 'VM',
    domain: 'vimeo.com',
    accentHex: '#0EA5E9',
    supportsNoWatermark: true,
    maxResolution: '2160p',
    searchUrlTemplate: 'https://vimeo.com/search?q={query}',
    supportedFormats: ['4K MP4', '1080p Master', 'Ảnh Thumbnail HD', 'MP4 Tắt Tiếng (-an)'],
  },
  bilibili: {
    id: 'bilibili',
    name: 'Bilibili',
    shortName: 'BL',
    domain: 'bilibili.com',
    accentHex: '#60A5FA',
    supportsNoWatermark: true,
    maxResolution: '2160p',
    searchUrlTemplate: 'https://search.bilibili.com/all?keyword={query}',
    supportedFormats: ['4K UHD', '1080p60 High Bitrate', 'Ảnh Bìa Gốc JPG', 'MP4 Tắt Tiếng (-an)'],
  },
  pinterest: {
    id: 'pinterest',
    name: 'Pinterest',
    shortName: 'PN',
    domain: 'pinterest.com',
    accentHex: '#F43F5E',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.pinterest.com/search/pins/?q={query}',
    supportedFormats: ['Video Pin 1080p', 'Ảnh Pin Gốc Độ Phân Giải Cao', 'Pin Không Tiếng (-an)'],
  },
  soundcloud: {
    id: 'soundcloud',
    name: 'SoundCloud',
    shortName: 'SC',
    domain: 'soundcloud.com',
    accentHex: '#FB923C',
    supportsNoWatermark: true,
    maxResolution: '720p',
    searchUrlTemplate: 'https://soundcloud.com/search?q={query}',
    supportedFormats: ['MP3 320kbps', 'Ảnh Artwork Gốc JPG', 'M4A Original'],
  },
  twitch: {
    id: 'twitch',
    name: 'Twitch Clips',
    shortName: 'TW',
    domain: 'twitch.tv',
    accentHex: '#A855F7',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.twitch.tv/search?term={query}',
    supportedFormats: ['1080p60 Source Clip', '720p60', 'Clip Tắt Tiếng (-an)', 'MP3'],
  },
  dailymotion: {
    id: 'dailymotion',
    name: 'Dailymotion',
    shortName: 'DM',
    domain: 'dailymotion.com',
    accentHex: '#38BDF8',
    supportsNoWatermark: true,
    maxResolution: '1080p',
    searchUrlTemplate: 'https://www.dailymotion.com/search/{query}/videos',
    supportedFormats: ['1080p Full HD', '720p HD', 'Ảnh Bìa HD JPG', 'MP4 Không Tiếng (-an)'],
  },
};

export const PLATFORM_LIST: PlatformInfo[] = Object.values(PLATFORMS);

export const STANDARD_QUALITIES: QualityOption[] = [
  {
    id: '2160p',
    label: '4K Ultra HD',
    resolution: '3840×2160',
    fps: 60,
    codec: 'H.264 / HEVC',
    videoBitrateKbps: 14500,
    badge: '4K 60fps',
    noWatermark: true,
  },
  {
    id: '1440p',
    label: '2K QHD',
    resolution: '2560×1440',
    fps: 60,
    codec: 'H.264 High',
    videoBitrateKbps: 8200,
    badge: '2K 60fps',
    noWatermark: true,
  },
  {
    id: '1080p',
    label: 'Full HD 1080p',
    resolution: '1920×1080',
    fps: 60,
    codec: 'AVC1 (H.264)',
    videoBitrateKbps: 4200,
    badge: 'Gốc · Không Logo',
    noWatermark: true,
  },
  {
    id: '720p',
    label: 'HD 720p',
    resolution: '1280×720',
    fps: 30,
    codec: 'AVC1 (H.264)',
    videoBitrateKbps: 2100,
    badge: 'Chuẩn HD',
    noWatermark: true,
  },
  {
    id: '480p',
    label: 'SD 480p',
    resolution: '854×480',
    fps: 30,
    codec: 'AVC1 (H.264)',
    videoBitrateKbps: 1050,
    badge: 'Nhẹ · Nhanh',
    noWatermark: true,
  },
  {
    id: '360p',
    label: 'Tiết kiệm 360p',
    resolution: '640×360',
    fps: 30,
    codec: 'AVC1 (H.264)',
    videoBitrateKbps: 620,
    badge: 'Siêu nhẹ',
    noWatermark: true,
  },
];

export function buildPlatformSearchUrl(platformId: PlatformId, query: string): string {
  const platform = PLATFORMS[platformId];
  const cleanQuery = encodeURIComponent(query.trim() || 'video');
  return platform.searchUrlTemplate.replace('{query}', cleanQuery);
}

function cleanTrackingParams(u: URL): URL {
  const copy = new URL(u.toString());
  const junkParams = [
    'fbclid',
    'igshid',
    'igsh',
    'mibextid',
    'rdid',
    'share_url',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    '_r',
    '_t',
    'is_from_webapp',
    'sender_device',
  ];
  for (const key of junkParams) {
    copy.searchParams.delete(key);
  }
  return copy;
}

/**
 * Pure, deterministic <0.2ms URL & platform inspector (no network calls).
 */
export function detectSocialPlatform(rawInput: string): DetectionResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      detected: false,
      isUrl: false,
      platform: null,
      videoId: null,
      contentType: 'Search',
      normalizedUrl: '',
      creatorHint: null,
      confidenceMs: 0.05,
      directPlatformUrl: null,
      platformSearchUrl: null,
    };
  }

  const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  const candidate = urlMatch ? urlMatch[0] : trimmed;

  const domainCandidate =
    /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(candidate) && !candidate.includes(' ')
      ? `https://${candidate}`
      : candidate;

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(domainCandidate);
  } catch {
    parsedUrl = null;
  }

  // Unwrap Facebook / Instagram link shim (l.facebook.com/l.php?u=... or l.instagram.com/?u=...)
  if (parsedUrl) {
    const rawHost = parsedUrl.hostname.toLowerCase();
    if (
      (rawHost === 'l.facebook.com' ||
        rawHost === 'lm.facebook.com' ||
        rawHost === 'l.instagram.com') &&
      parsedUrl.searchParams.get('u')
    ) {
      try {
        parsedUrl = new URL(parsedUrl.searchParams.get('u')!);
      } catch {
        // Keep original if inner u param is malformed
      }
    }
  }

  if (parsedUrl) {
    const cleanedUrl = cleanTrackingParams(parsedUrl);
    const host = cleanedUrl.hostname
      .toLowerCase()
      .replace(/^(www|m|web|mbasic|touch|business)\./, '');
    const path = cleanedUrl.pathname;

    // 1. Facebook (Meta)
    if (
      host === 'facebook.com' ||
      host.endsWith('.facebook.com') ||
      host === 'fb.watch' ||
      host === 'fb.com' ||
      host === 'fb.gg'
    ) {
      const reelMatch =
        path.match(/\/reel\/(\d+)/i) ||
        path.match(/\/reels\/(\d+)/i) ||
        path.match(/\/share\/r\/([A-Za-z0-9_-]+)/i);
      const videoMatch =
        path.match(/\/([^/]+)\/videos\/(?:[^/]+\/)?(\d+)/i) ||
        path.match(/\/videos\/(\d+)/i) ||
        path.match(/\/share\/v\/([A-Za-z0-9_-]+)/i) ||
        path.match(/\/watch\/live\/?/i);
      const photoMatch =
        path.match(/\/photo(?:\.php|\/)?/i) ||
        path.match(/\/([^/]+)\/photos\/(?:[^/]+\/)?(\d+)/i) ||
        path.match(/\/share\/p\/([A-Za-z0-9_-]+)/i);
      const postMatch =
        path.match(/\/([^/]+)\/posts\/([A-Za-z0-9_-]+)/i) ||
        path.match(/\/story\.php/i) ||
        path.match(/\/permalink\.php/i) ||
        path.match(/\/share\/([A-Za-z0-9_-]+)/i);
      const storyMatch = path.match(/\/stories\/([^/]+)\/(\d+)/i);

      const queryV = cleanedUrl.searchParams.get('v');
      const queryFbid =
        cleanedUrl.searchParams.get('fbid') || cleanedUrl.searchParams.get('story_fbid');
      const shortMatch =
        host === 'fb.watch' || host === 'fb.com' ? path.match(/^\/([A-Za-z0-9_-]+)/) : null;

      let contentType: DetectionResult['contentType'] = 'Video';
      if (reelMatch) {
        contentType = 'Reel';
      } else if (storyMatch) {
        contentType = 'Story';
      } else if (photoMatch || (queryFbid && !queryV && !videoMatch)) {
        contentType = 'Photo';
      } else if (postMatch && !queryV && !videoMatch) {
        contentType = 'Post';
      }

      let creatorHint: string | null = null;
      const userVideoMatch = path.match(/^\/([^/]+)\/(?:videos|posts|photos)\//i);
      if (
        userVideoMatch &&
        !['watch', 'reel', 'reels', 'share', 'photo', 'groups', 'events', 'gaming'].includes(
          userVideoMatch[1].toLowerCase(),
        )
      ) {
        creatorHint = `@${userVideoMatch[1]}`;
      }

      const videoId =
        (reelMatch && reelMatch[1]) ||
        queryV ||
        queryFbid ||
        (videoMatch && (videoMatch[2] || videoMatch[1])) ||
        (photoMatch && (photoMatch[2] || photoMatch[1])) ||
        (postMatch && (postMatch[2] || postMatch[1])) ||
        (storyMatch && storyMatch[2]) ||
        (shortMatch && shortMatch[1]) ||
        'fb-media';

      const canonical = cleanedUrl.toString();
      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.facebook,
        videoId,
        contentType,
        normalizedUrl: canonical,
        creatorHint,
        confidenceMs: 0.08,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('facebook', videoId),
        isMetaPlatform: true,
      };
    }

    // 2. Instagram (Meta)
    if (
      host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host === 'instagr.am' ||
      host === 'ig.me'
    ) {
      const userScopedMatch = path.match(/^\/([^/]+)\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
      const directMatch = path.match(/^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
      const shareMatch = path.match(/^\/share\/(?:(reel|reels|p)\/)?([A-Za-z0-9_-]+)/i);
      const storyMatch = path.match(/^\/stories\/([^/]+)\/(\d+)/i);

      let contentType: DetectionResult['contentType'] = 'Reel';
      let videoId = 'ig-media';
      let creatorHint: string | null = null;

      if (userScopedMatch) {
        creatorHint = `@${userScopedMatch[1]}`;
        const kind = userScopedMatch[2].toLowerCase();
        contentType =
          kind === 'p'
            ? cleanedUrl.searchParams.has('img_index')
              ? 'Photo'
              : 'Post'
            : 'Reel';
        videoId = userScopedMatch[3];
      } else if (directMatch) {
        const kind = directMatch[1].toLowerCase();
        contentType =
          kind === 'p'
            ? cleanedUrl.searchParams.has('img_index')
              ? 'Photo'
              : 'Post'
            : 'Reel';
        videoId = directMatch[2];
      } else if (shareMatch) {
        const kind = (shareMatch[1] || 'reel').toLowerCase();
        contentType = kind === 'p' ? 'Post' : 'Reel';
        videoId = shareMatch[2];
      } else if (storyMatch) {
        contentType = 'Story';
        creatorHint = `@${storyMatch[1]}`;
        videoId = storyMatch[2];
      }

      const canonical =
        (userScopedMatch || directMatch) && videoId !== 'ig-media'
          ? `https://www.instagram.com/${contentType === 'Reel' ? 'reel' : 'p'}/${videoId}/`
          : cleanedUrl.toString();

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.instagram,
        videoId,
        contentType,
        normalizedUrl: canonical,
        creatorHint,
        confidenceMs: 0.08,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('instagram', videoId),
        isMetaPlatform: true,
      };
    }

    // 3. Threads (Meta)
    if (
      host === 'threads.net' ||
      host.endsWith('.threads.net') ||
      host === 'threads.com' ||
      host.endsWith('.threads.com')
    ) {
      const postMatch =
        path.match(/\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/i) ||
        path.match(/\/([^/]+)\/post\/([A-Za-z0-9_-]+)/i) ||
        path.match(/\/t\/([A-Za-z0-9_-]+)/i);
      const creatorHint =
        postMatch && postMatch[2] ? `@${postMatch[1].replace(/^@/, '')}` : null;
      const videoId = postMatch ? postMatch[2] || postMatch[1] : 'threads-post';
      const canonical = cleanedUrl.toString();

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.threads,
        videoId,
        contentType: 'Post',
        normalizedUrl: canonical,
        creatorHint,
        confidenceMs: 0.08,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('threads', videoId),
        isMetaPlatform: true,
      };
    }

    // 4. TikTok
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      const mediaMatch =
        path.match(/\/@([^/]+)\/(video|photo)\/(\d+)/i) ||
        path.match(/\/(v|video|photo)\/(\d+)/i);
      const shortMatch = path.match(/^\/(?:t\/)?([A-Za-z0-9_-]{6,16})\/?$/);
      const creatorMatch = path.match(/\/@([^/]+)/);
      const isPhotoMode =
        (mediaMatch &&
          (mediaMatch[2]?.toLowerCase() === 'photo' ||
            mediaMatch[1]?.toLowerCase() === 'photo')) ||
        path.includes('/photo/');
      const videoId = mediaMatch
        ? mediaMatch[3] || mediaMatch[2]
        : shortMatch
          ? shortMatch[1]
          : cleanedUrl.searchParams.get('item_id') || 'tiktok-media';
      const creatorHint = creatorMatch ? `@${creatorMatch[1]}` : null;
      const canonical =
        mediaMatch && creatorMatch
          ? `https://www.tiktok.com/@${creatorMatch[1]}/${isPhotoMode ? 'photo' : 'video'}/${videoId}`
          : cleanedUrl.toString();

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.tiktok,
        videoId,
        contentType: isPhotoMode ? 'Photo' : 'Video',
        normalizedUrl: canonical,
        creatorHint,
        confidenceMs: 0.1,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('tiktok', videoId),
      };
    }

    // 5. YouTube & Shorts & youtu.be
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
      let videoId: string | null = null;
      let contentType: DetectionResult['contentType'] = 'Video';

      if (host === 'youtu.be') {
        const m = path.match(/^\/([A-Za-z0-9_-]{6,15})/);
        videoId = m ? m[1] : null;
      } else if (path.startsWith('/shorts/')) {
        const m = path.match(/^\/shorts\/([A-Za-z0-9_-]{6,15})/);
        videoId = m ? m[1] : null;
        contentType = 'Shorts';
      } else if (path.startsWith('/live/')) {
        const m = path.match(/^\/live\/([A-Za-z0-9_-]{6,15})/);
        videoId = m ? m[1] : null;
        contentType = 'Clip';
      } else {
        videoId = cleanedUrl.searchParams.get('v');
      }

      const finalId = videoId || 'youtube-video';
      const canonical =
        contentType === 'Shorts'
          ? `https://www.youtube.com/shorts/${finalId}`
          : `https://www.youtube.com/watch?v=${finalId}`;

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.youtube,
        videoId: finalId,
        contentType,
        normalizedUrl: canonical,
        creatorHint: null,
        confidenceMs: 0.1,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('youtube', finalId),
      };
    }

    // 6. X / Twitter
    if (
      host === 'x.com' ||
      host === 'twitter.com' ||
      host.endsWith('.twitter.com') ||
      host === 't.co' ||
      host === 'fxtwitter.com' ||
      host === 'vxtwitter.com'
    ) {
      const statusMatch = path.match(/\/([^/]+)\/status\/(\d+)/i);
      const isPhotoUrl = /\/photo\/\d+/i.test(path);
      const creatorHint = statusMatch ? `@${statusMatch[1]}` : null;
      const videoId = statusMatch ? statusMatch[2] : path.replace(/\//g, '') || 'x-media';
      const canonical = statusMatch
        ? `https://x.com/${statusMatch[1]}/status/${videoId}`
        : cleanedUrl.toString();

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.twitter,
        videoId,
        contentType: isPhotoUrl ? 'Photo' : 'Video',
        normalizedUrl: canonical,
        creatorHint,
        confidenceMs: 0.12,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('twitter', videoId),
      };
    }

    // 7. Douyin
    if (host === 'douyin.com' || host.endsWith('.douyin.com') || host === 'iesdouyin.com') {
      const videoMatch =
        path.match(/\/(video|note)\/(\d+)/i) || path.match(/^\/([A-Za-z0-9_-]+)\/?$/);
      const modalId = cleanedUrl.searchParams.get('modal_id');
      const isNote = path.includes('/note/');
      const videoId =
        modalId || (videoMatch ? videoMatch[2] || videoMatch[1] : 'douyin-media');
      const canonical = cleanedUrl.toString();

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.douyin,
        videoId,
        contentType: isNote ? 'Photo' : 'Video',
        normalizedUrl: canonical,
        creatorHint: null,
        confidenceMs: 0.12,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('douyin', videoId),
      };
    }

    // 8. Reddit
    if (
      host === 'reddit.com' ||
      host.endsWith('.reddit.com') ||
      host === 'redd.it' ||
      host === 'v.redd.it' ||
      host === 'i.redd.it'
    ) {
      const commentMatch = path.match(/\/r\/([^/]+)\/comments\/([A-Za-z0-9]+)/i);
      const galleryMatch = path.match(/\/gallery\/([A-Za-z0-9]+)/i);
      const shortMatch = path.match(/^\/([A-Za-z0-9._-]+)\/?$/);
      const creatorHint = commentMatch ? `r/${commentMatch[1]}` : null;
      const isPhoto = host === 'i.redd.it' || Boolean(galleryMatch);
      const videoId = commentMatch
        ? commentMatch[2]
        : galleryMatch
          ? galleryMatch[1]
          : shortMatch
            ? shortMatch[1]
            : 'reddit-media';

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.reddit,
        videoId,
        contentType: isPhoto ? 'Photo' : 'Video',
        normalizedUrl: cleanedUrl.toString(),
        creatorHint,
        confidenceMs: 0.14,
        directPlatformUrl: cleanedUrl.toString(),
        platformSearchUrl: buildPlatformSearchUrl('reddit', videoId),
      };
    }

    // 9. Vimeo
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
      const vimeoMatch = path.match(/\/(?:video\/)?(\d+)/);
      const videoId = vimeoMatch ? vimeoMatch[1] : 'vimeo-video';
      const canonical = `https://vimeo.com/${videoId}`;

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.vimeo,
        videoId,
        contentType: 'Video',
        normalizedUrl: canonical,
        creatorHint: null,
        confidenceMs: 0.12,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('vimeo', videoId),
      };
    }

    // 10. Bilibili
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv') {
      const bvMatch = path.match(/\/(BV[A-Za-z0-9]+|av\d+)/i) || path.match(/^\/([A-Za-z0-9]+)/);
      const videoId = bvMatch ? bvMatch[1] : 'bilibili-video';
      const canonical = cleanedUrl.toString();

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.bilibili,
        videoId,
        contentType: 'Video',
        normalizedUrl: canonical,
        creatorHint: null,
        confidenceMs: 0.12,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('bilibili', videoId),
      };
    }

    // 11. Pinterest
    if (host.includes('pinterest.') || host === 'pin.it' || host === 'pinimg.com') {
      const pinMatch =
        path.match(/\/pin\/(?:[^/]*--)?(\d+)/i) || path.match(/^\/([A-Za-z0-9]+)\/?$/);
      const videoId = pinMatch ? pinMatch[1] : 'pinterest-pin';
      const canonical = cleanedUrl.toString();

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.pinterest,
        videoId,
        contentType: 'Pin',
        normalizedUrl: canonical,
        creatorHint: null,
        confidenceMs: 0.12,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('pinterest', videoId),
      };
    }

    // 12. SoundCloud
    if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) {
      const scMatch = path.match(/^\/([^/]+)\/([^/]+)/);
      const creatorHint = scMatch ? `@${scMatch[1]}` : null;
      const videoId = scMatch ? `${scMatch[1]}-${scMatch[2]}` : 'sc-track';

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.soundcloud,
        videoId,
        contentType: 'Track',
        normalizedUrl: cleanedUrl.toString(),
        creatorHint,
        confidenceMs: 0.12,
        directPlatformUrl: cleanedUrl.toString(),
        platformSearchUrl: buildPlatformSearchUrl('soundcloud', videoId),
      };
    }

    // 13. Twitch
    if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) {
      const clipMatch =
        path.match(/\/clip\/([A-Za-z0-9_-]+)/) || path.match(/^\/([A-Za-z0-9_-]+)/);
      const videoId = clipMatch ? clipMatch[1] : 'twitch-clip';

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.twitch,
        videoId,
        contentType: 'Clip',
        normalizedUrl: cleanedUrl.toString(),
        creatorHint: null,
        confidenceMs: 0.12,
        directPlatformUrl: cleanedUrl.toString(),
        platformSearchUrl: buildPlatformSearchUrl('twitch', videoId),
      };
    }

    // 14. Dailymotion
    if (host === 'dailymotion.com' || host.endsWith('.dailymotion.com') || host === 'dai.ly') {
      const dmMatch = path.match(/\/video\/([A-Za-z0-9]+)/) || path.match(/^\/([A-Za-z0-9]+)/);
      const videoId = dmMatch ? dmMatch[1] : 'dm-video';
      const canonical = `https://www.dailymotion.com/video/${videoId}`;

      return {
        detected: true,
        isUrl: true,
        platform: PLATFORMS.dailymotion,
        videoId,
        contentType: 'Video',
        normalizedUrl: canonical,
        creatorHint: null,
        confidenceMs: 0.12,
        directPlatformUrl: canonical,
        platformSearchUrl: buildPlatformSearchUrl('dailymotion', videoId),
      };
    }
  }

  // Shorthand / Keyword detection
  const lower = trimmed.toLowerCase();
  const keywordMap: Array<{keys: string[]; id: PlatformId}> = [
    {keys: ['facebook', 'fb ', 'fb watch', 'fb reel'], id: 'facebook'},
    {keys: ['instagram', 'ig ', 'insta', 'reel'], id: 'instagram'},
    {keys: ['threads'], id: 'threads'},
    {keys: ['tiktok', 'tik tok', 'tt '], id: 'tiktok'},
    {keys: ['youtube', 'yt ', 'youtu.be', 'shorts'], id: 'youtube'},
    {keys: ['twitter', 'x.com'], id: 'twitter'},
    {keys: ['douyin', '抖音'], id: 'douyin'},
    {keys: ['reddit', 'r/'], id: 'reddit'},
    {keys: ['vimeo'], id: 'vimeo'},
    {keys: ['bilibili', 'bv1'], id: 'bilibili'},
    {keys: ['pinterest', 'pin'], id: 'pinterest'},
    {keys: ['soundcloud'], id: 'soundcloud'},
    {keys: ['twitch'], id: 'twitch'},
    {keys: ['dailymotion'], id: 'dailymotion'},
  ];

  for (const entry of keywordMap) {
    if (entry.keys.some((k) => lower.includes(k))) {
      const platform = PLATFORMS[entry.id];
      const handleMatch = trimmed.match(/@[A-Za-z0-9_.-]+/);
      return {
        detected: true,
        isUrl: false,
        platform,
        videoId: null,
        contentType: 'Search',
        normalizedUrl: trimmed,
        creatorHint: handleMatch ? handleMatch[0] : null,
        confidenceMs: 0.15,
        directPlatformUrl: buildPlatformSearchUrl(entry.id, trimmed),
        platformSearchUrl: buildPlatformSearchUrl(entry.id, trimmed),
        isMetaPlatform: ['facebook', 'instagram', 'threads'].includes(entry.id),
      };
    }
  }

  return {
    detected: false,
    isUrl: Boolean(parsedUrl),
    platform: null,
    videoId: null,
    contentType: 'Search',
    normalizedUrl: trimmed,
    creatorHint: null,
    confidenceMs: 0.2,
    directPlatformUrl: null,
    platformSearchUrl: null,
  };
}

export function calculateStreamSizeBytes(
  durationSec: number,
  qualityId: QualityId,
  audioMode: AudioMode,
  realBaseSizeBytes?: number,
): number {
  if (audioMode === 'image_only') {
    return 480 * 1024;
  }

  const safeDuration = Math.max(5, durationSec || 30);
  const audioBitrateKbps = 256;
  const audioBytes = Math.round((safeDuration * audioBitrateKbps * 1000) / 8);

  if (audioMode === 'audio_only') {
    return audioBytes;
  }

  if (realBaseSizeBytes && realBaseSizeBytes > 10000) {
    return audioMode === 'muted_video'
      ? Math.max(10000, realBaseSizeBytes - audioBytes)
      : realBaseSizeBytes;
  }

  const quality = STANDARD_QUALITIES.find((q) => q.id === qualityId) || STANDARD_QUALITIES[2];
  const videoBytes = Math.round((safeDuration * quality.videoBitrateKbps * 1000) / 8);

  return audioMode === 'with_audio' ? videoBytes + audioBytes : videoBytes;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx >= 2 ? 1 : 0)} ${units[idx]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem.toString().padStart(2, '0')}`;
}

export function buildDownloadFilename(
  video: Pick<ResolvedVideo, 'platformId' | 'videoId' | 'title'>,
  qualityId: QualityId,
  audioMode: AudioMode,
  imageIndex?: number,
): string {
  const cleanId =
    (video.videoId || 'media').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'media';
  if (audioMode === 'image_only') {
    const suffix = imageIndex !== undefined ? `_img${imageIndex + 1}` : '_original-photo';
    return `${video.platformId}_${cleanId}${suffix}.jpg`;
  }
  if (audioMode === 'audio_only') {
    return `${video.platformId}_${cleanId}_320kbps_audio-only.mp3`;
  }
  const audioSuffix = audioMode === 'with_audio' ? 'with-audio' : 'muted-no-audio';
  return `${video.platformId}_${cleanId}_${qualityId}_${audioSuffix}.mp4`;
}

/**
 * Builds the direct Render backend download endpoint URL (`/api/download`)
 * so the browser downloads straight from Render without ever doing client-side CDN blob fetches.
 */
export function buildBackendDownloadUrl(params: {
  platformId: PlatformId;
  videoId: string;
  title: string;
  quality: QualityId;
  audioMode: AudioMode;
  originalUrl: string;
  streamUrl?: string;
  audioUrl?: string;
  imageUrl?: string;
}): string {
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
  return `${CLOUD_BACKEND_ORIGIN}/api/download?${query.toString()}`;
}

/**
 * Builds the direct Render backend image download endpoint URL (`/api/download-image`).
 */
export function buildBackendImageDownloadUrl(imageUrl: string, filename: string): string {
  return `${CLOUD_BACKEND_ORIGIN}/api/download-image?url=${encodeURIComponent(
    imageUrl,
  )}&filename=${encodeURIComponent(filename)}`;
}

/**
 * Builds a ResolvedVideo structure from detection + backend extracted stream & photo data.
 */
export function resolveVideoFromDetection(
  rawInput: string,
  detection: DetectionResult,
  liveData?: {
    title?: string;
    author_name?: string;
    author_handle?: string;
    author_url?: string;
    durationSec?: number;
    viewCount?: number;
    likeCount?: number;
    thumbnailUrl?: string;
    videoStreamUrl?: string;
    hdStreamUrl?: string;
    wmStreamUrl?: string;
    audioStreamUrl?: string;
    hdSizeBytes?: number;
    sdSizeBytes?: number;
    images?: ExtractedImageItem[];
    qualities?: QualityOption[];
    resolveTimeMs?: number;
    resolvedVia?: ResolvedVideo['resolvedVia'];
    contentTypeOverride?: DetectionResult['contentType'];
  },
): ResolvedVideo {
  const platform = detection.platform || PLATFORMS.facebook;
  const videoId = detection.videoId || 'media';

  const maxOrder: QualityId[] = ['2160p', '1440p', '1080p', '720p', '480p', '360p'];
  const maxIdx = Math.max(0, maxOrder.indexOf(platform.maxResolution));
  const defaultQualities = STANDARD_QUALITIES.slice(maxIdx).map((q) => {
    if (q.id === '1080p' && liveData?.hdStreamUrl) {
      return {
        ...q,
        directStreamUrl: liveData.hdStreamUrl,
        realSizeBytes: liveData.hdSizeBytes || liveData.sdSizeBytes,
      };
    }
    if (q.id === '720p' && liveData?.videoStreamUrl) {
      return {
        ...q,
        directStreamUrl: liveData.videoStreamUrl,
        realSizeBytes: liveData.sdSizeBytes,
      };
    }
    if (
      (q.id === '480p' || q.id === '360p') &&
      (liveData?.wmStreamUrl || liveData?.videoStreamUrl)
    ) {
      return {
        ...q,
        directStreamUrl: liveData.wmStreamUrl || liveData.videoStreamUrl,
      };
    }
    return q;
  });

  const effectiveContentType =
    liveData?.contentTypeOverride ||
    (detection.contentType === 'Search' ? 'Video' : detection.contentType);

  const isVertical =
    platform.id === 'tiktok' ||
    platform.id === 'instagram' ||
    platform.id === 'douyin' ||
    platform.id === 'threads' ||
    effectiveContentType === 'Shorts' ||
    effectiveContentType === 'Reel';

  const handle =
    liveData?.author_handle ||
    detection.creatorHint ||
    (liveData?.author_name
      ? `@${liveData.author_name.replace(/\s+/g, '').toLowerCase()}`
      : `@${platform.id}`);

  const extractedImages: ExtractedImageItem[] =
    liveData?.images && liveData.images.length > 0
      ? liveData.images
      : liveData?.thumbnailUrl
        ? [
            {
              id: `${videoId}-cover-1`,
              url: liveData.thumbnailUrl,
              label: `Ảnh gốc / Ảnh bìa độ phân giải cao (${platform.name})`,
              format: 'JPG',
            },
          ]
        : [];

  return {
    id: `${platform.id}-${videoId}`,
    videoId,
    platformId: platform.id,
    platformName: platform.name,
    contentType: effectiveContentType,
    title: liveData?.title || `${platform.name} ${effectiveContentType} (${videoId})`,
    authorName: liveData?.author_name || handle.replace(/^@/, ''),
    authorHandle: handle,
    authorUrl: liveData?.author_url || `https://${platform.domain}`,
    durationSec: liveData?.durationSec || (effectiveContentType === 'Photo' ? 0 : 30),
    publishedAt: 'Trực tiếp từ nguồn gốc',
    viewCount: liveData?.viewCount || 0,
    likeCount: liveData?.likeCount || 0,
    originalUrl: detection.normalizedUrl || rawInput.trim(),
    directPlatformUrl: detection.directPlatformUrl || rawInput.trim(),
    noWatermarkAvailable: platform.supportsNoWatermark,
    audioTrackTitle: `Âm thanh gốc — ${platform.name} (${videoId})`,
    audioCodec: 'AAC-LC 256kbps 48kHz Stereo',
    videoCodec: 'H.264 / AVC1 High@L4.2',
    aspectRatio: isVertical ? '9:16' : '16:9',
    previewAccent: platform.accentHex,
    thumbnailUrl: liveData?.thumbnailUrl || extractedImages[0]?.url,
    videoStreamUrl: liveData?.videoStreamUrl || liveData?.hdStreamUrl,
    hdStreamUrl: liveData?.hdStreamUrl || liveData?.videoStreamUrl,
    wmStreamUrl: liveData?.wmStreamUrl,
    audioStreamUrl: liveData?.audioStreamUrl,
    images: extractedImages,
    qualities:
      liveData?.qualities && liveData.qualities.length > 0 ? liveData.qualities : defaultQualities,
    resolveTimeMs: liveData?.resolveTimeMs,
    resolvedVia: liveData?.resolvedVia || 'url-inspector',
  };
}

/**
 * Resolves a social media URL strictly through the Render Backend (`https://iw1i8-hqo819--y18ej--uqiw78.onrender.com/api/resolve`).
 * Does NOT perform client-side third-party scraping in the browser.
 */
export async function resolveVideoViaBackend(rawInput: string): Promise<ResolvedVideo> {
  const trimmed = rawInput.trim();
  const postRes = await fetch(`${CLOUD_BACKEND_ORIGIN}/api/resolve`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({input: trimmed}),
  });

  if (postRes.ok) {
    const data = (await postRes.json()) as {video?: ResolvedVideo};
    if (data?.video) {
      return data.video;
    }
  }

  // Fallback GET request to Render backend `/api/resolve?url=...`
  const getRes = await fetch(
    `${CLOUD_BACKEND_ORIGIN}/api/resolve?url=${encodeURIComponent(trimmed)}`,
    {method: 'GET'},
  );
  if (getRes.ok) {
    const data = (await getRes.json()) as {video?: ResolvedVideo};
    if (data?.video) {
      return data.video;
    }
  }

  throw new Error(
    `Máy chủ Render (${CLOUD_BACKEND_ORIGIN}) chưa phản hồi kết quả phân tích cho đường dẫn này.`,
  );
}

/**
 * Kept for backwards-compatibility with imports; delegates directly to the Render backend.
 */
export async function extractRealVideoClientSide(rawInput: string): Promise<ResolvedVideo> {
  return resolveVideoViaBackend(rawInput);
}

/**
 * Live search routed strictly through the Render backend (`https://iw1i8-hqo819--y18ej--uqiw78.onrender.com/api/...`).
 */
export async function searchLiveVideos(
  query: string,
  platformFilter: PlatformId | 'all' = 'all',
): Promise<LiveSearchVideoItem[]> {
  const q = query.trim();
  if (!q) return [];

  const detection = detectSocialPlatform(q);
  if (detection.isUrl && detection.platform) {
    const v = await resolveVideoViaBackend(q);
    return [
      {
        id: v.id,
        videoId: v.videoId,
        platformId: v.platformId,
        contentType: 'Video',
        title: v.title,
        authorName: v.authorName,
        authorHandle: v.authorHandle,
        durationSec: v.durationSec,
        publishedAt: v.publishedAt,
        viewCount: v.viewCount,
        url: v.originalUrl,
        thumbnailUrl: v.thumbnailUrl,
        videoStreamUrl: v.videoStreamUrl,
      },
    ];
  }

  const backendSearchRes = await fetch(
    `${CLOUD_BACKEND_ORIGIN}/api/search?q=${encodeURIComponent(q)}&platform=${encodeURIComponent(
      platformFilter,
    )}`,
  );
  if (backendSearchRes.ok) {
    const json = (await backendSearchRes.json()) as {results?: LiveSearchVideoItem[]};
    if (Array.isArray(json.results)) {
      return json.results;
    }
  }

  return [];
}
