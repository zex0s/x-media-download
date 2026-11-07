// ==UserScript==
// @name         X Media Download
// @description  Adds a hover download button to images and videos on X/Twitter. Full-size images, highest-bitrate videos. Media-download part of "X Reading Position & Media Download" by Copiis.
// @namespace    https://github.com/zex0s/x-media-download
// @version      1.1.0
// @author       zex0s (original: Copiis)
// @license      MIT
// @icon         https://x.com/favicon.ico
// @match        https://x.com/*
// @connect      x.com
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      ton.twimg.com
// @connect      cdn.syndication.twimg.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @downloadURL  https://raw.githubusercontent.com/zex0s/x-media-download/main/x-media-download.user.js
// @updateURL    https://raw.githubusercontent.com/zex0s/x-media-download/main/x-media-download.user.js
// ==/UserScript==

// Extracted from "X Reading Position & Media Download" by Copiis (MIT)
// https://greasyfork.org/scripts/517767 — reading-position features removed.

(function () {
    'use strict';

    const MESSAGES = {
        noMedia: '❌ No media found for this post.',
        failed: '❌ Media download failed.',
        inProgress: 'Downloading media…'
    };

    function showPopup(key, duration = 5000, params = {}) {
        if (!document.body) return;
        let message = MESSAGES[key] || key;
        for (const p of Object.keys(params)) message = message.replace(`{${p}}`, params[p]);
        const popup = document.createElement('div');
        Object.assign(popup.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            color: '#ffffff',
            padding: '10px 20px',
            borderRadius: '8px',
            fontSize: '14px',
            fontFamily: 'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            boxShadow: '0 0 10px rgba(29, 155, 240, 0.8)',
            zIndex: '10000',
            maxWidth: '500px',
            whiteSpace: 'pre-wrap',
            transition: 'opacity 1s ease',
            opacity: '1'
        });
        popup.textContent = message;
        document.body.appendChild(popup);
        setTimeout(() => {
            popup.style.opacity = '0';
            setTimeout(() => popup.remove(), 1200);
        }, duration);
    }

    const MEDIA_DOWNLOAD_STYLE_ID = 'xts-media-download-style';
    const TWEET_RESULT_BY_REST_ID_QUERY = 'zAz9764BcLZOJ0JU2wrd1A';
    // Public web-client bearer token used by x.com itself.
    const TWITTER_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
    const mediaApiCache = new Map();
    let scheduleScan = null;

    function getCookieValue(name) {
        const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : '';
    }

    function injectMediaDownloadStyles() {
        if (document.getElementById(MEDIA_DOWNLOAD_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = MEDIA_DOWNLOAD_STYLE_ID;
        style.textContent = `
            .xts-media-download-btn {
                position: absolute;
                top: 8px;
                left: 8px;
                width: 34px;
                height: 34px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.35);
                background: rgba(15, 20, 25, 0.82);
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                z-index: 100;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease;
                backdrop-filter: blur(4px);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
            }
            .xts-media-download-btn svg {
                width: 18px;
                height: 18px;
                stroke: currentColor;
                fill: none;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            article:hover .xts-media-download-btn,
            article[role="article"]:hover .xts-media-download-btn,
            li[role="listitem"]:hover .xts-media-download-btn,
            .xts-media-download-host:hover .xts-media-download-btn,
            a[href*="/photo/"]:hover .xts-media-download-btn,
            a[href*="/video/"]:hover .xts-media-download-btn,
            [data-testid="videoComponent"]:hover .xts-media-download-btn,
            .xts-media-download-btn:hover,
            .xts-media-download-btn.xts-media-downloading {
                opacity: 1;
                pointer-events: auto;
            }
            .xts-media-download-btn:hover {
                background: rgba(29, 155, 240, 0.85);
                transform: scale(1.06);
            }
            .xts-media-download-btn.xts-media-downloading {
                cursor: wait;
                background: rgba(29, 155, 240, 0.55);
            }
        `.trim();
        document.head.appendChild(style);
    }

    function createMediaDownloadButton(isVideo = false) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'xts-media-download-btn';
        btn.dataset.isVideo = isVideo ? '1' : '0';
        btn.title = isVideo ? 'Download video' : 'Download image';
        btn.setAttribute('aria-label', btn.title);
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4v11"></path><path d="M7 10l5 5 5-5"></path><path d="M5 20h14"></path></svg>';
        return btn;
    }

    function parseStatusHref(href) {
        const idMatch = href.match(/\/status\/(\d+)/);
        if (!idMatch) return null;
        const authorMatch = href.match(/^\/([^/]+)\/status\//) || href.match(/(?:twitter|x)\.com\/([^/]+)\/status\//);
        return { tweetId: idMatch[1], author: authorMatch ? authorMatch[1] : null };
    }

    function getTweetContextFromMediaElement(innerElem) {
        const statusLink = innerElem.closest('a[href*="/status/"]');
        const fromLink = statusLink && parseStatusHref(statusLink.getAttribute('href') || '');
        if (fromLink) return fromLink;

        // Video posts have no status link around the media: use the post's own timestamp link.
        const article = innerElem.closest('article');
        const timeLink = article?.querySelector('time')?.closest('a[href*="/status/"]');
        const fromTime = timeLink && parseStatusHref(timeLink.getAttribute('href') || '');
        if (fromTime) return fromTime;

        const pathMatch = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
        return pathMatch ? { author: pathMatch[1], tweetId: pathMatch[2] } : null;
    }

    function isVideoPosterImage(img) {
        const src = img.src || '';
        return src.includes('ext_tw_video_thumb')
            || src.includes('amplify_video_thumb')
            || src.includes('tweet_video_thumb');
    }

    function shouldSkipMediaImage(img) {
        if (!img || img.dataset.xtsMediaHandled === '1') return true;
        if (!img.src || img.src.endsWith('.svg')) return true;
        if (img.closest('[data-testid="Tweet-User-Avatar"]')) return true;
        if (img.src.includes('/profile_banners/')) return true;
        if (img.src.includes('/emoji/')) return true;
        if (img.closest('[data-testid="UserAvatar"]')) return true;
        if (img.src.includes('profile_images')) return true;
        if ((img.width || 0) > 0 && img.width < 140) return true;
        return false;
    }

    function isTweetMediaImage(img) {
        const src = img?.src || '';
        if (!src.includes('pbs.twimg.com/media/')) return false;
        if (isVideoPosterImage(img)) return false;
        return Boolean(img.closest('[data-testid="tweetPhoto"]') || img.closest('a[href*="/photo/"]'));
    }

    function getVideoDownloadHost(video) {
        return video.closest('a[href*="/video/"]')
            || video.closest('a[href*="/photo/"]')
            || video.closest('[data-testid="videoComponent"]')?.parentElement
            || null;
    }

    function scheduleImageDownloadRetry(img) {
        if (!img || img.dataset.xtsMediaPending === '1') return;
        img.dataset.xtsMediaPending = '1';
        const finalize = () => {
            delete img.dataset.xtsMediaPending;
            if (scheduleScan) scheduleScan();
        };
        if (img.complete) {
            setTimeout(finalize, 120);
            return;
        }
        img.addEventListener('load', finalize, { once: true });
        img.addEventListener('error', () => {
            img.dataset.xtsMediaHandled = '1';
            delete img.dataset.xtsMediaPending;
        }, { once: true });
    }

    function getImageDownloadUrlCandidates(url) {
        const urlObj = new URL(url);
        const originals = ['orig', '4096x4096'];
        const samples = ['large', '900x900', 'medium', 'small'];
        const candidates = [];

        const withName = (name) => {
            const copy = new URL(urlObj.toString());
            copy.searchParams.set('name', name);
            if (copy.searchParams.get('format') === 'webp') copy.searchParams.set('format', 'jpg');
            return copy.toString();
        };

        for (const name of originals) candidates.push(withName(name));

        const previewSize = urlObj.searchParams.get('name');
        if (previewSize && !originals.includes(previewSize) && !samples.includes(previewSize)) {
            samples.unshift(previewSize);
        }
        for (const name of samples) candidates.push(withName(name));

        if (!urlObj.searchParams.has('name') && url.includes('pbs.twimg.com/media/')) {
            const parts = url.split('.');
            const ext = parts.pop();
            candidates.unshift(`${parts.join('.')}?format=${ext}&name=orig`);
        }

        return [...new Set(candidates)];
    }

    const MEDIA_HOSTS = new Set(['pbs.twimg.com', 'video.twimg.com', 'ton.twimg.com']);

    function isAllowedMediaUrl(url) {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:') return false;
            if (parsed.username || parsed.password) return false;
            return MEDIA_HOSTS.has(parsed.hostname);
        } catch (e) {
            return false;
        }
    }

    function extensionFromMime(mimeType, pathname = '') {
        const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
        let ext = '';
        if (mime === 'image/jpeg' || mime === 'image/jpg') ext = 'jpg';
        else if (mime === 'image/png') ext = 'png';
        else if (mime === 'image/webp') ext = 'webp';
        else if (mime === 'image/gif') ext = 'gif';
        else if (mime === 'video/mp4') ext = 'mp4';
        else if (!mime || mime === 'application/octet-stream') {
            const pathExt = String(pathname.split('.').pop() || '').toLowerCase();
            ext = pathExt === 'jpeg' ? 'jpg' : pathExt;
        }
        return ['jpg', 'png', 'webp', 'gif', 'mp4'].includes(ext) ? ext : null;
    }

    function sanitizeMediaToken(value, fallback, maxLen) {
        let text = String(value ?? '');
        text = text.replace(/[\u0000-\u001F\u007F]/g, '');
        text = text.replace(/\.\./g, '');
        text = text.replace(/[^A-Za-z0-9._-]+/g, '');
        text = text.replace(/^\.+/, '');
        if (!text) text = fallback;
        if (text.length > maxLen) text = text.slice(0, maxLen);
        return text || fallback;
    }

    function buildMediaFilename({ author, tweetId, baseName, extension, isSample = false }) {
        if (!['jpg', 'png', 'webp', 'gif', 'mp4'].includes(extension)) throw new Error('Media type not allowed');
        const datePart = new Date().toISOString().slice(0, 10);
        const samplePrefix = isSample ? 'sample_' : '';
        const safeAuthor = sanitizeMediaToken(author, 'unknown', 15);
        const safeTweet = sanitizeMediaToken(tweetId, 'tweet', 25);
        const safeName = sanitizeMediaToken(baseName, 'media', 80);
        return `${samplePrefix}${safeAuthor}_${datePart}_${safeTweet}_${safeName}.${extension}`;
    }

    async function fetchMediaBlob(url) {
        if (!isAllowedMediaUrl(url)) throw new Error('Media URL not allowed');
        const response = await fetch(url, { credentials: 'omit' });
        if (!isAllowedMediaUrl(response.url)) throw new Error('Media URL not allowed');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.size) throw new Error('Empty blob');
        const contentType = response.headers.get('content-type') || blob.type || '';
        const pathname = new URL(response.url).pathname;
        const extension = extensionFromMime(contentType, pathname);
        if (!extension) throw new Error('Media type not allowed');
        const rawBase = (pathname.split('/').pop() || 'media').replace(/\.[^.]+$/, '') || 'media';
        return { blob, extension, baseName: sanitizeMediaToken(rawBase, 'media', 80) };
    }

    function triggerBlobDownload(blob, filename) {
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
            anchor.remove();
            URL.revokeObjectURL(anchor.href);
        }, 30000);
    }

    async function downloadImageFromUrl(url, context) {
        const candidates = getImageDownloadUrlCandidates(url);
        let lastError = null;
        for (let i = 0; i < candidates.length; i++) {
            try {
                const result = await fetchMediaBlob(candidates[i]);
                const filename = buildMediaFilename({
                    author: context.author,
                    tweetId: context.tweetId,
                    baseName: result.baseName,
                    extension: result.extension,
                    isSample: i > 0
                });
                triggerBlobDownload(result.blob, filename);
                return filename;
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError || new Error('Image download failed');
    }

    function unwrapTweetResult(result) {
        if (!result) return null;
        return result.tweet || result;
    }

    function parseTweetLegacyMedias(tweetResult) {
        if (!tweetResult) return [];
        const tweetLegacy = tweetResult.legacy;
        const tweetUser = tweetResult.core?.user_results?.result;
        if (!tweetLegacy) return [];

        let sourceMedias = [];
        if (tweetLegacy.extended_entities?.media) {
            sourceMedias = tweetLegacy.extended_entities.media;
        } else if (tweetResult.card?.legacy?.binding_values) {
            try {
                const unified = tweetResult.card.legacy.binding_values.find((bv) => bv.key === 'unified_card');
                if (unified?.value?.string_value) {
                    const value = JSON.parse(unified.value.string_value);
                    sourceMedias = Object.values(value.media_entities || {});
                }
            } catch (e) {
                // unified_card not parseable: no media
            }
        }

        const screenName = tweetUser?.legacy?.screen_name || tweetUser?.core?.screen_name || 'unknown';
        const tweetId = tweetResult.rest_id || tweetLegacy.id_str;
        const medias = [];

        for (const media of sourceMedias) {
            let downloadUrl = null;
            const previewUrl = media.media_url_https;

            if (media.video_info?.variants) {
                const best = media.video_info.variants
                    .filter((v) => v.bitrate !== undefined)
                    .reduce((acc, cur) => (!acc || cur.bitrate > acc.bitrate ? cur : acc), null);
                downloadUrl = best?.url || null;
            } else if (previewUrl) {
                if (previewUrl.includes('?format=')) {
                    downloadUrl = previewUrl;
                } else {
                    const parts = previewUrl.split('.');
                    const ext = parts.pop();
                    downloadUrl = `${parts.join('.')}?format=${ext}&name=orig`;
                }
            }

            if (!downloadUrl) continue;

            medias.push({
                screen_name: screenName,
                tweet_id: tweetId,
                download_url: downloadUrl,
                preview_url: previewUrl,
                type: media.type === 'animated_gif' ? 'video' : media.type
            });
        }

        return medias;
    }

    async function fetchTweetMedias(tweetId) {
        if (!tweetId) return [];
        if (mediaApiCache.has(tweetId)) return mediaApiCache.get(tweetId);

        const variables = {
            tweetId,
            withCommunity: false,
            includePromotedContent: false,
            withVoice: false
        };
        const features = {
            creator_subscriptions_tweet_preview_api_enabled: true,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            responsive_web_enhance_cards_enabled: false
        };
        const fieldToggles = {
            withArticleRichContentState: true,
            withArticlePlainText: false
        };

        const url = new URL(`https://x.com/i/api/graphql/${TWEET_RESULT_BY_REST_ID_QUERY}/TweetResultByRestId`);
        url.searchParams.set('variables', JSON.stringify(variables));
        url.searchParams.set('features', JSON.stringify(features));
        url.searchParams.set('fieldToggles', JSON.stringify(fieldToggles));

        const headers = {
            authorization: TWITTER_BEARER,
            'x-csrf-token': getCookieValue('ct0'),
            'x-twitter-client-language': 'en',
            'x-twitter-active-user': 'yes',
            'content-type': 'application/json'
        };
        const guestToken = getCookieValue('gt');
        if (guestToken) headers['x-guest-token'] = guestToken;
        else headers['x-twitter-auth-type'] = 'OAuth2Session';

        let medias = [];
        try {
            const response = await fetch(url.toString(), { headers });
            if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
            const json = await response.json();
            const tweetResult = unwrapTweetResult(json?.data?.tweetResult?.result);
            medias = parseTweetLegacyMedias(tweetResult);
            const quoted = tweetResult?.quoted_status_result?.result;
            if (quoted) medias = medias.concat(parseTweetLegacyMedias(unwrapTweetResult(quoted)));
        } catch (err) {
            console.log('[X Media Download] GraphQL failed, trying embed API:', err);
        }
        // X rotates the GraphQL query id; the public embed API is the fallback.
        if (!medias.length) medias = await fetchSyndicationMedias(tweetId);
        if (!medias.length) return [];

        mediaApiCache.set(tweetId, medias);
        if (mediaApiCache.size > 24) mediaApiCache.delete(mediaApiCache.keys().next().value);

        return medias;
    }

    // cdn.syndication.twimg.com only allows CORS from platform.twitter.com, so go through the userscript manager.
    function gmGetJson(url) {
        const xhr = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest
            : (typeof GM !== 'undefined' && GM.xmlHttpRequest) || null;
        if (!xhr) return Promise.reject(new Error('GM_xmlhttpRequest unavailable'));
        return new Promise((resolve, reject) => {
            xhr({
                method: 'GET',
                url,
                onload: (res) => {
                    if (res.status !== 200) return reject(new Error(`Embed API HTTP ${res.status}`));
                    try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); }
                },
                onerror: () => reject(new Error('Embed API network error'))
            });
        });
    }

    function syndicationToMedias(tweet) {
        if (!tweet?.mediaDetails) return [];
        return parseTweetLegacyMedias({
            rest_id: tweet.id_str,
            legacy: { id_str: tweet.id_str, extended_entities: { media: tweet.mediaDetails } },
            core: { user_results: { result: { legacy: { screen_name: tweet.user?.screen_name } } } }
        });
    }

    async function fetchSyndicationMedias(tweetId) {
        try {
            const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
            const json = await gmGetJson(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}`);
            return syndicationToMedias(json).concat(syndicationToMedias(json.quoted_tweet));
        } catch (err) {
            console.log('[X Media Download] embed API failed:', err);
            return [];
        }
    }

    function stripUrlSearchParams(url) {
        try {
            const parsed = new URL(url);
            return parsed.origin + parsed.pathname;
        } catch (e) {
            return url.split('?')[0];
        }
    }

    async function downloadVideoForButton(posterUrl, context) {
        const medias = await fetchTweetMedias(context.tweetId);
        const posterBase = stripUrlSearchParams(posterUrl || '');
        let mediaEntry = medias.find((m) => {
            const preview = stripUrlSearchParams(m.preview_url || '');
            return preview.startsWith(posterBase) || posterBase.startsWith(preview);
        });
        if (!mediaEntry) mediaEntry = medias.find((m) => m.type === 'video');
        if (!mediaEntry?.download_url) throw new Error('No video URL');

        const result = await fetchMediaBlob(mediaEntry.download_url);
        const filename = buildMediaFilename({
            author: mediaEntry.screen_name || context.author,
            tweetId: mediaEntry.tweet_id || context.tweetId,
            baseName: result.baseName,
            extension: result.extension
        });
        triggerBlobDownload(result.blob, filename);
        return filename;
    }

    async function onMediaDownloadClick(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const btn = event.currentTarget;
        if (btn.classList.contains('xts-media-downloading')) return;

        const context = getTweetContextFromMediaElement(btn);
        if (!context?.tweetId) {
            showPopup('noMedia', 4000);
            return;
        }

        btn.classList.add('xts-media-downloading');
        showPopup('inProgress', 2500);

        try {
            const filename = btn.dataset.isVideo === '1'
                ? await downloadVideoForButton(btn.dataset.posterUrl || '', context)
                : await downloadImageFromUrl(btn.dataset.mediaUrl || '', context);
            btn.classList.remove('xts-media-downloading');
            console.log('[X Media Download] saved', filename);
        } catch (err) {
            btn.classList.remove('xts-media-downloading');
            console.log('[X Media Download] failed:', err);
            showPopup('failed', 5000);
        }
    }

    function attachMediaDownloadButton(host, btn, selector) {
        if (!host || host.querySelector(selector)) return;
        host.classList.add('xts-media-download-host');
        btn.addEventListener('click', onMediaDownloadClick);
        host.appendChild(btn);
    }

    function processMediaImages() {
        const images = document.querySelectorAll('article img[src*="pbs.twimg.com/media/"]:not([data-xts-media-handled])');
        for (const img of images) {
            if (shouldSkipMediaImage(img) || !isTweetMediaImage(img)) {
                img.dataset.xtsMediaHandled = '1';
                continue;
            }
            if (!img.complete || img.naturalWidth === 0) {
                scheduleImageDownloadRetry(img);
                continue;
            }
            const host = img.closest('a[href*="/photo/"]');
            const selector = '.xts-media-download-btn[data-is-video="0"]';
            if (host && !host.querySelector(selector)) {
                const btn = createMediaDownloadButton(false);
                btn.dataset.mediaUrl = img.src;
                attachMediaDownloadButton(host, btn, selector);
            }
            img.dataset.xtsMediaHandled = '1';
        }
    }

    function processMediaVideos() {
        const videos = document.querySelectorAll('article video:not([data-xts-media-handled])');
        for (const video of videos) {
            const host = getVideoDownloadHost(video);
            const selector = '.xts-media-download-btn[data-is-video="1"]';
            if (host && !host.querySelector(selector)) {
                const btn = createMediaDownloadButton(true);
                btn.dataset.posterUrl = video.getAttribute('poster') || '';
                attachMediaDownloadButton(host, btn, selector);
            }
            video.dataset.xtsMediaHandled = '1';
        }
    }

    function init() {
        injectMediaDownloadStyles();

        let debounceTimer = null;
        scheduleScan = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processMediaImages();
                processMediaVideos();
            }, 500);
        };
        scheduleScan();

        const observer = new MutationObserver((mutations) => {
            const relevant = mutations.some((m) => {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.('article, img, video, [data-testid="tweetPhoto"], [data-testid="videoComponent"]')) return true;
                    if (node.querySelector?.('article img, video, [data-testid="tweetPhoto"], [data-testid="videoComponent"]')) return true;
                }
                return false;
            });
            if (relevant) scheduleScan();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
})();
