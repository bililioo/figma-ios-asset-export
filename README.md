# Figma iOS Asset Export

Export real Figma design nodes through the Figma REST Images API into iOS-ready
assets.

This skill is for iOS implementation and visual matching work where Figma is the
source of truth for custom imagery. It defaults to exporting PNG `@2x` and `@3x`
files into Xcode `.xcassets` image sets. Use vector PDF only when explicitly
requested.

## Why

When implementing a Figma design in UIKit or SwiftUI, custom visuals should not
be silently replaced with SF Symbols, approximate shapes, or hand-built layers.
This skill keeps the export decision explicit and repeatable:

- inspect the Figma link;
- map exportable visual nodes;
- export real assets;
- reference those assets from the iOS app;
- document any node intentionally built natively.

## Files

```text
.
├── SKILL.md
├── agents/openai.yaml
└── scripts/export_figma_ios_assets.mjs
```

## Prerequisites

- Node.js with built-in `fetch` support.
- A Figma personal access token with file read access.

Do not commit real Figma tokens. Provide a token with one of:

```sh
export FIGMA_TOKEN_FILE=/path/to/figma-token.txt
# or
export FIGMA_TOKEN=...
```

## Mapping Example

```json
{
  "figmaUrl": "https://www.figma.com/design/FILE_KEY/FileName?node-id=1-607",
  "assetRoot": "/absolute/path/App/Assets.xcassets/FigmaSlices",
  "items": [
    { "asset": "figma_icon_settings", "nodeId": "1:202", "figmaName": "Settings" },
    { "asset": "figma_icon_back", "nodeId": "1:476", "figmaName": "Back" }
  ]
}
```

## Usage

Export PNG `@2x` and `@3x` Xcode imagesets:

```sh
node scripts/export_figma_ios_assets.mjs --mapping /tmp/figma-assets.json
```

Export plain PNG files:

```sh
node scripts/export_figma_ios_assets.mjs \
  --figma-url "https://www.figma.com/design/FILE_KEY/FileName" \
  --mapping /tmp/figma-assets.json \
  --out-dir /tmp/figma-pngs
```

Export vector PDF assets:

```sh
node scripts/export_figma_ios_assets.mjs \
  --mapping /tmp/figma-assets.json \
  --format pdf
```

## Verification

After exporting into `.xcassets`, run:

```sh
find PATH_TO_ASSET_ROOT -name '*.png' -o -name '*.pdf'
find PATH_TO_ASSET_ROOT -name Contents.json -print0 | xargs -0 python3 -m json.tool >/dev/null
```

Then build with the target project's approved Xcode or harness command.

## Safety

- Never store tokens in `SKILL.md`, mapping files, or committed scripts.
- Treat Figma artwork as source material owned by the design file owner.
- If Figma access fails, report the blocker instead of silently substituting
  approximate native artwork.

## License

MIT
