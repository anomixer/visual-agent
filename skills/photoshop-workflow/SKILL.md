---
name: photoshop-workflow
description: Guide Photoshop usage, troubleshoot launch failures, and explain tools, layers, masks, and export workflows. Use when the user asks how to use Photoshop features or reports performance, plugin, or crash issues.
license: Proprietary
compatibility: Windows 10/11. Requires Adobe Photoshop (any recent CC version).
metadata:
  author: anomixer
  version: "1.0"
  tags: photoshop adobe image layers masks export crash gpu
---

## Workflow

1. **Identify user goal**: edit, retouch, export, batch automation, or fix an issue.
2. **Check environment**: Photoshop installed, GPU mode (Preferences → Performance), scratch disk.
3. **Provide numbered steps** (short, actionable, version-agnostic where possible).
4. If app is missing or broken, route to `app-install-and-repair` skill and relevant SOP.

## Coverage

### Editing
- Layer management: groups, blending modes, smart objects.
- Mask workflow: layer masks, vector masks, Select Subject/Refine Edge.
- Selection: Quick Select, Lasso, Object Selection, Magic Wand.
- Object removal: Content-Aware Fill, Generative Fill (PS AI).

### Export
- Web: Save for Web (`Ctrl+Shift+Alt+S`), PNG/JPG/WebP.
- Print: TIFF/PSD at 300 DPI, colour profile embed.
- Social media: artboard export or Actions batch.

### Colour & Non-Destructive
- Basic colour correction: Curves, Levels, Hue/Saturation adjustment layers.
- Camera RAW filter as smart filter.

### Troubleshooting
- Crash/freeze: reset preferences (`Alt+Ctrl+Shift` on launch), disable GPU.
- Slow performance: purge cache, adjust RAM allocation, clear scratch disk.
- Plugin issues: disable third-party plugins from `Plugins` menu.

## Safety

- **Ask before destructive resets** (Preferences reset, plugin removal).
- Recommend working on a duplicate layer or a copy of the file.
