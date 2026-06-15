---
name: figma-ios-asset-export
description: Export real Figma design nodes through the Figma REST images API into iOS-ready assets. Use whenever the user provides a Figma link for an iOS screen, UI implementation, visual review, design restoration, icon, illustration, logo, empty state, banner, background, or any custom visual asset. Default to downloading the Figma node as @2x/@3x PNG files into Xcode .xcassets; use vector PDF only when explicitly requested. This skill should prevent substituting Figma visuals with hand-built layers, approximate shapes, or SF Symbols unless the user explicitly approves the substitution.
---

# Figma iOS Asset Export

## Workflow

Use `scripts/export_figma_ios_assets.mjs` for repeatable exports. It calls the Figma REST `GET /v1/images/:key` endpoint and downloads the returned asset URLs. Prefer PNG `@2x` and `@3x` for ordinary iOS bitmap assets; use PDF only when the user asks for vector PDF or when the asset should preserve vector representation.

## Asset-First Rule

When a Figma link is part of an iOS implementation or visual matching task, treat the Figma file as the source of truth for custom imagery. Before replacing a visual node with native drawing, CALayers, SwiftUI shapes, UIKit views, or SF Symbols, decide whether it is an exportable asset.

Export the real Figma node by default for:

- Custom icons, tab/nav/action icons, pictograms, badges, logos, illustrations, empty states, decorative images, complex vector groups, gradients, masks, blurred artwork, background art, and any node whose exact pixels affect the design match.
- Figma nodes that look like icons even if a similar SF Symbol exists.
- Multi-layer or localized visual groups where recreating with code would be approximate or time-consuming.

Use native iOS drawing/layout only for:

- Text, simple rectangles, separators, standard controls, solid fills, rounded corners, shadows, and layout structure that can be matched directly in code.
- Assets the user explicitly says to replace with SF Symbols or native shapes.
- A Figma node that is clearly a standard SF Symbol and the design or user names that symbol.

If export access is blocked by a missing token, missing node id, permissions, or Figma API failure, report the blocker and continue with a clearly marked temporary placeholder only when necessary. Do not silently substitute SF Symbols or approximate layers for Figma artwork.

## Figma Link Triage

When the user pastes a Figma URL:

1. Extract the file key and node id from the URL.
2. If the URL points to a screen/frame, inspect the design context or metadata to identify child visual nodes that should be exported.
3. Create a mapping for each exportable visual node before implementing the screen.
4. Export into the target app's `.xcassets` whenever an Xcode project is present.
5. Reference the exported images from the iOS code using the generated asset names.
6. Mention any intentionally non-exported nodes and why they are safe to build natively.

Prerequisites:

- A Figma token with file read access. Pass `--token-file`, set `FIGMA_TOKEN_FILE`, or set `FIGMA_TOKEN`. Do not store real tokens in the skill or in committed mapping files.
- Node.js with built-in `fetch` support.

## Mapping File

Create a JSON mapping with either a top-level array or an object with `items`. Prefer stable, descriptive `asset` names prefixed by the feature or screen when exporting into a real app, for example `home_empty_state` or `profile_nav_settings`.

```json
{
  "figmaUrl": "https://www.figma.com/design/FILE_KEY/FileName?node-id=1-607",
  "assetRoot": "/absolute/path/App/Assets.xcassets/FigmaSlices",
  "items": [
    { "asset": "figma_icon_settings", "nodeId": "1:202", "figmaName": "设置" },
    { "asset": "figma_icon_back", "nodeId": "1:476", "figmaName": "左侧图标/ic_back" }
  ]
}
```

Fields:

- `figmaUrl`: Any design URL from the target Figma file. The script extracts file key and file name.
- `assetRoot`: Optional. When set, each item writes an Xcode `.imageset` and rewrites `Contents.json`.
- `outDir`: Optional alternative to `assetRoot`. Writes plain exported files to a directory.
- `asset`: Required for `assetRoot`; also used as the filename stem for `outDir`.
- `nodeId`: Required Figma node id, using either `1:202` or `1-202`.
- `format`: Optional mapping default, `png` or `pdf`. Prefer the default `png`.
- `scales`: Optional PNG scale list. Default is `[2, 3]`.

For a single pasted node URL, still create a mapping instead of manually downloading one-off files. This keeps names, scales, and `.imageset` metadata repeatable.

## Commands

For Xcode PNG imagesets:

```sh
node ~/.codex/skills/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs \
  --mapping /tmp/figma-assets.json
```

For plain PNG files:

```sh
node ~/.codex/skills/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs \
  --figma-url "https://www.figma.com/design/FILE_KEY/FileName" \
  --mapping /tmp/figma-assets.json \
  --out-dir /tmp/figma-pngs
```

For vector PDF assets:

```sh
node ~/.codex/skills/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs \
  --mapping /tmp/figma-assets.json \
  --format pdf
```

## Verification

After exporting into `.xcassets`, run:

```sh
find PATH_TO_ASSET_ROOT -name '*.png' -o -name '*.pdf'
find PATH_TO_ASSET_ROOT -name Contents.json -print0 | xargs -0 python3 -m json.tool >/dev/null
```

For iOS projects, build through the project-approved verification command. PNG `@2x` and `@3x` exports are the default because they map directly to iOS scale factors. PDF preserves vector layers when Figma can export them, but raster images embedded inside Figma remain raster content inside the PDF.
