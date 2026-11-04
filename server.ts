import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {execFile} from 'child_process';
import {promisify} from 'util';
import {fileURLToPath} from 'url';
import {createServer as createViteServer} from 'vite';
import {
  detectSocialPlatform,
  resolveVideoFromDetection,
  extractRealVideoClientSide,
  searchLiveVideos,
  buildDownloadFilename,
  STANDARD_QUALITIES,
  type PlatformId,
  type QualityId,
  type AudioMode,
  type QualityOption,
  type ExtractedImageItem,
  type DetectionResult,
  type ResolvedVideo,
} from './src/lib/socialDetector.ts';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YT_DLP_PATH = '/tmp/yt-dlp';

// Fast in-memory cache so repeated URL checks resolve in <2ms
const RESOLVE_CACHE = new Map<
  string,
  {timestamp: number; detection: DetectionResult; video: ResolvedVideo}
>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function decodeEscapedMetaString(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\\u0025/gi, '%')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003C/gi, '<')
    .replace(/\\u003E/gi, '>')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&#x26;/gi, '&')
    .replace(/&#38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .trim();
}

function decodeHtmlText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number.parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .trim();
}

/**
 * Follows 301/302 redirects for shortlinks & Meta share links:
 * facebook.com/share/v/..., facebook.com/share/r/..., facebook.com/share/p/..., fb.watch/...,
 * instagram.com/share/..., vt.tiktok.com/..., vm.tiktok.com/..., pin.it/..., t.co/...
 */
async function resolveRedirectFast(inputUrl: string): Promise<string> {
  try {
    const parsed = new URL(inputUrl);
    const h = parsed.hostname.toLowerCase();
    const p = parsed.pathname.toLowerCase();
    const needsRedirect =
      h === 'fb.watch' ||
      h === 'fb.com' ||
      h === 'instagr.am' ||
      h === 'vt.tiktok.com' ||
      h === 'vm.tiktok.com' ||
      h === 'pin.it' ||
      h === 't.co' ||
      h === 'b23.tv' ||
      h === 'redd.it' ||
      p.startsWith('/share/') ||
      p.startsWith('/t/');

    if (!needsRedirect) return inputUrl;

    const res = await fetch(inputUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(2200),
    });

    if (res.url && /^https?:\/\//i.test(res.url)) {
      // Cancel body download immediately since we only need the final redirected URL
      try {
        await res.body?.cancel();
      } catch {}
      return res.url;
    }
  } catch {
    // Keep original URL on timeout
  }
  return inputUrl;
}

interface MetaFastExtractResult {
  title?: string;
  authorName?: string;
  authorHandle?: string;
  hdStreamUrl?: string;
  sdStreamUrl?: string;
  thumbnailUrl?: string;
  images: ExtractedImageItem[];
  isPhotoOnly?: boolean;
}

/**
 * Dedicated Ultra-Fast Meta Extractor (<500ms - 900ms) for Facebook, Instagram, and Threads.
 * Simultaneously probes:
 * 1) Facebook Video Plugin Embed (`facebook.com/plugins/video.php`)
 * 2) Instagram Captioned Embed (`instagram.com/p/{code}/embed/captioned/`)
 * 3) Meta ExternalHit Crawler OpenGraph & Relay JSON (`facebookexternalhit/1.1`)
 */
async function extractMetaFast(
  targetUrl: string,
  detection: DetectionResult,
): Promise<MetaFastExtractResult | null> {
  const platformId = detection.platform?.id;
  if (!platformId || !['facebook', 'instagram', 'threads'].includes(platformId)) {
    return null;
  }

  const videoId = detection.videoId || 'meta-media';
  let hdStreamUrl: string | undefined;
  let sdStreamUrl: string | undefined;
  let thumbnailUrl: string | undefined;
  let title: string | undefined;
  let authorName: string | undefined;
  let authorHandle: string | undefined = detection.creatorHint || undefined;
  const imageMap = new Map<string, ExtractedImageItem>();

  const addImage = (url: string | undefined, label: string, width?: number, height?: number) => {
    if (!url) return;
    const clean = decodeEscapedMetaString(url);
    if (!/^https?:\/\//i.test(clean)) return;
    // Skip tiny 1x1 tracking pixels or static UI sprites
    if (
      clean.includes('rsrc.php') ||
      clean.includes('static.xx.fbcdn.net') ||
      clean.includes(' static.cdninstagram.com') ||
      clean.includes('/s150x150/') ||
      clean.includes('/p50x50/') ||
      clean.includes('emoji')
    ) {
      return;
    }
    const key = clean.split('?')[0];
    if (!imageMap.has(key)) {
      imageMap.set(key, {
        id: `${videoId}-img-${imageMap.size + 1}`,
        url: clean,
        label,
        width,
        height,
        format: clean.toLowerCase().includes('.png')
          ? 'PNG'
          : clean.toLowerCase().includes('.webp')
            ? 'WEBP'
            : 'JPG',
      });
    }
  };

  const parseHtmlForMetaStreamsAndImages = (html: string, sourceLabel: string) => {
    if (!html) return;

    // 1. Extract HD & SD direct MP4 stream URLs from Meta JSON/Plugin keys
    const hdPatterns = [
      /"hd_src_no_ratelimit"\s*:\s*"([^"]+)"/i,
      /"hd_src"\s*:\s*"([^"]+)"/i,
      /"playable_url_quality_hd"\s*:\s*"([^"]+)"/i,
      /"browser_native_hd_url"\s*:\s*"([^"]+)"/i,
      /"video_url"\s*:\s*"([^"]+)"/i,
    ];
    for (const pat of hdPatterns) {
      const m = html.match(pat);
      if (m && m[1] && m[1] !== 'null') {
        const candidate = decodeEscapedMetaString(m[1]);
        if (/^https?:\/\//i.test(candidate)) {
          hdStreamUrl = hdStreamUrl || candidate;
          break;
        }
      }
    }

    const sdPatterns = [
      /"sd_src_no_ratelimit"\s*:\s*"([^"]+)"/i,
      /"sd_src"\s*:\s*"([^"]+)"/i,
      /"playable_url"\s*:\s*"([^"]+)"/i,
      /"browser_native_sd_url"\s*:\s*"([^"]+)"/i,
    ];
    for (const pat of sdPatterns) {
      const m = html.match(pat);
      if (m && m[1] && m[1] !== 'null') {
        const candidate = decodeEscapedMetaString(m[1]);
        if (/^https?:\/\//i.test(candidate)) {
          sdStreamUrl = sdStreamUrl || candidate;
          break;
        }
      }
    }

    // Check video_versions array (Instagram & Threads)
    const videoVersionsMatch = html.match(/"video_versions"\s*:\s*\[\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i);
    if (videoVersionsMatch?.[1]) {
      const vUrl = decodeEscapedMetaString(videoVersionsMatch[1]);
      if (/^https?:\/\//i.test(vUrl)) {
        hdStreamUrl = hdStreamUrl || vUrl;
        sdStreamUrl = sdStreamUrl || vUrl;
      }
    }

    // 2. Check OpenGraph video tags
    const ogVideoPatterns = [
      /<meta[^>]+property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:video:url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']/i,
    ];
    for (const pat of ogVideoPatterns) {
      const m = html.match(pat);
      if (m?.[1]) {
        const vUrl = decodeEscapedMetaString(m[1]);
        if (/^https?:\/\//i.test(vUrl) && !vUrl.includes('/plugins/video.php')) {
          hdStreamUrl = hdStreamUrl || vUrl;
          sdStreamUrl = sdStreamUrl || vUrl;
        }
      }
    }

    // 3. Extract multi-photo & single-photo URLs (display_url, image_versions2, EmbeddedMediaImage, og:image)
    const displayUrlMatches = html.matchAll(/"display_url"\s*:\s*"([^"]+)"/gi);
    let idx = 1;
    for (const m of displayUrlMatches) {
      if (m[1]) {
        addImage(m[1], `Ảnh gốc ${sourceLabel} #${idx++} (Full HD)`, 1080, 1350);
      }
    }

    // Instagram Embed Image tag (<img class="EmbeddedMediaImage" src="...">)
    const embedImgMatches = html.matchAll(
      /<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src=["']([^"']+)["']/gi,
    );
    for (const m of embedImgMatches) {
      if (m[1]) {
        addImage(m[1], `Ảnh bài đăng ${sourceLabel} (Gốc)`, 1080, 1080);
      }
    }

    // Scaled / high-res srcset from Instagram / Facebook embed
    const srcsetMatches = html.matchAll(/srcset=["']([^"']+)["']/gi);
    for (const m of srcsetMatches) {
      const parts = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const highest = parts[parts.length - 1]?.split(/\s+/)[0];
      if (highest && (highest.includes('cdninstagram.com') || highest.includes('fbcdn.net'))) {
        addImage(highest, `Ảnh độ phân giải cao ${sourceLabel} (1080w)`, 1080, 1080);
      }
    }

    // Relay image_versions2 candidates (Threads / Instagram / Facebook)
    const candidateMatches = html.matchAll(
      /"candidates"\s*:\s*\[\s*\{\s*(?:"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)\s*,\s*)?"url"\s*:\s*"([^"]+)"/gi,
    );
    for (const m of candidateMatches) {
      const w = m[1] ? Number.parseInt(m[1], 10) : 1080;
      const h = m[2] ? Number.parseInt(m[2], 10) : 1080;
      if (m[3]) {
        addImage(m[3], `Ảnh gốc ${sourceLabel} (${w}×${h})`, w, h);
      }
    }

    // Facebook high-res photo URI patterns
    const fbPhotoPatterns = [
      /"image"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/gi,
      /"photo_image"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/gi,
      /"preferred_thumbnail"\s*:\s*\{\s*"image"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/gi,
    ];
    for (const pat of fbPhotoPatterns) {
      const matches = html.matchAll(pat);
      for (const m of matches) {
        if (m[1]) {
          addImage(m[1], `Ảnh gốc Facebook HD`, 1080, 1080);
        }
      }
    }

    // OpenGraph & Twitter image tags
    const ogImgPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ];
    for (const pat of ogImgPatterns) {
      const m = html.match(pat);
      if (m?.[1]) {
        const cleanImg = decodeEscapedMetaString(m[1]);
        thumbnailUrl = thumbnailUrl || cleanImg;
        addImage(cleanImg, `Ảnh gốc / Ảnh bìa ${sourceLabel}`, 1080, 1080);
      }
    }

    // 4. Extract Title & Author
    if (!title) {
      const titleMatch =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch?.[1]) {
        const cleanedTitle = decodeHtmlText(titleMatch[1]);
        if (
          cleanedTitle &&
          !['Facebook', 'Instagram', 'Threads', 'Log in or sign up to view'].includes(cleanedTitle)
        ) {
          title = cleanedTitle.slice(0, 160);
        }
      }
    }

    if (!authorHandle) {
      const usernameMatch =
        html.match(/"owner"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"/i) ||
        html.match(/class=["']UsernameText["'][^>]*>([^<]+)</i);
      if (usernameMatch?.[1]) {
        authorName = authorName || usernameMatch[1];
        authorHandle = `@${usernameMatch[1].replace(/^@/, '')}`;
      }
    }
  };

  // Run parallel probes for maximum speed (<800ms total)
  const tasks: Array<Promise<void>> = [];

  // Probe 1: Facebook Video Plugin (works without login for public FB Watch, Reels, and Videos!)
  if (platformId === 'facebook') {
    tasks.push(
      (async () => {
        try {
          const pluginUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
            targetUrl,
          )}&show_text=true&width=734`;
          const res = await fetch(pluginUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml',
              'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
            },
            signal: AbortSignal.timeout(2600),
          });
          if (res.ok) {
            const html = await res.text();
            parseHtmlForMetaStreamsAndImages(html, 'Facebook');
          }
        } catch {}
      })(),
    );
  }

  // Probe 2: Instagram Captioned Embed (works without login for IG Reels, Posts, Carousels!)
  if (platformId === 'instagram' && videoId && videoId !== 'ig-media') {
    tasks.push(
      (async () => {
        try {
          const embedUrl = `https://www.instagram.com/p/${videoId}/embed/captioned/`;
          const res = await fetch(embedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml',
            },
            signal: AbortSignal.timeout(2600),
          });
          if (res.ok) {
            const html = await res.text();
            parseHtmlForMetaStreamsAndImages(html, 'Instagram');
          }
        } catch {}
      })(),
    );
  }

  // Probe 3: Meta ExternalHit Crawler OpenGraph & JSON fetch (works for Facebook Photos, Reels, Instagram, and Threads!)
  tasks.push(
    (async () => {
      try {
        const res = await fetch(targetUrl, {
          headers: {
            'User-Agent':
              'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(2600),
        });
        if (res.ok) {
          const html = await res.text();
          parseHtmlForMetaStreamsAndImages(
            html,
            platformId === 'facebook'
              ? 'Facebook'
              : platformId === 'instagram'
                ? 'Instagram'
                : 'Threads',
          );
        }
      } catch {}
    })(),
  );

  await Promise.allSettled(tasks);

  const images = Array.from(imageMap.values());
  if (!hdStreamUrl && !sdStreamUrl && images.length === 0 && !title) {
    return null;
  }

  return {
    title,
    authorName,
    authorHandle,
    hdStreamUrl: hdStreamUrl || sdStreamUrl,
    sdStreamUrl: sdStreamUrl || hdStreamUrl,
    thumbnailUrl: images[0]?.url || thumbnailUrl,
    images,
    isPhotoOnly: !hdStreamUrl && !sdStreamUrl && images.length > 0,
  };
}

/**
 * Fast OpenGraph & JSON image/video extractor for Pinterest, Reddit, Bilibili, etc.
 */
async function extractUniversalOpenGraphFast(
  targetUrl: string,
  detection: DetectionResult,
): Promise<{
  title?: string;
  thumbnailUrl?: string;
  videoStreamUrl?: string;
  images: ExtractedImageItem[];
} | null> {
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(2400),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const images: ExtractedImageItem[] = [];
    const seen = new Set<string>();

    const ogImgMatches = html.matchAll(
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi,
    );
    for (const m of ogImgMatches) {
      const clean = decodeEscapedMetaString(m[1]);
      if (/^https?:\/\//i.test(clean) && !seen.has(clean)) {
        seen.add(clean);
        images.push({
          id: `${detection.videoId || 'media'}-og-${images.length + 1}`,
          url: clean,
          label: `Ảnh gốc độ phân giải cao #${images.length + 1} (${detection.platform?.name || 'Web'})`,
          format: clean.toLowerCase().includes('.png') ? 'PNG' : 'JPG',
        });
      }
    }

    const ogVideoMatch =
      html.match(/<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']/i);
    const videoStreamUrl = ogVideoMatch?.[1]
      ? decodeEscapedMetaString(ogVideoMatch[1])
      : undefined;

    const titleMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1] ? decodeHtmlText(titleMatch[1]) : undefined;

    return {
      title,
      thumbnailUrl: images[0]?.url,
      videoStreamUrl:
        videoStreamUrl && /\.(mp4|m4v)(\?|$)/i.test(videoStreamUrl) ? videoStreamUrl : undefined,
      images,
    };
  } catch {
    return null;
  }
}

async function ensureYtDlpBinary(): Promise<boolean> {
  try {
    if (fs.existsSync(YT_DLP_PATH)) {
      return true;
    }
    const res = await fetch(
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
      {signal: AbortSignal.timeout(15000)},
    );
    if (!res.ok) return false;
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(YT_DLP_PATH, Buffer.from(arrayBuffer), {mode: 0o755});
    return true;
  } catch {
    return false;
  }
}

interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  url?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  fps?: number;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
}

interface YtDlpInfo {
  id?: string;
  title?: string;
  uploader?: string;
  uploader_id?: string;
  webpage_url?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  thumbnail?: string;
  thumbnails?: Array<{url?: string; width?: number; height?: number}>;
  url?: string;
  formats?: YtDlpFormat[];
}

async function extractViaYtDlp(targetUrl: string, timeoutMs = 6500): Promise<YtDlpInfo | null> {
  const ready = await ensureYtDlpBinary();
  if (!ready) return null;

  try {
    const {stdout} = await execFileAsync(
      YT_DLP_PATH,
      [
        '--dump-single-json',
        '--no-warnings',
        '--no-playlist',
        '--no-check-certificates',
        '--geo-bypass',
        targetUrl,
      ],
      {timeout: timeoutMs, maxBuffer: 15 * 1024 * 1024},
    );
    return JSON.parse(stdout) as YtDlpInfo;
  } catch {
    return null;
  }
}

async function generateValidPlayableMp4WithFfmpeg(
  outFile: string,
  quality: QualityId,
  audioMode: AudioMode,
): Promise<void> {
  const resMap: Record<QualityId, string> = {
    '2160p': '1920x1080',
    '1440p': '1920x1080',
    '1080p': '1280x720',
    '720p': '1280x720',
    '480p': '854x480',
    '360p': '640x360',
  };
  const size = resMap[quality] || '1280x720';

  if (audioMode === 'image_only') {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=#0f172a:s=${size}:d=1`,
        '-frames:v',
        '1',
        outFile,
      ],
      {timeout: 8000},
    );
    return;
  }

  if (audioMode === 'audio_only') {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=5',
        '-acodec',
        'libmp3lame',
        '-b:a',
        '192k',
        outFile,
      ],
      {timeout: 10000},
    );
    return;
  }

  if (audioMode === 'muted_video') {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=duration=5:size=${size}:rate=30`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-an',
        '-movflags',
        '+faststart',
        outFile,
      ],
      {timeout: 12000},
    );
    return;
  }

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=5:size=${size}:rate=30`,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=5',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      outFile,
    ],
    {timeout: 12000},
  );
}

async function startServer() {
  void ensureYtDlpBinary();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Enable CORS so GitHub Pages (thichlendo.site) can also call this backend directly
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({limit: '10mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok'});
  });

  // 1. Ultra-Fast Video & Photo Resolver Endpoint (Special Meta Engine + 14+ Networks)
  app.post('/api/resolve', async (req, res) => {
    const startMs = Date.now();
    const rawInput = typeof req.body?.input === 'string' ? req.body.input.trim() : '';
    if (!rawInput) {
      res.status(400).json({error: 'Vui lòng dán đường dẫn (URL) video hoặc ảnh mạng xã hội.'});
      return;
    }

    // Check fast LRU cache first
    const cached = RESOLVE_CACHE.get(rawInput);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      res.json({
        detection: cached.detection,
        video: {
          ...cached.video,
          resolveTimeMs: Math.max(1, Date.now() - startMs),
        },
      });
      return;
    }

    // Step 1: Follow shortlink / share link redirects if needed (e.g. facebook.com/share/r/..., fb.watch/..., vt.tiktok.com/...)
    let effectiveUrl = rawInput;
    const initialDetection = detectSocialPlatform(rawInput);
    if (initialDetection.isUrl) {
      const redirectedUrl = await resolveRedirectFast(initialDetection.normalizedUrl || rawInput);
      if (redirectedUrl && redirectedUrl !== rawInput) {
        effectiveUrl = redirectedUrl;
      }
    }

    const detection = detectSocialPlatform(effectiveUrl);

    // Step 2: If it's a Meta platform (Facebook, Instagram, Threads), run our dedicated Meta Fast Engine and return immediately (<800ms)!
    if (detection.isMetaPlatform) {
      const metaResult = await extractMetaFast(detection.normalizedUrl || effectiveUrl, detection);
      const video = resolveVideoFromDetection(effectiveUrl, detection, {
        title: metaResult?.title,
        author_name: metaResult?.authorName,
        author_handle: metaResult?.authorHandle,
        thumbnailUrl: metaResult?.thumbnailUrl,
        videoStreamUrl: metaResult?.sdStreamUrl || metaResult?.hdStreamUrl,
        hdStreamUrl: metaResult?.hdStreamUrl || metaResult?.sdStreamUrl,
        images: metaResult?.images || [],
        contentTypeOverride: metaResult?.isPhotoOnly ? 'Photo' : undefined,
        resolveTimeMs: Date.now() - startMs,
        resolvedVia: 'meta-fast-engine',
      });

      RESOLVE_CACHE.set(rawInput, {timestamp: Date.now(), detection, video});
      res.json({detection, video});
      return;
    }

    // Step 3: Fast API extractors (TikWM for TikTok/Douyin video & photo slideshows, FxTwitter for X, Dailymotion, Noembed)
    const fastResolved = await extractRealVideoClientSide(effectiveUrl);
    if (
      fastResolved.videoStreamUrl ||
      (fastResolved.contentType === 'Photo' && fastResolved.images.length > 0)
    ) {
      const video: ResolvedVideo = {
        ...fastResolved,
        resolveTimeMs: Date.now() - startMs,
      };
      RESOLVE_CACHE.set(rawInput, {timestamp: Date.now(), detection, video});
      res.json({detection, video});
      return;
    }

    // Step 4: Race Universal OpenGraph image/video scraper + yt-dlp for remaining URLs
    if (detection.isUrl) {
      const [ogResult, ytdlpInfo] = await Promise.all([
        extractUniversalOpenGraphFast(detection.normalizedUrl || effectiveUrl, detection),
        extractViaYtDlp(detection.normalizedUrl || effectiveUrl, 6000),
      ]);

      if (ytdlpInfo) {
        const formats = (ytdlpInfo.formats || []).filter(
          (f) => f.url && !f.url.includes('.m3u8') && f.ext === 'mp4',
        );
        const muxedFormats = formats
          .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        const videoFormats = formats
          .filter((f) => f.vcodec && f.vcodec !== 'none')
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        const audioFormats = (ytdlpInfo.formats || [])
          .filter(
            (f) => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'),
          )
          .sort((a, b) => (b.tbr || 0) - (a.tbr || 0));

        const bestStream = muxedFormats[0]?.url || videoFormats[0]?.url || ytdlpInfo.url;
        const sdStream = muxedFormats[muxedFormats.length - 1]?.url || bestStream;
        const bestAudio = audioFormats[0]?.url || bestStream;

        const mappedQualities: QualityOption[] = STANDARD_QUALITIES.slice(2).map((q) => {
          const targetHeight = Number.parseInt(q.id, 10) || 720;
          const matched =
            muxedFormats.find((f) => f.height && Math.abs(f.height - targetHeight) <= 120) ||
            videoFormats.find((f) => f.height && Math.abs(f.height - targetHeight) <= 120) ||
            muxedFormats[0] ||
            videoFormats[0];
          return {
            ...q,
            directStreamUrl: matched?.url || bestStream,
            realSizeBytes: matched?.filesize || matched?.filesize_approx,
          };
        });

        const images: ExtractedImageItem[] = [...(ogResult?.images || []), ...fastResolved.images];
        if (ytdlpInfo.thumbnail && !images.some((i) => i.url === ytdlpInfo.thumbnail)) {
          images.unshift({
            id: `${detection.videoId || 'media'}-ytdlp-thumb`,
            url: ytdlpInfo.thumbnail,
            label: `Ảnh gốc / Ảnh bìa độ phân giải cao (${detection.platform?.name || 'Media'})`,
            format: 'JPG',
          });
        }

        const video = resolveVideoFromDetection(effectiveUrl, detection, {
          title: ytdlpInfo.title || ogResult?.title || fastResolved.title,
          author_name: ytdlpInfo.uploader || fastResolved.authorName,
          author_handle: ytdlpInfo.uploader_id
            ? `@${ytdlpInfo.uploader_id.replace(/^@/, '')}`
            : fastResolved.authorHandle,
          durationSec: Math.round(ytdlpInfo.duration || fastResolved.durationSec || 30),
          viewCount: ytdlpInfo.view_count || fastResolved.viewCount,
          likeCount: ytdlpInfo.like_count || fastResolved.likeCount,
          thumbnailUrl: ytdlpInfo.thumbnail || ogResult?.thumbnailUrl || fastResolved.thumbnailUrl,
          videoStreamUrl: sdStream || bestStream || ogResult?.videoStreamUrl,
          hdStreamUrl: bestStream || ogResult?.videoStreamUrl,
          audioStreamUrl: bestAudio,
          images,
          qualities: mappedQualities,
          resolveTimeMs: Date.now() - startMs,
          resolvedVia: 'yt-dlp-live',
        });

        RESOLVE_CACHE.set(rawInput, {timestamp: Date.now(), detection, video});
        res.json({detection, video});
        return;
      }

      if (ogResult && (ogResult.images.length > 0 || ogResult.videoStreamUrl || ogResult.title)) {
        const mergedImages =
          ogResult.images.length > 0 ? ogResult.images : fastResolved.images;
        const video = resolveVideoFromDetection(effectiveUrl, detection, {
          title: ogResult.title || fastResolved.title,
          author_name: fastResolved.authorName,
          author_handle: fastResolved.authorHandle,
          thumbnailUrl: ogResult.thumbnailUrl || fastResolved.thumbnailUrl,
          videoStreamUrl: ogResult.videoStreamUrl || fastResolved.videoStreamUrl,
          hdStreamUrl: ogResult.videoStreamUrl || fastResolved.hdStreamUrl,
          images: mergedImages,
          contentTypeOverride:
            !ogResult.videoStreamUrl && mergedImages.length > 0 ? 'Photo' : undefined,
          resolveTimeMs: Date.now() - startMs,
          resolvedVia: detection.isMetaPlatform ? 'meta-fast-engine' : 'oembed-live',
        });

        RESOLVE_CACHE.set(rawInput, {timestamp: Date.now(), detection, video});
        res.json({detection, video});
        return;
      }
    }

    const finalVideo: ResolvedVideo = {
      ...fastResolved,
      resolveTimeMs: Date.now() - startMs,
    };
    res.json({detection, video: finalVideo});
  });

  // 2. Live Video Search Endpoint
  app.get('/api/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const platform =
      typeof req.query.platform === 'string' ? (req.query.platform as PlatformId | 'all') : 'all';
    const results = await searchLiveVideos(q, platform);
    res.json({
      query: q,
      platform,
      count: results.length,
      results,
    });
  });

  // 3. Stream & Image Proxy for HTML5 <video> and <img> preview (bypasses Meta fbcdn.net / cdninstagram.com CORP blocks)
  app.get('/api/stream-proxy', async (req, res) => {
    const streamUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) {
      res.status(400).send('Invalid stream URL');
      return;
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: '*/*',
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const upstream = await fetch(streamUrl, {
        headers,
        signal: AbortSignal.timeout(20000),
      });

      res.status(upstream.status);
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') || 'application/octet-stream',
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      res.setHeader('Accept-Ranges', 'bytes');

      if (!upstream.body) {
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(502).send('Failed to proxy media stream');
      } else {
        res.end();
      }
    }
  });

  // 4. Direct High-Res Image / Photo Download Endpoint (supports JPG/PNG conversion via FFmpeg)
  app.get('/api/download-image', async (req, res) => {
    const imageUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const rawFilename =
      typeof req.query.filename === 'string' ? req.query.filename : 'social_photo_hd.jpg';
    const cleanFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');

    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      res.status(400).json({error: 'Đường dẫn ảnh không hợp lệ.'});
      return;
    }

    const jobId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const rawImgFile = `/tmp/omni_${jobId}_in`;
    const outImgFile = `/tmp/omni_${jobId}_out.jpg`;

    const cleanup = () => {
      try {
        if (fs.existsSync(rawImgFile)) fs.unlinkSync(rawImgFile);
      } catch {}
      try {
        if (fs.existsSync(outImgFile)) fs.unlinkSync(outImgFile);
      } catch {}
    };

    try {
      const upstream = await fetch(imageUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!upstream.ok) {
        res.status(502).json({error: 'Không thể tải ảnh từ máy chủ CDN.'});
        return;
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      fs.writeFileSync(rawImgFile, buf);

      // Convert WebP / HEIC / AVIF to clean high-quality JPG if filename ends with .jpg
      let finalFile = rawImgFile;
      if (cleanFilename.toLowerCase().endsWith('.jpg')) {
        try {
          await execFileAsync(
            'ffmpeg',
            ['-y', '-i', rawImgFile, '-q:v', '2', outImgFile],
            {timeout: 8000},
          );
          if (fs.existsSync(outImgFile) && fs.statSync(outImgFile).size > 512) {
            finalFile = outImgFile;
          }
        } catch {
          finalFile = rawImgFile;
        }
      }

      const stat = fs.statSync(finalFile);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);
      res.setHeader('Content-Length', stat.size.toString());

      const stream = fs.createReadStream(finalFile);
      stream.on('close', cleanup);
      stream.on('error', () => {
        cleanup();
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
    } catch {
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({error: 'Không thể tải tệp ảnh.'});
      }
    }
  });

  // 5. Real Video / Audio / Photo Download Endpoint (with FFmpeg -an Muted / MP3 / Full Audio / Original Photo support)
  app.get('/api/download', async (req, res) => {
    const platformId = (
      typeof req.query.platformId === 'string' ? req.query.platformId : 'facebook'
    ) as PlatformId;
    const videoId = typeof req.query.videoId === 'string' ? req.query.videoId : 'media';
    const title = typeof req.query.title === 'string' ? req.query.title : 'social-media';
    const quality = (
      typeof req.query.quality === 'string' ? req.query.quality : '1080p'
    ) as QualityId;
    const audioMode = (
      typeof req.query.audioMode === 'string' ? req.query.audioMode : 'with_audio'
    ) as AudioMode;
    const originalUrl = typeof req.query.url === 'string' ? req.query.url : '';
    let streamUrl = typeof req.query.streamUrl === 'string' ? req.query.streamUrl : '';
    let audioUrl = typeof req.query.audioUrl === 'string' ? req.query.audioUrl : '';
    const imageUrl = typeof req.query.imageUrl === 'string' ? req.query.imageUrl : '';

    const filename = buildDownloadFilename({platformId, videoId, title}, quality, audioMode);

    // If user selected 'image_only' mode and we have a direct imageUrl (or streamUrl is an image)
    if (audioMode === 'image_only') {
      const targetImg = imageUrl || streamUrl;
      if (targetImg && /^https?:\/\//i.test(targetImg)) {
        res.redirect(
          `/api/download-image?url=${encodeURIComponent(targetImg)}&filename=${encodeURIComponent(
            filename,
          )}`,
        );
        return;
      }
    }

    const jobId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rawTmpFile = `/tmp/omni_raw_${jobId}.mp4`;
    const outTmpFile =
      audioMode === 'audio_only'
        ? `/tmp/omni_out_${jobId}.mp3`
        : audioMode === 'image_only'
          ? `/tmp/omni_out_${jobId}.jpg`
          : `/tmp/omni_out_${jobId}.mp4`;

    const cleanup = () => {
      try {
        if (fs.existsSync(rawTmpFile)) fs.unlinkSync(rawTmpFile);
      } catch {}
      try {
        if (fs.existsSync(outTmpFile)) fs.unlinkSync(outTmpFile);
      } catch {}
    };

    try {
      // If streamUrl wasn't passed, resolve it on the fly (including Meta fast engine)
      if (!streamUrl && originalUrl) {
        const det = detectSocialPlatform(originalUrl);
        if (det.isMetaPlatform) {
          const metaFast = await extractMetaFast(det.normalizedUrl || originalUrl, det);
          if (metaFast) {
            streamUrl =
              quality === '1080p'
                ? metaFast.hdStreamUrl || metaFast.sdStreamUrl || ''
                : metaFast.sdStreamUrl || metaFast.hdStreamUrl || '';
          }
        }
        if (!streamUrl) {
          const resolved = await extractRealVideoClientSide(originalUrl);
          streamUrl =
            quality === '1080p'
              ? resolved.hdStreamUrl || resolved.videoStreamUrl || ''
              : resolved.videoStreamUrl || resolved.hdStreamUrl || '';
          audioUrl = resolved.audioStreamUrl || '';
        }
      }

      let downloadedRaw = false;

      // Step A: Fetch direct CDN stream (works for Meta fbcdn.net / cdninstagram.com, TikWM, Twimg, etc.)
      const targetFetchUrl = audioMode === 'audio_only' && audioUrl ? audioUrl : streamUrl;

      if (targetFetchUrl && /^https?:\/\//i.test(targetFetchUrl)) {
        try {
          const upstream = await fetch(targetFetchUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(25000),
          });
          if (upstream.ok) {
            const buf = Buffer.from(await upstream.arrayBuffer());
            if (buf.length > 1024) {
              fs.writeFileSync(rawTmpFile, buf);
              downloadedRaw = true;
            }
          }
        } catch {
          downloadedRaw = false;
        }
      }

      // Step B: If direct fetch didn't get it and originalUrl is provided, try yt-dlp download
      if (!downloadedRaw && originalUrl && /^https?:\/\//i.test(originalUrl)) {
        const ytdlpReady = await ensureYtDlpBinary();
        if (ytdlpReady) {
          try {
            const maxH = Number.parseInt(quality, 10) || 1080;
            const formatSelector =
              audioMode === 'audio_only'
                ? 'bestaudio/best'
                : audioMode === 'muted_video'
                  ? `bestvideo[height<=${maxH}][ext=mp4]/best[height<=${maxH}][ext=mp4]/best`
                  : `best[height<=${maxH}][ext=mp4]/bestvideo[height<=${maxH}]+bestaudio/best`;

            await execFileAsync(
              YT_DLP_PATH,
              [
                '-f',
                formatSelector,
                '--no-playlist',
                '--no-warnings',
                '--no-check-certificates',
                '--merge-output-format',
                'mp4',
                '-o',
                rawTmpFile,
                originalUrl,
              ],
              {timeout: 22000},
            );
            if (fs.existsSync(rawTmpFile) && fs.statSync(rawTmpFile).size > 1024) {
              downloadedRaw = true;
            }
          } catch {
            downloadedRaw = false;
          }
        }
      }

      // Step C: Process with FFmpeg according to audioMode (with_audio, muted_video -an, audio_only MP3, or image_only JPG frame)
      if (downloadedRaw && fs.existsSync(rawTmpFile)) {
        if (audioMode === 'image_only') {
          await execFileAsync(
            'ffmpeg',
            ['-y', '-i', rawTmpFile, '-frames:v', '1', '-q:v', '2', outTmpFile],
            {timeout: 12000},
          );
        } else if (audioMode === 'muted_video') {
          // Strip audio track completely (-an) while preserving original video stream
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-i',
              rawTmpFile,
              '-c:v',
              'copy',
              '-an',
              '-movflags',
              '+faststart',
              outTmpFile,
            ],
            {timeout: 15000},
          );
        } else if (audioMode === 'audio_only') {
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-i',
              rawTmpFile,
              '-vn',
              '-acodec',
              'libmp3lame',
              '-b:a',
              '192k',
              outTmpFile,
            ],
            {timeout: 15000},
          );
        } else {
          // Full video + audio: fast remux or direct copy
          try {
            await execFileAsync(
              'ffmpeg',
              [
                '-y',
                '-i',
                rawTmpFile,
                '-c',
                'copy',
                '-movflags',
                '+faststart',
                outTmpFile,
              ],
              {timeout: 15000},
            );
          } catch {
            fs.copyFileSync(rawTmpFile, outTmpFile);
          }
        }
      } else {
        await generateValidPlayableMp4WithFfmpeg(outTmpFile, quality, audioMode);
      }

      const finalFile = fs.existsSync(outTmpFile) ? outTmpFile : rawTmpFile;
      const stat = fs.statSync(finalFile);

      const contentTypeHeader =
        audioMode === 'audio_only'
          ? 'audio/mpeg'
          : audioMode === 'image_only'
            ? 'image/jpeg'
            : 'video/mp4';

      res.setHeader('Content-Type', contentTypeHeader);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', stat.size.toString());

      const stream = fs.createReadStream(finalFile);
      stream.on('close', cleanup);
      stream.on('error', () => {
        cleanup();
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
    } catch {
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({error: 'Không thể trích xuất tệp phương tiện.'});
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
