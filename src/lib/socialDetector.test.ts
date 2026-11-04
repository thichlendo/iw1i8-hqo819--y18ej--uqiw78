import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSocialPlatform,
  calculateStreamSizeBytes,
  buildDownloadFilename,
  resolveVideoFromDetection,
} from './socialDetector';

test('detectSocialPlatform identifies Meta platforms (Facebook Share/Watch/Photo/Reel, Instagram Reel/Post/Share, Threads net/com) and unwraps l.facebook.com shims', () => {
  const fbShareReel = detectSocialPlatform('https://www.facebook.com/share/r/19xYzAbCdE/?mibextid=WC7FNe');
  assert.equal(fbShareReel.detected, true);
  assert.equal(fbShareReel.platform?.id, 'facebook');
  assert.equal(fbShareReel.contentType, 'Reel');
  assert.equal(fbShareReel.videoId, '19xYzAbCdE');
  assert.equal(fbShareReel.isMetaPlatform, true);

  const fbPhoto = detectSocialPlatform('https://www.facebook.com/photo/?fbid=987654321012345&set=a.12345');
  assert.equal(fbPhoto.detected, true);
  assert.equal(fbPhoto.platform?.id, 'facebook');
  assert.equal(fbPhoto.contentType, 'Photo');
  assert.equal(fbPhoto.videoId, '987654321012345');

  const fbShim = detectSocialPlatform(
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.instagram.com%2Freel%2FC9xK8m2vLpQ%2F%3Figsh%3Dabc&h=AT123',
  );
  assert.equal(fbShim.detected, true);
  assert.equal(fbShim.platform?.id, 'instagram');
  assert.equal(fbShim.contentType, 'Reel');
  assert.equal(fbShim.videoId, 'C9xK8m2vLpQ');
  assert.equal(fbShim.isMetaPlatform, true);

  const igPost = detectSocialPlatform('https://www.instagram.com/p/DB8x9LmN0pQ/?img_index=1');
  assert.equal(igPost.detected, true);
  assert.equal(igPost.platform?.id, 'instagram');
  assert.equal(igPost.contentType, 'Photo');
  assert.equal(igPost.videoId, 'DB8x9LmN0pQ');

  const threadsCom = detectSocialPlatform('https://www.threads.com/@zuck/post/C8mN9pQrStU');
  assert.equal(threadsCom.detected, true);
  assert.equal(threadsCom.platform?.id, 'threads');
  assert.equal(threadsCom.contentType, 'Post');
  assert.equal(threadsCom.videoId, 'C8mN9pQrStU');
  assert.equal(threadsCom.creatorHint, '@zuck');
  assert.equal(threadsCom.isMetaPlatform, true);
});

test('detectSocialPlatform identifies TikTok Video & Photo mode, YouTube Shorts, X, Douyin, and Bilibili accurately', () => {
  const tt = detectSocialPlatform('https://www.tiktok.com/@tiktok/video/7106594312292453675?is_from_webapp=1');
  assert.equal(tt.detected, true);
  assert.equal(tt.platform?.id, 'tiktok');
  assert.equal(tt.videoId, '7106594312292453675');
  assert.equal(tt.contentType, 'Video');
  assert.equal(tt.creatorHint, '@tiktok');

  const ttPhoto = detectSocialPlatform('https://www.tiktok.com/@creator/photo/7391827364519283746');
  assert.equal(ttPhoto.detected, true);
  assert.equal(ttPhoto.platform?.id, 'tiktok');
  assert.equal(ttPhoto.contentType, 'Photo');
  assert.equal(ttPhoto.videoId, '7391827364519283746');

  const ytShort = detectSocialPlatform('https://www.youtube.com/shorts/9bZkp7q19f0');
  assert.equal(ytShort.detected, true);
  assert.equal(ytShort.platform?.id, 'youtube');
  assert.equal(ytShort.contentType, 'Shorts');
  assert.equal(ytShort.videoId, '9bZkp7q19f0');

  const xStatus = detectSocialPlatform('https://x.com/NASA/status/1829104857291048572/photo/1');
  assert.equal(xStatus.detected, true);
  assert.equal(xStatus.platform?.id, 'twitter');
  assert.equal(xStatus.contentType, 'Photo');
  assert.equal(xStatus.videoId, '1829104857291048572');
  assert.equal(xStatus.creatorHint, '@NASA');

  const douyin = detectSocialPlatform('https://www.douyin.com/video/7381920495817264395');
  assert.equal(douyin.detected, true);
  assert.equal(douyin.platform?.id, 'douyin');
  assert.equal(douyin.videoId, '7381920495817264395');

  const bilibili = detectSocialPlatform('https://www.bilibili.com/video/BV1GJ411x7h7');
  assert.equal(bilibili.detected, true);
  assert.equal(bilibili.platform?.id, 'bilibili');
  assert.equal(bilibili.videoId, 'BV1GJ411x7h7');
});

test('calculateStreamSizeBytes differentiates with_audio, muted_video, audio_only, and image_only accurately', () => {
  const duration = 60;
  const withAudio = calculateStreamSizeBytes(duration, '1080p', 'with_audio');
  const mutedVideo = calculateStreamSizeBytes(duration, '1080p', 'muted_video');
  const audioOnly = calculateStreamSizeBytes(duration, '1080p', 'audio_only');
  const imageOnly = calculateStreamSizeBytes(duration, '1080p', 'image_only');

  assert.ok(withAudio > mutedVideo, 'with_audio must be larger than muted_video');
  assert.ok(mutedVideo > audioOnly, '1080p video without audio must be larger than audio_only');
  assert.equal(withAudio - mutedVideo, audioOnly, 'difference between muxed and muted equals audio stream size');
  assert.ok(imageOnly > 100000, 'image_only returns realistic high-res photo byte estimate');
});

test('buildDownloadFilename reflects platform, videoId, quality, and audio/muted/image state', () => {
  const sampleVideo = {
    platformId: 'instagram' as const,
    videoId: 'C9xK8m2vLpQ',
    title: 'Real Instagram Reel',
  };

  assert.equal(
    buildDownloadFilename(sampleVideo, '1080p', 'with_audio'),
    'instagram_C9xK8m2vLpQ_1080p_with-audio.mp4',
  );
  assert.equal(
    buildDownloadFilename(sampleVideo, '720p', 'muted_video'),
    'instagram_C9xK8m2vLpQ_720p_muted-no-audio.mp4',
  );
  assert.equal(
    buildDownloadFilename(sampleVideo, '1080p', 'audio_only'),
    'instagram_C9xK8m2vLpQ_320kbps_audio-only.mp3',
  );
  assert.equal(
    buildDownloadFilename(sampleVideo, '1080p', 'image_only'),
    'instagram_C9xK8m2vLpQ_original-photo.jpg',
  );
  assert.equal(
    buildDownloadFilename(sampleVideo, '1080p', 'image_only', 1),
    'instagram_C9xK8m2vLpQ_img2.jpg',
  );
});

test('resolveVideoFromDetection maps real stream URLs, sizes, and extracted images into ResolvedVideo', () => {
  const url = 'https://www.instagram.com/p/C9xK8m2vLpQ/';
  const det = detectSocialPlatform(url);
  const resolved = resolveVideoFromDetection(url, det, {
    title: 'Instagram Carousel Post',
    hdStreamUrl: 'https://cdn.example.com/hd.mp4',
    videoStreamUrl: 'https://cdn.example.com/sd.mp4',
    images: [
      {id: 'img-1', url: 'https://cdn.example.com/photo1.jpg', label: 'Ảnh #1', format: 'JPG'},
      {id: 'img-2', url: 'https://cdn.example.com/photo2.jpg', label: 'Ảnh #2', format: 'JPG'},
    ],
    hdSizeBytes: 8500000,
    resolvedVia: 'meta-fast-engine',
  });
  assert.equal(resolved.platformId, 'instagram');
  assert.equal(resolved.hdStreamUrl, 'https://cdn.example.com/hd.mp4');
  assert.equal(resolved.images.length, 2);
  assert.equal(resolved.images[0].url, 'https://cdn.example.com/photo1.jpg');
});
