import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSocialPlatform,
  calculateStreamSizeBytes,
  buildDownloadFilename,
  resolveVideoFromDetection,
} from './socialDetector';

test('detectSocialPlatform identifies TikTok, YouTube Shorts, Instagram Reels, Facebook Watch, X, Douyin, and Bilibili accurately', () => {
  const tt = detectSocialPlatform('https://www.tiktok.com/@tiktok/video/7106594312292453675?is_from_webapp=1');
  assert.equal(tt.detected, true);
  assert.equal(tt.platform?.id, 'tiktok');
  assert.equal(tt.videoId, '7106594312292453675');
  assert.equal(tt.creatorHint, '@tiktok');

  const ytShort = detectSocialPlatform('https://www.youtube.com/shorts/9bZkp7q19f0');
  assert.equal(ytShort.detected, true);
  assert.equal(ytShort.platform?.id, 'youtube');
  assert.equal(ytShort.contentType, 'Shorts');
  assert.equal(ytShort.videoId, '9bZkp7q19f0');

  const igReel = detectSocialPlatform('https://www.instagram.com/reel/C9xK8m2vLpQ/');
  assert.equal(igReel.detected, true);
  assert.equal(igReel.platform?.id, 'instagram');
  assert.equal(igReel.contentType, 'Reel');
  assert.equal(igReel.videoId, 'C9xK8m2vLpQ');

  const fbWatch = detectSocialPlatform('https://www.facebook.com/watch/?v=1094827561928374');
  assert.equal(fbWatch.detected, true);
  assert.equal(fbWatch.platform?.id, 'facebook');
  assert.equal(fbWatch.videoId, '1094827561928374');

  const xStatus = detectSocialPlatform('https://x.com/NASA/status/1829104857291048572');
  assert.equal(xStatus.detected, true);
  assert.equal(xStatus.platform?.id, 'twitter');
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

test('calculateStreamSizeBytes differentiates with_audio, muted_video, and audio_only accurately', () => {
  const duration = 60;
  const withAudio = calculateStreamSizeBytes(duration, '1080p', 'with_audio');
  const mutedVideo = calculateStreamSizeBytes(duration, '1080p', 'muted_video');
  const audioOnly = calculateStreamSizeBytes(duration, '1080p', 'audio_only');

  assert.ok(withAudio > mutedVideo, 'with_audio must be larger than muted_video');
  assert.ok(mutedVideo > audioOnly, '1080p video without audio must be larger than audio_only');
  assert.equal(withAudio - mutedVideo, audioOnly, 'difference between muxed and muted equals audio stream size');
});

test('buildDownloadFilename reflects platform, videoId, quality, and audio/muted state', () => {
  const sampleVideo = {
    platformId: 'tiktok' as const,
    videoId: '7106594312292453675',
    title: 'Real TikTok Video',
  };

  assert.equal(
    buildDownloadFilename(sampleVideo, '1080p', 'with_audio'),
    'tiktok_7106594312292453675_1080p_with-audio.mp4',
  );
  assert.equal(
    buildDownloadFilename(sampleVideo, '720p', 'muted_video'),
    'tiktok_7106594312292453675_720p_muted-no-audio.mp4',
  );
  assert.equal(
    buildDownloadFilename(sampleVideo, '1080p', 'audio_only'),
    'tiktok_7106594312292453675_320kbps_audio-only.mp3',
  );
});

test('resolveVideoFromDetection maps real stream URLs and sizes into qualities', () => {
  const url = 'https://www.tiktok.com/@tiktok/video/7106594312292453675';
  const det = detectSocialPlatform(url);
  const resolved = resolveVideoFromDetection(url, det, {
    title: 'Real TikTok Stream',
    hdStreamUrl: 'https://cdn.example.com/hd.mp4',
    videoStreamUrl: 'https://cdn.example.com/sd.mp4',
    audioStreamUrl: 'https://cdn.example.com/audio.mp3',
    hdSizeBytes: 8500000,
    resolvedVia: 'real-stream-api',
  });
  assert.equal(resolved.platformId, 'tiktok');
  assert.equal(resolved.hdStreamUrl, 'https://cdn.example.com/hd.mp4');
  assert.equal(resolved.qualities[0].directStreamUrl, 'https://cdn.example.com/hd.mp4');
});
