# Inaccurate Piano MIDI

Learning a piece from a YouTube video often means replaying the same few seconds over and over. Reaching for the mouse to pause, scrub back, and start again breaks your concentration and takes your hands away from the piano.

Inaccurate Piano MIDI lets a connected MIDI keyboard or pedals control the video instead. You can mark a starting point, jump back to it and play, or pause and resume, all from your instrument. It is a small Chrome extension with no account or external service.

![The extension popup beside a piano practice video](store-assets/screenshot-1280x800.png)

## Cue and play while practicing

The idea comes from the **Cue/Play** controls on DJ decks. A cue point marks a place in a track that you want to return to quickly. This extension applies that idea to a YouTube video:

- **Set Cue Point** saves the video's current position.
- **Jump & Play** returns to that position and starts playback.
- **Play/Pause Toggle** stops or resumes the video where it is.

For example, pause at the start of a difficult phrase and set a cue point. Play along until you need another attempt, then press Jump & Play to hear the phrase again. You can repeat it as many times as you like, pause to work through a passage, and set a new cue when you move on. The repeat is triggered by you; the extension does not run an automatic loop.

Each new video starts with a cue at 0:00. Setting a cue replaces it for the current video.

## Setup

1. Connect a MIDI keyboard or pedals to your computer.
2. Install the extension, or [load it locally from source](#load-locally).
3. Open a YouTube video on a watch page, click the extension icon, and select a profile.
4. Click **Connect MIDI** and allow Chrome's MIDI access prompt if it appears.
5. Close the popup if you like; the controls keep working while the video page is open.

After access has been granted, the extension reconnects automatically on later watch-page loads. If you open a video from YouTube's homepage without a full page reload, open the popup once on the video page to attach the controls.

## Default controls

| Profile | Set Cue Point | Jump & Play | Play/Pause Toggle |
| --- | --- | --- | --- |
| **3-Pedal Setup** | Middle pedal (sostenuto), **CC 66** | Left pedal (soft/una corda), **CC 67** | Double-tap the left pedal, **CC 67**, within 350 ms |
| **88-Key Piano** | Leftmost white key, **A0 / MIDI note 21** | First black key, **A#0 / note 22** | Next white key, **B0 / note 23** |
| **61-Key Piano** | Leftmost white key, **C2 / MIDI note 36** | First black key, **C#2 / note 37** | Next white key, **D2 / note 38** |

In the pedal profile, the first left-pedal press jumps and plays immediately. A second press within 350 ms toggles playback without jumping again. Release the pedal between taps. All default mappings accept any MIDI channel.

The key positions above assume the usual A0 start for an 88-key piano and C2 start for a 61-key piano. Some instruments label octaves differently or send different MIDI numbers. The **MIDI note and CC numbers** in the table are what the extension actually listens for; use a custom mapping if your instrument differs.

## Custom mapping

To assign a control yourself, connect MIDI, click **Capture** beside an action, then press the key or pedal you want to use. The extension accepts a Note On or a Control Change (CC) press. It saves the message type, number, and MIDI channel locally, then switches to **Custom Mapping**.

Your first capture copies the selected profile, so the other two actions keep their existing controls. You can then capture each one separately. For example, capture a different CC for Play/Pause Toggle if you want a dedicated pedal instead of the double-tap. The popup rejects a control that would trigger two actions; click **Cancel** to stop a capture in progress.

Your profile and custom mappings stay in Chrome's local extension storage. See the [privacy policy](PRIVACY.md) for details.

## Build from source

The extension uses plain JavaScript, HTML, and CSS. It has no npm dependencies. Python 3 and `make` are needed to create the Chrome Web Store ZIP:

```sh
make check
make package
```

The package is written to `dist/inaccurate-piano-midi-<version>.zip`, where `<version>` is read from `manifest.json`. The ZIP contains `manifest.json` at its root. The finished PNG icons are included in the repository. Increase the version in `manifest.json` before packaging a new release.

## Load locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the project folder (the folder containing `manifest.json`).
4. Open a YouTube watch page and follow the [setup steps](#setup). After changing the source, click **Reload** on the extension card.

## License

MIT. See [LICENSE](LICENSE).

## Sponsorship

If you find this project useful, you can [sponsor its developer on GitHub](https://github.com/sponsors/lzap).
