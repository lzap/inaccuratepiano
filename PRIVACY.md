# Privacy Policy — Inaccurate Piano MIDI

Last updated: 2 November 2026

Inaccurate Piano MIDI lets a connected MIDI keyboard or pedals control playback on a YouTube watch page. The extension processes data locally to provide this feature. It has no account, analytics, advertising, or developer-operated server.

## Data used

- MIDI input events (note or Control Change number, value, and channel) are read to trigger playback actions and capture custom mappings. Connected MIDI input names are shown in the popup. Raw events and device names are not stored.
- On a YouTube watch page, the extension reads the video ID and the HTML5 video's current time, duration, and play state. It uses these values to set or reset a cue point, seek, play, and pause. The video ID and cue point are held in page memory only and are not saved.
- The selected profile, custom MIDI mappings (message type, number, and channel), and a reconnection preference are saved in `chrome.storage.local` on your device.

## Sharing and retention

The extension does not send this data to us or to third parties. It makes no network requests. YouTube and Chrome operate under their own privacy policies when you use their services.

Saved settings remain in Chrome's local extension storage until you change them, clear the extension's storage, or uninstall the extension. Temporary MIDI and video data is discarded when the watch page closes or reloads.

## Permissions

The extension runs on YouTube watch pages to control the video. `activeTab` and `scripting` let its popup attach the local content script after YouTube navigates to a watch page without a full reload. `storage` saves your settings. Chrome separately asks for MIDI device access; the extension does not request MIDI System Exclusive (SysEx) access.

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

For privacy questions, use the support contact published with the Chrome Web Store listing.
