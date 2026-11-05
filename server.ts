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
    if (
      clean.includes('rsrc.php') ||
      clean.includes('static.xx.fbcdn.net') ||
      clean.includes('static.cdninstagram.com') ||
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
    const videoVersionsMatch = html.match(
      /"video_versions"\s*:\s*\[\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
    );
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

    // 3. Extract multi-photo & single-photo URLs
    const displayUrlMatches = html.matchAll(/"display_url"\s*:\s*"([^"]+)"/gi);
    let idx = 1;
    for (const m of displayUrlMatches) {
      if (m[1]) {
        addImage(m[1], `Ảnh gốc ${sourceLabel} #${idx++} (Full HD)`, 1080, 1350);
      }
    }

    const embedImgMatches = html.matchAll(
      /<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src=["']([^"']+)["']/gi,
    );
    for (const m of embedImgMatches) {
      if (m[1]) {
        addImage(m[1], `Ảnh bài đăng ${sourceLabel} (Gốc)`, 1080, 1080);
      }
    }

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

  const tasks: Array<Promise<void>> = [];

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
    isPhotoOnly: !hdStreamUrl && !sdStreamUrl && images.length > 0 && detection.contentType === 'Photo',
  };
}

/**
 * Server-side extractor for TikTok, Douyin, X/Twitter, Dailymotion, YouTube oEmbed & thumbnails.
 * Runs exclusively on the backend so the browser never makes direct third-party API calls.
 */
async function extractPlatformStreamsServerSide(rawInput: string): Promise<ResolvedVideo> {
  const startMs = Date.now();
  const detection = detectSocialPlatform(rawInput);
  const targetUrl = detection.normalizedUrl || rawInput.trim();
  const platformId = detection.platform?.id || 'youtube';

  // 1. TikTok & Douyin (Videos + Multi-Photo Slideshows via TikWM API)
  if (platformId === 'tiktok' || platformId === 'douyin') {
    try {
      const apiRes = await fetch(
        `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}&hd=1`,
        {signal: AbortSignal.timeout(5500)},
      );
      if (apiRes.ok) {
        const payload = await apiRes.json();
        if (payload && payload.code === 0 && payload.data) {
          const d = payload.data;
          const hdUrl = d.hdplay || d.play;
          const playUrl = d.play || d.hdplay;
          const musicUrl = d.music || d.music_info?.play;
          const durationSec = Number(d.duration) || 30;
          const isPhotoCarousel = Array.isArray(d.images) && d.images.length > 0;

          const images: ExtractedImageItem[] = isPhotoCarousel
            ? d.images.map((imgUrl: string, idx: number) => ({
                id: `${d.id || 'tt'}-slide-${idx + 1}`,
                url: imgUrl,
                label: `Ảnh Slide #${idx + 1} (Full HD gốc)`,
                width: 1080,
                height: 1920,
                format: 'JPG' as const,
              }))
            : d.origin_cover || d.cover
              ? [
                  {
                    id: `${d.id || 'tt'}-cover`,
                    url: d.origin_cover || d.cover,
                    label: 'Ảnh bìa gốc độ phân giải cao (Original Cover)',
                    width: 1080,
                    height: 1920,
                    format: 'JPG' as const,
                  },
                ]
              : [];

          const qualities: QualityOption[] = [
            {
              ...STANDARD_QUALITIES[2],
              label: '1080p Full HD (Không logo)',
              directStreamUrl: hdUrl,
              realSizeBytes: Number(d.hd_size) || Number(d.size) || undefined,
            },
            {
              ...STANDARD_QUALITIES[3],
              label: '720p HD (Tốc độ cao)',
              directStreamUrl: playUrl,
              realSizeBytes: Number(d.size) || undefined,
            },
            {
              ...STANDARD_QUALITIES[4],
              directStreamUrl: d.wmplay || playUrl,
              realSizeBytes: Number(d.wm_size) || undefined,
            },
          ];

          return resolveVideoFromDetection(rawInput, detection, {
            title: d.title || `Video ${detection.platform?.name || 'TikTok'} #${d.id}`,
            author_name: d.author?.nickname || 'TikTok Creator',
            author_handle: d.author?.unique_id ? `@${d.author.unique_id}` : '@tiktok',
            thumbnailUrl: d.origin_cover || d.cover || images[0]?.url,
            durationSec,
            viewCount: Number(d.play_count) || 0,
            likeCount: Number(d.digg_count) || 0,
            videoStreamUrl: isPhotoCarousel ? undefined : playUrl,
            hdStreamUrl: isPhotoCarousel ? undefined : hdUrl,
            audioStreamUrl: musicUrl,
            images,
            contentTypeOverride: isPhotoCarousel ? 'Photo' : undefined,
            qualities,
            resolveTimeMs: Date.now() - startMs,
            resolvedVia: 'tikwm-live',
          });
        }
      }
    } catch {
      // Fall through
    }
  }

  // 2. X (Twitter) Videos & Multi-Photo Posts via FxTwitter API
  if (platformId === 'twitter' && detection.videoId) {
    try {
      const fxRes = await fetch(`https://api.fxtwitter.com/status/${detection.videoId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (fxRes.ok) {
        const fxData = await fxRes.json();
        const tweet = fxData?.tweet;
        if (tweet) {
          const videos = tweet.media?.videos || [];
          const photos = tweet.media?.photos || [];
          const allMedia = tweet.media?.all || [];
          const v = videos[0] || allMedia.find((m: {type?: string}) => m.type === 'video' || m.type === 'gif');

          const extractedImages: ExtractedImageItem[] = photos.map(
            (p: {url: string; width?: number; height?: number}, idx: number) => ({
              id: `${tweet.id || 'x'}-photo-${idx + 1}`,
              url: p.url,
              label: `Ảnh gốc X/Twitter #${idx + 1} (${p.width || 1080}×${p.height || 1080})`,
              width: p.width || 1080,
              height: p.height || 1080,
              format: 'JPG' as const,
            }),
          );

          if (v?.thumbnail_url && extractedImages.length === 0) {
            extractedImages.push({
              id: `${tweet.id || 'x'}-thumb`,
              url: v.thumbnail_url,
              label: 'Ảnh bìa gốc X/Twitter (HD)',
              width: v.width || 1280,
              height: v.height || 720,
              format: 'JPG',
            });
          }

          if (v && v.url) {
            const variants: Array<{bitrate?: number; url: string}> = Array.isArray(v.variants)
              ? v.variants.filter((x: {url?: string}) => x.url && x.url.includes('.mp4'))
              : [{url: v.url}];
            variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

            const bestUrl = variants[0]?.url || v.url;
            const midUrl = variants[Math.min(1, variants.length - 1)]?.url || bestUrl;
            const lowUrl = variants[variants.length - 1]?.url || bestUrl;

            const qualities: QualityOption[] = [
              {...STANDARD_QUALITIES[2], directStreamUrl: bestUrl},
              {...STANDARD_QUALITIES[3], directStreamUrl: midUrl},
              {...STANDARD_QUALITIES[4], directStreamUrl: lowUrl},
            ];

            return resolveVideoFromDetection(rawInput, detection, {
              title: tweet.text || `Video trên X (@${tweet.author?.screen_name || 'x'})`,
              author_name: tweet.author?.name || 'X Creator',
              author_handle: tweet.author?.screen_name ? `@${tweet.author.screen_name}` : '@x',
              thumbnailUrl: v.thumbnail_url || tweet.author?.avatar_url,
              durationSec: Math.max(1, Math.round(Number(v.duration) || 30)),
              viewCount: Number(tweet.views) || 0,
              likeCount: Number(tweet.likes) || 0,
              videoStreamUrl: bestUrl,
              hdStreamUrl: bestUrl,
              audioStreamUrl: bestUrl,
              images: extractedImages,
              qualities,
              resolveTimeMs: Date.now() - startMs,
              resolvedVia: 'fxtwitter-live',
            });
          } else if (extractedImages.length > 0) {
            return resolveVideoFromDetection(rawInput, detection, {
              title: tweet.text || `Bài đăng ảnh trên X (@${tweet.author?.screen_name || 'x'})`,
              author_name: tweet.author?.name || 'X Creator',
              author_handle: tweet.author?.screen_name ? `@${tweet.author.screen_name}` : '@x',
              thumbnailUrl: extractedImages[0].url,
              viewCount: Number(tweet.views) || 0,
              likeCount: Number(tweet.likes) || 0,
              images: extractedImages,
              contentTypeOverride: 'Photo',
              resolveTimeMs: Date.now() - startMs,
              resolvedVia: 'fxtwitter-live',
            });
          }
        }
      }
    } catch {
      // Fall through
    }
  }

  // 3. Dailymotion Public API
  if (platformId === 'dailymotion' && detection.videoId) {
    try {
      const dmRes = await fetch(
        `https://api.dailymotion.com/video/${detection.videoId}?fields=id,title,duration,views_total,Likes_total,thumbnail_1080_url,thumbnail_720_url,owner.screenname,owner.username,url`,
        {signal: AbortSignal.timeout(4500)},
      );
      let directMp4Url = '';
      try {
        const metaRes = await fetch(
          `https://www.dailymotion.com/player/metadata/video/${detection.videoId}`,
          {signal: AbortSignal.timeout(4500)},
        );
        if (metaRes.ok) {
          const metaJson = await metaRes.json();
          const autoQualities = metaJson?.qualities?.auto || [];
          const mp4Qualities =
            metaJson?.qualities?.['1080'] ||
            metaJson?.qualities?.['720'] ||
            metaJson?.qualities?.['480'] ||
            [];
          const foundMp4 = [...mp4Qualities, ...autoQualities].find(
            (q: {type?: string; url?: string}) => q.type?.includes('mp4') && q.url,
          );
          if (foundMp4?.url) {
            directMp4Url = foundMp4.url;
          }
        }
      } catch {
        // Ignore
      }

      if (dmRes.ok) {
        const dm = await dmRes.json();
        const thumb = dm.thumbnail_1080_url || dm.thumbnail_720_url;
        return resolveVideoFromDetection(rawInput, detection, {
          title: dm.title,
          author_name: dm['owner.screenname'] || 'Dailymotion Creator',
          author_handle: dm['owner.username'] ? `@${dm['owner.username']}` : '@dailymotion',
          thumbnailUrl: thumb,
          durationSec: Number(dm.duration) || 60,
          viewCount: Number(dm.views_total) || 0,
          likeCount: Number(dm.likes_total) || 0,
          videoStreamUrl: directMp4Url || undefined,
          hdStreamUrl: directMp4Url || undefined,
          images: thumb
            ? [
                {
                  id: `${detection.videoId}-dm-thumb`,
                  url: thumb,
                  label: 'Ảnh bìa gốc Dailymotion (1080p Full HD)',
                  width: 1920,
                  height: 1080,
                  format: 'JPG',
                },
              ]
            : [],
          resolveTimeMs: Date.now() - startMs,
          resolvedVia: 'dailymotion-live',
        });
      }
    } catch {
      // Fall through
    }
  }

  // 4. Universal oEmbed Metadata + High-Res Images (YouTube, Vimeo, SoundCloud, Reddit, etc.)
  try {
    const noembedRes = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(targetUrl)}`,
      {signal: AbortSignal.timeout(4000)},
    );
    if (noembedRes.ok) {
      const oembed = await noembedRes.json();
      if (oembed && !oembed.error && (oembed.title || oembed.author_name || oembed.thumbnail_url)) {
        const extraImages: ExtractedImageItem[] = [];
        if (platformId === 'youtube' && detection.videoId) {
          extraImages.push(
            {
              id: `${detection.videoId}-yt-maxres`,
              url: `https://i.ytimg.com/vi/${detection.videoId}/maxresdefault.jpg`,
              label: 'Ảnh bìa gốc YouTube MaxRes (1920×1080 Full HD)',
              width: 1920,
              height: 1080,
              format: 'JPG',
            },
            {
              id: `${detection.videoId}-yt-hq`,
              url: `https://i.ytimg.com/vi/${detection.videoId}/hqdefault.jpg`,
              label: 'Ảnh bìa YouTube HQ (480×360)',
              width: 480,
              height: 360,
              format: 'JPG',
            },
          );
        } else if (oembed.thumbnail_url) {
          extraImages.push({
            id: `${detection.videoId || 'media'}-oembed-thumb`,
            url: oembed.thumbnail_url,
            label: `Ảnh gốc / Ảnh bìa ${detection.platform?.name || 'Media'}`,
            width: 1280,
            height: 720,
            format: 'JPG',
          });
        }

        return resolveVideoFromDetection(rawInput, detection, {
          title: oembed.title,
          author_name: oembed.author_name,
          thumbnailUrl: extraImages[0]?.url || oembed.thumbnail_url,
          images: extraImages,
          resolveTimeMs: Date.now() - startMs,
          resolvedVia: 'oembed-live',
        });
      }
    }
  } catch {
    // Fall through
  }

  return resolveVideoFromDetection(rawInput, detection, {
    resolveTimeMs: Date.now() - startMs,
    resolvedVia: 'direct-metadata',
  });
}

/**
 * Server-side live video search across TikTok (TikWM) and Dailymotion.
 */
async function searchVideosServerSide(
  rawQuery: string,
  platformFilter: PlatformId | 'all' = 'all',
): Promise<ResolvedVideo[]> {
  const q = rawQuery.trim();
  if (!q) return [];

  const maybeDetection = detectSocialPlatform(q);
  if (maybeDetection.isUrl) {
    const single = await extractPlatformStreamsServerSide(q);
    return [single];
  }

  const results: ResolvedVideo[] = [];
  const tasks: Array<Promise<void>> = [];

  if (platformFilter === 'all' || platformFilter === 'tiktok' || platformFilter === 'douyin') {
    tasks.push(
      (async () => {
        try {
          const res = await fetch(
            `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(q)}&count=8`,
            {signal: AbortSignal.timeout(5500)},
          );
          if (!res.ok) return;
          const json = await res.json();
          const videos = json?.data?.videos;
          if (!Array.isArray(videos)) return;

          for (const v of videos) {
            const vidId = String(v.video_id || v.id || '');
            const authorId = v.author?.unique_id || 'tiktok';
            const canonicalUrl = `https://www.tiktok.com/@${authorId}/video/${vidId}`;
            const det = detectSocialPlatform(canonicalUrl);
            const hdUrl = v.hdplay || v.play;
            const playUrl = v.play || v.hdplay;
            const coverImg = v.origin_cover || v.cover;

            results.push(
              resolveVideoFromDetection(canonicalUrl, det, {
                title: v.title || `Video TikTok #${vidId}`,
                author_name: v.author?.nickname || authorId,
                author_handle: `@${authorId}`,
                thumbnailUrl: coverImg,
                durationSec: Number(v.duration) || 30,
                viewCount: Number(v.play_count) || 0,
                likeCount: Number(v.digg_count) || 0,
                videoStreamUrl: playUrl,
                hdStreamUrl: hdUrl,
                audioStreamUrl: v.music || v.music_info?.play,
                images: coverImg
                  ? [
                      {
                        id: `${vidId}-cover`,
                        url: coverImg,
                        label: 'Ảnh bìa gốc TikTok',
                        width: 1080,
                        height: 1920,
                        format: 'JPG',
                      },
                    ]
                  : [],
                qualities: [
                  {...STANDARD_QUALITIES[2], directStreamUrl: hdUrl},
                  {...STANDARD_QUALITIES[3], directStreamUrl: playUrl},
                  {...STANDARD_QUALITIES[4], directStreamUrl: v.wmplay || playUrl},
                ],
                resolvedVia: 'tikwm-live',
              }),
            );
          }
        } catch {
          // Ignore
        }
      })(),
    );
  }

  if (platformFilter === 'all' || platformFilter === 'dailymotion' || platformFilter === 'youtube') {
    tasks.push(
      (async () => {
        try {
          const res = await fetch(
            `https://api.dailymotion.com/videos?search=${encodeURIComponent(
              q,
            )}&fields=id,title,duration,views_total,likes_total,thumbnail_720_url,owner.screenname,owner.username,url&limit=6`,
            {signal: AbortSignal.timeout(5000)},
          );
          if (!res.ok) return;
          const json = await res.json();
          const list = json?.list;
          if (!Array.isArray(list)) return;

          for (const item of list) {
            const url = item.url || `https://www.dailymotion.com/video/${item.id}`;
            const det = detectSocialPlatform(url);
            results.push(
              resolveVideoFromDetection(url, det, {
                title: item.title,
                author_name: item['owner.screenname'] || 'Dailymotion',
                author_handle: item['owner.username']
                  ? `@${item['owner.username']}`
                  : '@dailymotion',
                thumbnailUrl: item.thumbnail_720_url,
                durationSec: Number(item.duration) || 60,
                viewCount: Number(item.views_total) || 0,
                likeCount: Number(item.likes_total) || 0,
                images: item.thumbnail_720_url
                  ? [
                      {
                        id: `${item.id}-thumb`,
                        url: item.thumbnail_720_url,
                        label: 'Ảnh bìa Dailymotion HD',
                        width: 1280,
                        height: 720,
                        format: 'JPG',
                      },
                    ]
                  : [],
                resolvedVia: 'dailymotion-live',
              }),
            );
          }
        } catch {
          // Ignore
        }
      })(),
    );
  }

  await Promise.allSettled(tasks);
  return results;
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
      html.match(
        /<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
      ) ||
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']/i,
      );
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

async function extractViaYtDlp(targetUrl: string, timeoutMs = 7000): Promise<YtDlpInfo | null> {
  const ready = await ensureYtDlpBinary();
  if (!ready) return null;

  try {
    const {stdout} = await execFileAsync(
      YT_DLP_PATH,
      [
        '--js-runtimes',
        'node',
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

async function handleResolveRequest(rawInput: string): Promise<{
  detection: DetectionResult;
  video: ResolvedVideo;
}> {
  const startMs = Date.now();

  const cached = RESOLVE_CACHE.get(rawInput);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      detection: cached.detection,
      video: {
        ...cached.video,
        resolveTimeMs: Math.max(1, Date.now() - startMs),
      },
    };
  }

  let effectiveUrl = rawInput;
  const initialDetection = detectSocialPlatform(rawInput);
  if (initialDetection.isUrl) {
    const redirectedUrl = await resolveRedirectFast(initialDetection.normalizedUrl || rawInput);
    if (redirectedUrl && redirectedUrl !== rawInput) {
      effectiveUrl = redirectedUrl;
    }
  }

  const detection = detectSocialPlatform(effectiveUrl);

  // Step 2: Dedicated Meta Engine (Facebook, Instagram, Threads) + optional yt-dlp fallback for Instagram Reels
  if (detection.isMetaPlatform) {
    const metaResult = await extractMetaFast(detection.normalizedUrl || effectiveUrl, detection);
    let hdStream = metaResult?.hdStreamUrl || metaResult?.sdStreamUrl;
    let sdStream = metaResult?.sdStreamUrl || metaResult?.hdStreamUrl;
    let audioStream: string | undefined;

    // If Meta HTML didn't expose a direct MP4 stream (e.g. some IG Reels), also probe yt-dlp briefly
    if (!hdStream && !metaResult?.isPhotoOnly) {
      const ytdlpMeta = await extractViaYtDlp(detection.normalizedUrl || effectiveUrl, 5000);
      if (ytdlpMeta) {
        const mp4Formats = (ytdlpMeta.formats || [])
          .filter((f) => f.url && !f.url.includes('.m3u8') && f.ext === 'mp4')
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        hdStream = mp4Formats[0]?.url || ytdlpMeta.url;
        sdStream = mp4Formats[mp4Formats.length - 1]?.url || hdStream;
      }
    }

    const video = resolveVideoFromDetection(effectiveUrl, detection, {
      title: metaResult?.title,
      author_name: metaResult?.authorName,
      author_handle: metaResult?.authorHandle,
      thumbnailUrl: metaResult?.thumbnailUrl,
      videoStreamUrl: sdStream || hdStream,
      hdStreamUrl: hdStream || sdStream,
      audioStreamUrl: audioStream,
      images: metaResult?.images || [],
      contentTypeOverride: metaResult?.isPhotoOnly ? 'Photo' : undefined,
      resolveTimeMs: Date.now() - startMs,
      resolvedVia: 'meta-fast-engine',
    });

    RESOLVE_CACHE.set(rawInput, {timestamp: Date.now(), detection, video});
    return {detection, video};
  }

  // Step 3: Server-side platform extractors (TikWM, FxTwitter, Dailymotion, Noembed)
  const fastResolved = await extractPlatformStreamsServerSide(effectiveUrl);
  if (
    fastResolved.videoStreamUrl ||
    (fastResolved.contentType === 'Photo' && fastResolved.images.length > 0)
  ) {
    const video: ResolvedVideo = {
      ...fastResolved,
      resolveTimeMs: Date.now() - startMs,
    };
    RESOLVE_CACHE.set(rawInput, {timestamp: Date.now(), detection, video});
    return {detection, video};
  }

  // Step 4: Race Universal OpenGraph + yt-dlp for YouTube, Reddit, Pinterest, Vimeo, Bilibili, etc.
  if (detection.isUrl) {
    const [ogResult, ytdlpInfo] = await Promise.all([
      extractUniversalOpenGraphFast(detection.normalizedUrl || effectiveUrl, detection),
      extractViaYtDlp(detection.normalizedUrl || effectiveUrl, 6500),
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
      return {detection, video};
    }

    if (ogResult && (ogResult.images.length > 0 || ogResult.videoStreamUrl || ogResult.title)) {
      const mergedImages = ogResult.images.length > 0 ? ogResult.images : fastResolved.images;
      const video = resolveVideoFromDetection(effectiveUrl, detection, {
        title: ogResult.title || fastResolved.title,
        author_name: fastResolved.authorName,
        author_handle: fastResolved.authorHandle,
        thumbnailUrl: ogResult.thumbnailUrl || fastResolved.thumbnailUrl,
        videoStreamUrl: ogResult.videoStreamUrl || fastResolved.videoStreamUrl,
        hdStreamUrl: ogResult.videoStreamUrl || fastResolved.hdStreamUrl,
        images: mergedImages,
        contentTypeOverride:
          !ogResult.videoStreamUrl &&
          mergedImages.length > 0 &&
          detection.platform?.id !== 'youtube'
            ? 'Photo'
            : undefined,
        resolveTimeMs: Date.now() - startMs,
        resolvedVia: detection.isMetaPlatform ? 'meta-fast-engine' : 'oembed-live',
      });

      RESOLVE_CACHE.set(rawInput, {timestamp: Date.now(), detection, video});
      return {detection, video};
    }
  }

  const finalVideo: ResolvedVideo = {
    ...fastResolved,
    resolveTimeMs: Date.now() - startMs,
  };
  return {detection, video: finalVideo};
}

async function startServer() {
  setTimeout(() => {
    void ensureYtDlpBinary();
  }, 3000);

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Enable full CORS for thichlendo.site, GitHub Pages, Render, and local development
  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (
      requestOrigin &&
      (requestOrigin.includes('thichlendo.site') ||
        requestOrigin.includes('github.io') ||
        requestOrigin.includes('onrender.com') ||
        requestOrigin.includes('localhost'))
    ) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Range, Authorization',
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, Content-Length, Content-Range, Accept-Ranges',
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({limit: '10mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok', backend: 'OmniDown Render Node Engine'});
  });

  // 1. Ultra-Fast Video & Photo Resolver Endpoint (Supports both POST and GET)
  app.post('/api/resolve', async (req, res) => {
    const rawInput =
      typeof req.body?.input === 'string'
        ? req.body.input.trim()
        : typeof req.body?.url === 'string'
          ? req.body.url.trim()
          : '';
    if (!rawInput) {
      res.status(400).json({error: 'Vui lòng dán đường dẫn (URL) video hoặc ảnh mạng xã hội.'});
      return;
    }
    try {
      const payload = await handleResolveRequest(rawInput);
      res.json(payload);
    } catch {
      res.status(500).json({error: 'Không thể phân tích đường dẫn phương tiện.'});
    }
  });

  app.get('/api/resolve', async (req, res) => {
    const rawInput =
      typeof req.query.url === 'string'
        ? req.query.url.trim()
        : typeof req.query.input === 'string'
          ? req.query.input.trim()
          : '';
    if (!rawInput) {
      res.status(400).json({error: 'Vui lòng cung cấp tham số url hoặc input.'});
      return;
    }
    try {
      const payload = await handleResolveRequest(rawInput);
      res.json(payload);
    } catch {
      res.status(500).json({error: 'Không thể phân tích đường dẫn phương tiện.'});
    }
  });

  // 2. Live Video Search Endpoint
  app.get('/api/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const platform =
      typeof req.query.platform === 'string' ? (req.query.platform as PlatformId | 'all') : 'all';
    const results = await searchVideosServerSide(q, platform);
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
      // If streamUrl wasn't passed, resolve it on the fly on the server
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
          const resolved = await extractPlatformStreamsServerSide(originalUrl);
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

      // Step B: If direct fetch didn't get it and originalUrl is provided, try yt-dlp download with --js-runtimes node
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
                '--js-runtimes',
                'node',
                '-f',
                formatSelector,
                '--no-playlist',
                '--no-warnings',
                '--no-check-certificates',
                '--geo-bypass',
                '--merge-output-format',
                'mp4',
                '-o',
                rawTmpFile,
                originalUrl,
              ],
              {timeout: 24000},
            );
            if (fs.existsSync(rawTmpFile) && fs.statSync(rawTmpFile).size > 1024) {
              downloadedRaw = true;
            }
          } catch {
            downloadedRaw = false;
          }
        }
      }

      // Step C: Process with FFmpeg according to audioMode
      if (downloadedRaw && fs.existsSync(rawTmpFile)) {
        if (audioMode === 'image_only') {
          await execFileAsync(
            'ffmpeg',
            ['-y', '-i', rawTmpFile, '-frames:v', '1', '-q:v', '2', outTmpFile],
            {timeout: 12000},
          );
        } else if (audioMode === 'muted_video') {
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
    const vitePromise = createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
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
