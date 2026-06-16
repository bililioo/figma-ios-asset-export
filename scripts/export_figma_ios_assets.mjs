#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SCALES = [2, 3];
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const TOKEN_ENV_NAMES = [
  'FIGMA_TOKEN',
  'FIGMA_ACCESS_TOKEN',
  'FIGMA_API_TOKEN',
  'FIGMA_PERSONAL_ACCESS_TOKEN',
];

function usage() {
  console.error(`Usage:
  node export_figma_ios_assets.mjs --mapping mapping.json [--figma-url URL | --file-key KEY] [--asset-root DIR | --out-dir DIR]

Default mode exports iOS PNG imagesets with @2x and @3x files through the Figma REST API.
Use --format pdf when vector PDF assets are desired instead.

Mapping JSON can be:
  [{ "asset": "figma_icon", "nodeId": "1:202" }]

or:
  {
    "figmaUrl": "https://www.figma.com/design/FILE_KEY/FileName?node-id=1-607",
    "assetRoot": "/absolute/path/Assets.xcassets/FigmaSlices",
    "items": [{ "asset": "figma_icon", "nodeId": "1:202" }]
  }

Options:
  --mapping FILE          Required JSON mapping file.
  --figma-url URL        Figma design URL. Overrides mapping.figmaUrl.
  --file-key KEY         Figma file key if no figma URL is supplied.
  --asset-root DIR       Write Xcode .imageset folders and Contents.json.
  --out-dir DIR          Write plain exported files.
  --format png|pdf       Export format. Default: png.
  --scales 2,3           PNG scales to export. Default: 2,3.
  --token TOKEN          Figma REST API token. Avoid this in shell history when possible.
  --token-file FILE      File containing a Figma token. Can also be set with FIGMA_TOKEN_FILE.
  --batch-size N         Node ids per REST request. Default: 50.
  --retries N            Retries for Figma/API downloads on 429/5xx/network failures. Default: 2.
  --retry-delay-ms N     Initial retry delay in milliseconds. Default: 500.
  --use-absolute-bounds  Pass use_absolute_bounds=true to Figma.
  --dry-run              Validate mapping and preview planned outputs. Does not require a token or network.
`);
}

function parseArgs(argv) {
  const out = {
    format: undefined,
    scales: undefined,
    batchSize: 50,
    retries: DEFAULT_RETRIES,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    useAbsoluteBounds: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--use-absolute-bounds') {
      out.useAbsoluteBounds = true;
      continue;
    }
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--pdf') {
      out.format = 'pdf';
      continue;
    }
    if (arg === '--png') {
      out.format = 'png';
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    out[key] = value;
    i += 1;
  }

  out.batchSize = Number(out.batchSize);
  if (!Number.isInteger(out.batchSize) || out.batchSize <= 0) {
    throw new Error('Invalid --batch-size');
  }
  out.retries = Number(out.retries);
  if (!Number.isInteger(out.retries) || out.retries < 0) {
    throw new Error('Invalid --retries');
  }
  out.retryDelayMs = Number(out.retryDelayMs);
  if (!Number.isInteger(out.retryDelayMs) || out.retryDelayMs < 0) {
    throw new Error('Invalid --retry-delay-ms');
  }
  return out;
}

function readMapping(file) {
  if (!file) throw new Error('--mapping is required');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(data)) return { items: data };
  if (data && Array.isArray(data.items)) return data;
  throw new Error('Mapping JSON must be an array or an object with an items array');
}

function parseFigmaUrl(url) {
  if (!url) return {};
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  const designIndex = parts.findIndex(part => part === 'design' || part === 'file');
  if (designIndex < 0 || !parts[designIndex + 1]) {
    throw new Error(`Cannot parse Figma design URL: ${url}`);
  }
  return { fileKey: parts[designIndex + 1] };
}

function normalizeNodeId(nodeId) {
  return String(nodeId).trim().replace(/-/g, ':');
}

function safeFileStem(item) {
  const stem = item.asset || item.name || item.figmaName || normalizeNodeId(item.nodeId);
  return String(stem).replace(/[/:\\]/g, '_').replace(/\s+/g, '_');
}

function parseScales(value) {
  if (Array.isArray(value)) return value.map(Number);
  return String(value)
    .split(',')
    .map(part => Number(part.trim()))
    .filter(Number.isFinite);
}

function assertScales(scales) {
  if (!scales.length) throw new Error('At least one PNG scale is required');
  for (const scale of scales) {
    if (scale < 0.01 || scale > 4) {
      throw new Error(`Figma image scale must be between 0.01 and 4: ${scale}`);
    }
  }
}

function readToken(args, mapping) {
  if (args.token) return args.token.trim();

  const tokenFile = args.tokenFile || mapping.tokenFile || process.env.FIGMA_TOKEN_FILE;
  if (tokenFile) {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    if (token) return token;
  }

  for (const name of TOKEN_ENV_NAMES) {
    const token = process.env[name]?.trim();
    if (token) return token;
  }

  throw new Error(`No Figma token found. Set FIGMA_TOKEN_FILE, ${TOKEN_ENV_NAMES.join(', ')}, or pass --token-file.`);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

async function fetchWithRetry(url, options, label, { retries, retryDelayMs }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!shouldRetry(response.status) || attempt === retries) return response;
      lastError = new Error(`${label} failed with HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
    }
    const delay = retryDelayMs * (2 ** attempt);
    if (delay > 0) await sleep(delay);
  }
  throw lastError;
}

async function figmaImagesRequest({ fileKey, ids, format, scale, token, useAbsoluteBounds, retries, retryDelayMs }) {
  const url = new URL(`https://api.figma.com/v1/images/${fileKey}`);
  url.searchParams.set('ids', ids.join(','));
  url.searchParams.set('format', format);
  if (format === 'png') url.searchParams.set('scale', String(scale));
  if (useAbsoluteBounds) url.searchParams.set('use_absolute_bounds', 'true');

  const response = await fetchWithRetry(
    url,
    { headers: { 'X-Figma-Token': token } },
    `Figma images API for ${ids.join(',')}`,
    { retries, retryDelayMs },
  );
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok || body.err) {
    const detail = body.err || body.message || `HTTP ${response.status}`;
    throw new Error(`Figma images API failed for ${ids.join(',')}: ${detail}`);
  }
  return body.images || {};
}

async function getImageUrls(options, ids) {
  const all = {};
  for (const group of chunk(ids, options.batchSize)) {
    const images = await figmaImagesRequest({ ...options, ids: group });
    Object.assign(all, images);
  }
  return all;
}

async function downloadBytes(url, label, { retries, retryDelayMs }) {
  const response = await fetchWithRetry(url, undefined, `Download ${label}`, { retries, retryDelayMs });
  if (!response.ok) throw new Error(`Download failed for ${label}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function pngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return undefined;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function tmpPathFor(target) {
  const parent = path.dirname(target);
  const name = path.basename(target);
  return path.join(parent, `.${name}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function replaceDirectory(from, to) {
  const backup = fs.existsSync(to) ? tmpPathFor(to) : undefined;
  if (backup) fs.renameSync(to, backup);
  try {
    fs.renameSync(from, to);
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
    if (backup) fs.renameSync(backup, to);
    throw error;
  }
}

function replaceFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function cleanupStagedPaths(paths) {
  for (const target of paths.reverse()) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function writePngContents(imageset, asset, scales) {
  writeJson(path.join(imageset, 'Contents.json'), {
    images: scales.map(scale => ({
      filename: `${asset}@${scale}x.png`,
      idiom: 'universal',
      scale: `${scale}x`,
    })),
    info: { author: 'xcode', version: 1 },
  });
}

function writePdfContents(imageset, asset) {
  writeJson(path.join(imageset, 'Contents.json'), {
    images: [{ filename: `${asset}.pdf`, idiom: 'universal' }],
    info: { author: 'xcode', version: 1 },
    properties: { 'preserves-vector-representation': true },
  });
}

function outputPathFor({ assetRoot, outDir, item, format, scale }) {
  const asset = safeFileStem(item);
  if (assetRoot) {
    const imageset = path.join(assetRoot, `${asset}.imageset`);
    const filename = format === 'png' ? `${asset}@${scale}x.png` : `${asset}.pdf`;
    return { imageset, file: path.join(imageset, filename), asset };
  }

  const filename = format === 'png' ? `${asset}@${scale}x.png` : `${asset}.pdf`;
  return { file: path.join(outDir, filename), asset };
}

function outputTargetsFor({ assetRoot, outDir, item, format, scales }) {
  const scalesForItem = format === 'png' ? scales : [undefined];
  return scalesForItem.map(scale => outputPathFor({ assetRoot, outDir, item, format, scale }));
}

function assertUniqueOutputTargets({ items, assetRoot, outDir, format, scales }) {
  const seen = new Map();
  for (const item of items) {
    for (const target of outputTargetsFor({ assetRoot, outDir, item, format, scales })) {
      const previous = seen.get(target.file);
      if (previous) {
        throw new Error(
          `Duplicate output target ${target.file} for node ${item.nodeId}; already used by node ${previous.nodeId}. Use unique asset names.`,
        );
      }
      seen.set(target.file, item);
    }
  }
}

function validateItems(items, assetRoot) {
  return items.map(item => {
    if (!item.nodeId) throw new Error(`Missing nodeId in item: ${JSON.stringify(item)}`);
    if (assetRoot && !item.asset) {
      throw new Error(`asset is required when using assetRoot for node ${item.nodeId}`);
    }
    return { ...item, nodeId: normalizeNodeId(item.nodeId) };
  });
}

function assertAllPngUrls({ items, urlsByScale, scales }) {
  const missing = [];
  for (const item of items) {
    const asset = safeFileStem(item);
    for (const scale of scales) {
      if (!urlsByScale.get(scale)[item.nodeId]) missing.push(`${asset} (${item.nodeId}) @${scale}x`);
    }
  }
  if (missing.length) {
    throw new Error(`Figma returned no PNG URL for ${missing.length} export(s): ${missing.join(', ')}`);
  }
}

function assertAllPdfUrls({ items, urls }) {
  const missing = [];
  for (const item of items) {
    const asset = safeFileStem(item);
    if (!urls[item.nodeId]) missing.push(`${asset} (${item.nodeId})`);
  }
  if (missing.length) {
    throw new Error(`Figma returned no PDF URL for ${missing.length} export(s): ${missing.join(', ')}`);
  }
}

async function exportPng({ items, token, fileKey, assetRoot, outDir, scales, batchSize, useAbsoluteBounds, retries, retryDelayMs }) {
  const ids = items.map(item => item.nodeId);
  const urlsByScale = new Map();
  for (const scale of scales) {
    urlsByScale.set(scale, await getImageUrls({
      fileKey,
      format: 'png',
      scale,
      token,
      batchSize,
      useAbsoluteBounds,
      retries,
      retryDelayMs,
    }, ids));
  }
  assertAllPngUrls({ items, urlsByScale, scales });

  let count = 0;
  const stagedWrites = [];
  const stagedPaths = [];
  try {
    for (const item of items) {
      const asset = safeFileStem(item);
      const stagedImageset = assetRoot ? tmpPathFor(path.join(assetRoot, `${asset}.imageset`)) : undefined;
      if (assetRoot) {
        fs.mkdirSync(stagedImageset, { recursive: true });
        stagedPaths.push(stagedImageset);
      }

      for (const scale of scales) {
        const url = urlsByScale.get(scale)[item.nodeId];
        const { file } = outputPathFor({ assetRoot, outDir, item, format: 'png', scale });
        const stagedFile = assetRoot ? path.join(stagedImageset, path.basename(file)) : tmpPathFor(file);
        if (!assetRoot) stagedPaths.push(stagedFile);
        fs.mkdirSync(path.dirname(stagedFile), { recursive: true });
        const bytes = await downloadBytes(url, `${asset}@${scale}x`, { retries, retryDelayMs });
        fs.writeFileSync(stagedFile, bytes);
        const dimensions = pngDimensions(bytes);
        const suffix = dimensions ? ` ${dimensions.width}x${dimensions.height}` : '';
        console.log(`[${asset}] saved ${file}${suffix}`);
        if (!assetRoot) stagedWrites.push({ stagedFile, file });
        count += 1;
      }

      if (assetRoot) {
        const finalImageset = path.join(assetRoot, `${asset}.imageset`);
        writePngContents(stagedImageset, asset, scales);
        stagedWrites.push({ stagedDir: stagedImageset, dir: finalImageset });
      }
    }
  } catch (error) {
    cleanupStagedPaths(stagedPaths);
    throw error;
  }
  for (const write of stagedWrites) {
    if (write.stagedDir) replaceDirectory(write.stagedDir, write.dir);
    else replaceFile(write.stagedFile, write.file);
  }
  return count;
}

function dryRunPng({ items, assetRoot, outDir, scales }) {
  let count = 0;
  for (const item of items) {
    const asset = safeFileStem(item);
    if (assetRoot) {
      const imageset = path.join(assetRoot, `${asset}.imageset`);
      console.log(`[dry-run:${asset}] would write ${path.join(imageset, 'Contents.json')} and ${scales.map(scale => `${asset}@${scale}x.png`).join(', ')}`);
    } else {
      console.log(`[dry-run:${asset}] would write ${scales.map(scale => `${asset}@${scale}x.png`).join(', ')} to ${outDir}`);
    }
    count += scales.length;
  }
  return count;
}

async function exportPdf({ items, token, fileKey, assetRoot, outDir, batchSize, useAbsoluteBounds, retries, retryDelayMs }) {
  const ids = items.map(item => item.nodeId);
  const urls = await getImageUrls({
    fileKey,
    format: 'pdf',
    token,
    batchSize,
    useAbsoluteBounds,
    retries,
    retryDelayMs,
  }, ids);
  assertAllPdfUrls({ items, urls });

  let count = 0;
  const stagedWrites = [];
  const stagedPaths = [];
  try {
    for (const item of items) {
      const asset = safeFileStem(item);
      const url = urls[item.nodeId];

      const { imageset, file } = outputPathFor({ assetRoot, outDir, item, format: 'pdf' });
      const stagedImageset = assetRoot ? tmpPathFor(imageset) : undefined;
      const stagedFile = assetRoot ? path.join(stagedImageset, path.basename(file)) : tmpPathFor(file);
      stagedPaths.push(assetRoot ? stagedImageset : stagedFile);
      fs.mkdirSync(path.dirname(stagedFile), { recursive: true });
      const bytes = await downloadBytes(url, `${asset}.pdf`, { retries, retryDelayMs });
      if (bytes.subarray(0, 4).toString('utf8') !== '%PDF') {
        throw new Error(`[${asset}] Downloaded PDF did not start with %PDF`);
      }
      fs.writeFileSync(stagedFile, bytes);
      if (assetRoot) {
        writePdfContents(stagedImageset, asset);
        stagedWrites.push({ stagedDir: stagedImageset, dir: imageset });
      } else {
        stagedWrites.push({ stagedFile, file });
      }
      console.log(`[${asset}] saved ${file} ${bytes.length} bytes`);
      count += 1;
    }
  } catch (error) {
    cleanupStagedPaths(stagedPaths);
    throw error;
  }
  for (const write of stagedWrites) {
    if (write.stagedDir) replaceDirectory(write.stagedDir, write.dir);
    else replaceFile(write.stagedFile, write.file);
  }
  return count;
}

function dryRunPdf({ items, assetRoot, outDir }) {
  let count = 0;
  for (const item of items) {
    const asset = safeFileStem(item);
    if (assetRoot) {
      const imageset = path.join(assetRoot, `${asset}.imageset`);
      console.log(`[dry-run:${asset}] would write ${path.join(imageset, 'Contents.json')} and ${asset}.pdf`);
    } else {
      console.log(`[dry-run:${asset}] would write ${asset}.pdf to ${outDir}`);
    }
    count += 1;
  }
  return count;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mapping = readMapping(args.mapping);
  const parsedUrl = parseFigmaUrl(args.figmaUrl || mapping.figmaUrl);
  const fileKey = args.fileKey || mapping.fileKey || parsedUrl.fileKey;
  if (!fileKey) throw new Error('Provide --figma-url, mapping.figmaUrl, --file-key, or mapping.fileKey');

  const format = String(args.format || mapping.format || 'png').toLowerCase();
  if (!['png', 'pdf'].includes(format)) throw new Error('--format must be png or pdf');

  const assetRoot = args.assetRoot || mapping.assetRoot;
  const outDir = args.outDir || mapping.outDir;
  if (!assetRoot && !outDir) throw new Error('Provide --asset-root, mapping.assetRoot, --out-dir, or mapping.outDir');

  const scales = parseScales(args.scales || mapping.scales || DEFAULT_SCALES);
  if (format === 'png') assertScales(scales);

  const items = validateItems(mapping.items, assetRoot);
  assertUniqueOutputTargets({ items, assetRoot, outDir, format, scales });

  if (args.dryRun) {
    const dryCount = format === 'png'
      ? dryRunPng({ items, assetRoot, outDir, scales })
      : dryRunPdf({ items, assetRoot, outDir });
    console.log(`Dry run complete. Validated ${items.length} item(s), planned ${dryCount} ${format.toUpperCase()} file(s).`);
    return;
  }

  const token = readToken(args, mapping);

  const common = {
    items,
    token,
    fileKey,
    assetRoot,
    outDir,
    scales,
    batchSize: args.batchSize,
    retries: args.retries,
    retryDelayMs: args.retryDelayMs,
    useAbsoluteBounds: args.useAbsoluteBounds || Boolean(mapping.useAbsoluteBounds),
  };
  const count = format === 'png' ? await exportPng(common) : await exportPdf(common);
  console.log(`Done. Exported ${count} ${format.toUpperCase()} file(s).`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
