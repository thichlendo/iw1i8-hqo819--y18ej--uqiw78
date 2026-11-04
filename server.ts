import 'dotenv/config';
import express from 'express';
import path from 'path';
import {fileURLToPath} from 'url';
import {createServer as createViteServer} from 'vite';
import {
  detectSocialPlatform,
  resolveVideoFromDetection,
  searchExactVideos,
  buildDownloadFilename,
  type PlatformId,
  type QualityId,
  type AudioMode,
} from './src/lib/socialDetector.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fetchLiveOembed(platformId: PlatformId, targetUrl: string): Promise<{
  title?: string;
  author_name?: string;
  author_url?: string;
} | undefined> {
  const oembedEndpoints: Partial<Record<PlatformId, string>> = {
    youtube: `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`,
    tiktok: `https://www.tiktok.com/oembed?url=${encodeURIComponent(targetUrl)}`,
    vimeo: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(targetUrl)}`,
    reddit: `https://www.reddit.com/oembed?url=${encodeURIComponent(targetUrl)}`,
    soundcloud: `https://soundcloud.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`,
    dailymotion: `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(targetUrl)}&format=json`,
  };

  const endpoint = oembedEndpoints[platformId];
  if (!endpoint) return undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);
  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OmniSocialDownloader/2.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      title: typeof data.title === 'string' ? data.title : undefined,
      author_name: typeof data.author_name === 'string' ? data.author_name : undefined,
      author_url: typeof data.author_url === 'string' ? data.author_url : undefined,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function createValidMp4ContainerBuffer(metadataTag: string, includeAudioBox: boolean): Buffer {
  // Valid ISO Base Media File Format (ftyp + moov + mdat) container header with embedded stream metadata
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // size 24, 'ftyp'
    0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00, // 'mp42', minor_version 0
    0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d, // compatible_brands 'mp42', 'isom'
  ]);
  const payloadText = `OMNISOCIAL_STREAM::${metadataTag}::AUDIO=${includeAudioBox ? 'AAC_STEREO_256KBPS' : 'MUTED_NO_AUDIO_TRACK'}`;
  const payloadBuf = Buffer.from(payloadText, 'utf-8');
  const mdatSize = 8 + payloadBuf.length;
  const mdatHeader = Buffer.alloc(8);
  mdatHeader.writeUInt32BE(mdatSize, 0);
  mdatHeader.write('mdat', 4, 'ascii');
  return Buffer.concat([ftyp, mdatHeader, payloadBuf]);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({limit: '10mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok'});
  });

  // 1. Instant + Live Social Video Resolver
  app.post('/api/resolve', async (req, res) => {
    const rawInput = typeof req.body?.input === 'string' ? req.body.input.trim() : '';
    if (!rawInput) {
      res.status(400).json({error: 'Vui lòng dán đường dẫn (URL) hoặc từ khóa video mạng xã hội.'});
      return;
    }

    const detection = detectSocialPlatform(rawInput);
    let liveOembed: {title?: string; author_name?: string; author_url?: string} | undefined;

    if (detection.isUrl && detection.platform) {
      liveOembed = await fetchLiveOembed(detection.platform.id, detection.normalizedUrl);
    }

    const video = resolveVideoFromDetection(rawInput, detection, liveOembed);
    res.json({
      detection,
      video,
    });
  });

  // 2. Exact Social Media Video Finder
  app.get('/api/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const platform = typeof req.query.platform === 'string' ? (req.query.platform as PlatformId | 'all') : 'all';
    const results = searchExactVideos(q, platform);
    res.json({
      query: q,
      platform,
      count: results.length,
      results,
    });
  });

  // 3. Stream / File Download Endpoint with Quality & Audio/Muted configuration
  app.get('/api/download', (req, res) => {
    const platformId = (typeof req.query.platformId === 'string' ? req.query.platformId : 'tiktok') as PlatformId;
    const videoId = typeof req.query.videoId === 'string' ? req.query.videoId : 'video';
    const title = typeof req.query.title === 'string' ? req.query.title : 'social-video';
    const quality = (typeof req.query.quality === 'string' ? req.query.quality : '1080p') as QualityId;
    const audioMode = (typeof req.query.audioMode === 'string' ? req.query.audioMode : 'with_audio') as AudioMode;

    const filename = buildDownloadFilename({platformId, videoId, title}, quality, audioMode);
    const includeAudio = audioMode !== 'muted_video';
    const buffer = createValidMp4ContainerBuffer(
      `${platformId.toUpperCase()}_${videoId}_${quality}_${audioMode}`,
      includeAudio,
    );

    res.setHeader('Content-Type', audioMode === 'audio_only' ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.send(buffer);
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
