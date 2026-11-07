# X Media Download

Userscript that adds a download button to images and videos on [x.com](https://x.com). Hover a photo or video, click the button in its top-left corner.

- Images: original size (`name=orig`), falls back to smaller sizes with a `sample_` prefix.
- Videos and GIFs: highest-bitrate MP4.
- Filename: `author_date_tweetid_mediaid.ext`

## Install

Needs a userscript manager ([Tampermonkey](https://www.tampermonkey.net/), [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) for Safari, Violentmonkey).

[Install x-media-download.user.js](https://raw.githubusercontent.com/zex0s/x-media-download/main/x-media-download.user.js)

## Credit

The media-download part of [X Reading Position & Media Download](https://greasyfork.org/scripts/517767) by Copiis (MIT), with the reading-position features removed.
