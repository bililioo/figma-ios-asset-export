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
├── SKILL.md                              # compatibility copy
├── agents/openai.yaml                    # compatibility copy
├── scripts/export_figma_ios_assets.mjs   # compatibility copy
├── skill/figma-ios-asset-export/         # package-ready skill folder
├── tests/fixtures/
└── github-workflows/test.yml.example
```

## Prerequisites

- Node.js with built-in `fetch` support.
- A Figma personal access token with file read access.

Do not commit real Figma tokens. Provide a token with one of:

```sh
export FIGMA_TOKEN_FILE=/path/to/figma-token.txt
```

Environment token variables are also supported, but `FIGMA_TOKEN_FILE` is safer
because it avoids shell history.

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
node skill/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs --mapping /tmp/figma-assets.json
```

Validate a mapping without a token or network:

```sh
node skill/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs \
  --mapping tests/fixtures/imageset-mapping.json \
  --dry-run
```

Export plain PNG files:

```sh
node skill/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs \
  --figma-url "https://www.figma.com/design/FILE_KEY/FileName" \
  --mapping /tmp/figma-assets.json \
  --out-dir /tmp/figma-pngs
```

Export vector PDF assets:

```sh
node skill/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs \
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

The repository includes token-free dry-run fixtures:

```sh
rm -rf /tmp/figma-ios-asset-export-test
node skill/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs \
  --mapping tests/fixtures/imageset-mapping.json \
  --dry-run

node skill/figma-ios-asset-export/scripts/export_figma_ios_assets.mjs \
  --mapping tests/fixtures/plain-pdf-mapping.json \
  --dry-run
```

`github-workflows/test.yml.example` can be copied to `.github/workflows/test.yml`
when your GitHub token has `workflow` scope.

## Safety

- Never store tokens in `SKILL.md`, mapping files, or committed scripts.
- Prefer `--token-file` or `FIGMA_TOKEN_FILE` over `--token` so tokens do not
  land in shell history.
- `--dry-run` never calls Figma, does not require a token, and does not write output files.
- Treat Figma artwork as source material owned by the design file owner.
- If Figma access fails, report the blocker instead of silently substituting
  approximate native artwork.

## Release

Package the skill with a compatible skill packager:

```sh
python3 path/to/skill-creator/scripts/package_skill.py skill/figma-ios-asset-export dist
```

Attach `dist/figma-ios-asset-export.skill` to a GitHub Release.

## License

MIT
