---
name: media-editing-assistant
description: Guide the user through image, video, or audio editing tasks on Windows. Use when the user asks about editing software usage, export settings, format conversion, or media tool setup.
license: Proprietary
compatibility: Windows 10/11. Specific tools (Photoshop, DaVinci Resolve, Audacity, etc.) must be installed separately.
metadata:
  author: anomixer
  version: "1.0"
  tags: media video audio image editing export photoshop
---

## Workflow

1. Identify media type (image / video / audio) and the user's desired output.
2. Match a suitable installed application (Photoshop, DaVinci Resolve, Audacity, VLC, etc.).
3. Provide a numbered operation sequence with export/format settings.
4. If the required app is missing, route to the `app-install-and-repair` skill and the relevant SOP.

## Coverage

- **Image**: Photoshop, GIMP, Paint.NET – layers, masks, export (PNG/JPG/WebP).
- **Video**: DaVinci Resolve, CapCut, VLC – trimming, colour grade, export presets.
- **Audio**: Audacity, Adobe Audition – noise reduction, normalise, MP3/WAV export.
- **Format conversion**: FFmpeg command-line workflows.

## Action Protocol

- Open target file: `[ACTION:OPEN_FILE file_path="C:\\path\\to\\media"]`
- Install missing tool: `[ACTION:ADD_TASK sop_id="<id>"]`

## Safety

- Ask before destructive operations (overwrite originals, batch delete).
- Recommend working on a copy when the edit is irreversible.
