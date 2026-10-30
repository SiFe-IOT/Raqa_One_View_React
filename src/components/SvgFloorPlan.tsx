import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { AppTheme } from '../theme/appTheme';
import RNFS from 'react-native-fs';
import Svg, { SvgXml, parse } from 'react-native-svg';

export interface SvgInfo {
  /** SVG XML; empty for directly displayed PNG/JPG/JPEG images. */
  xml: string;
  width: number;
  height: number;
  /** Local image URI: either an original PNG/JPG/JPEG or a cached SVG raster. */
  uri?: string;
  /** true when the PNG could not be made; the SVG is drawn live instead. */
  rasterFailed?: boolean;
}

const cache = new Map<string, SvgInfo>();

const UNIT_PX: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

/** "120", "120px", "30mm" -> px. Percentages / em / ex are ignored (NaN). */
const toPx = (s?: string | null) => {
  if (!s) return NaN;
  const m = s.trim().match(/^([0-9]*\.?[0-9]+)\s*(px|pt|pc|mm|cm|in)?$/i);
  if (!m) return NaN;
  return parseFloat(m[1]) * UNIT_PX[(m[2] ?? '').toLowerCase()];
};

const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];

/**
 * Same rule as flutter_svg: use width/height when both are given,
 * otherwise the viewBox size, otherwise a default.
 */
export function parseSvgSize(xml: string): { width: number; height: number } {
  const root = xml.match(/<svg[^>]*>/i)?.[0] ?? '';
  const w = toPx(attr(root, 'width'));
  const h = toPx(attr(root, 'height'));
  if (w > 0 && h > 0) return { width: w, height: h };

  const vb = attr(root, 'viewBox');
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(parseFloat);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) return { width: p[2], height: p[3] };
  }
  return { width: 1000, height: 700 };
}

/** SVGs without a viewBox would be cropped instead of scaled; add one. */
function ensureViewBox(xml: string, size: { width: number; height: number }): string {
  const root = xml.match(/<svg[^>]*>/i)?.[0];
  if (!root || /\sviewBox\s*=/i.test(root)) return xml;
  const withVb = root.replace(/<svg/i, `<svg viewBox="0 0 ${size.width} ${size.height}"`);
  return xml.replace(root, withVb);
}

const inflight = new Map<string, Promise<SvgInfo>>();

////////////////////////////////////////////////////////////
// Rasterising: an SVG is a tree of native views and is slow to draw. We
// draw it ONCE (off-screen, in <RasterHost/>), save a PNG and show that PNG
// everywhere from then on. Next to the PNG we save a tiny .json with the
// SVG's size, so later launches never have to read the (large) SVG at all.
//
// Files live in DocumentDirectoryPath (not CachesDirectoryPath) because
// Android may clear the cache folder, which forced a slow redraw.
////////////////////////////////////////////////////////////
const MAX_SIDE = 1920;
const RASTER_VERSION = 'v2';

const hash = (str: string) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const baseName = (path: string) => `${RNFS.DocumentDirectoryPath}/floor_${RASTER_VERSION}_${hash(path)}`;
const pngPath = (path: string) => `${baseName(path)}.png`;
const metaPath = (path: string) => `${baseName(path)}.json`;

type RasterJob = { info: SvgInfo; w: number; h: number; out: string; resolve: () => void; reject: (e: unknown) => void };
const waiting: RasterJob[] = [];
let hostEnqueue: ((j: RasterJob) => void) | null = null;

/** Fast path: PNG + size file already on disk -> no need to read the SVG. */
async function loadFromDisk(path: string): Promise<SvgInfo | null> {
  try {
    const out = pngPath(path);
    const [st, metaTxt] = await Promise.all([RNFS.stat(out), RNFS.readFile(metaPath(path), 'utf8')]);
    if (!(Number(st.size) > 0)) return null;
    const m = JSON.parse(metaTxt);
    if (!(m.width > 0 && m.height > 0)) return null;
    return { xml: '', width: m.width, height: m.height, uri: `file://${out}` };
  } catch {
    return null;
  }
}

async function makeRaster(path: string, info: SvgInfo): Promise<SvgInfo> {
  const out = pngPath(path);
  try {
    if (await RNFS.exists(out)) {
      const st = await RNFS.stat(out);
      if (Number(st.size) > 0) return { ...info, uri: `file://${out}` };
    }
    const scale = MAX_SIDE / Math.max(info.width, info.height);
    const w = Math.max(1, Math.round(info.width * scale));
    const h = Math.max(1, Math.round(info.height * scale));
    await new Promise<void>((resolve, reject) => {
      const job: RasterJob = { info, w, h, out, resolve, reject };
      if (hostEnqueue) hostEnqueue(job); else waiting.push(job);
    });
    return { ...info, uri: `file://${out}` };
  } catch {
    return { ...info, rasterFailed: true };
  }
}

/** Mount once near the app root. Draws queued SVGs off-screen and saves them as PNG. */
export function RasterHost() {
  const [job, setJob] = useState<RasterJob | null>(null);
  const queue = useRef<RasterJob[]>([]);
  const busy = useRef(false);
  const svgRef = useRef<any>(null);

  const pump = () => {
    if (busy.current) return;
    const next = queue.current.shift();
    if (!next) return;
    busy.current = true;
    setJob(next);
  };
  const finish = () => { busy.current = false; setJob(null); setTimeout(pump, 0); };

  useEffect(() => {
    hostEnqueue = (j) => { queue.current.push(j); pump(); };
    waiting.splice(0).forEach((j) => queue.current.push(j));
    pump();
    return () => { hostEnqueue = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ast = useMemo(() => (job ? parse(job.info.xml) : null), [job]);

  useEffect(() => {
    if (!job) return;
    if (!ast) { job.reject(new Error('bad svg')); finish(); return; }
    let done = false;
    const end = (fn: () => void) => { if (!done) { done = true; fn(); finish(); } };
    const guard = setTimeout(() => end(() => job.reject(new Error('raster timeout'))), 20000);
    // Give native one moment to lay the view out before capturing it.
    const t = setTimeout(() => {
      try {
        svgRef.current.toDataURL(async (b64: string) => {
          try {
            await RNFS.writeFile(job.out, b64, 'base64');
            end(() => job.resolve());
          } catch (e) { end(() => job.reject(e)); }
        }, { width: job.w, height: job.h });
      } catch (e) { end(() => job.reject(e)); }
    }, 350);
    return () => { clearTimeout(t); clearTimeout(guard); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, ast]);

  if (!job || !ast) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: job.w, height: job.h, opacity: 0.01 }}>
      <Svg
        ref={svgRef}
        {...(ast.props as any)}
        width={job.w}
        height={job.h}
        preserveAspectRatio="none"
      >
        {ast.children as any}
      </Svg>
    </View>
  );
}

export function loadSvg(path: string): Promise<SvgInfo> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(path);
  if (running) return running;

  const clean = path.startsWith('file://') ? path.replace('file://', '') : path;

  // PNG/JPG/JPEG files are already raster images: read their dimensions and
  // display them directly. Do not run SVG parsing or PNG rasterization on them.
  if (/\.(png|jpe?g)$/i.test(clean.split(/[?#]/)[0])) {
    const uri = path.startsWith('file://') ? path : `file://${path}`;
    const p = new Promise<SvgInfo>((resolve, reject) => {
      Image.getSize(
        uri,
        (width, height) => resolve({ xml: '', width, height, uri }),
        (error) => reject(error),
      );
    }).then((info) => { cache.set(path, info); return info; });
    inflight.set(path, p);
    return p.finally(() => inflight.delete(path));
  }

  // Use an existing raster immediately when available. On first load, return
  // the SVG XML for live rendering; PNG creation continues in the background.
  const p = loadFromDisk(path)
    .then(async (fast) => {
      if (fast) { cache.set(path, fast); return fast; }
      const xml = await RNFS.readFile(decodeURI(clean), 'utf8');
      const size = parseSvgSize(xml);
      const base: SvgInfo = { xml: ensureViewBox(xml, size), ...size };
      cache.set(path, base);

      // Do not await rasterization: the SVG is already displayable.
      void makeRaster(path, base).then((rasterInfo) => {
        if (rasterInfo.uri) {
          cache.set(path, rasterInfo);
          RNFS.writeFile(metaPath(path), JSON.stringify(size), 'utf8').catch(() => {});
        }
      }).catch(() => { /* live SVG remains usable if rasterization fails */ });
      return base;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

let preloadChain: Promise<void> = Promise.resolve();

/**
 * Load every floor plan in the background so switching floors is instant.
 * `firstPath` (the floor on screen) goes first; the rest load one at a time so
 * they don't compete with it for disk reads.
 */
export function preloadSvgs(paths: string[], firstPath?: string | null) {
  const ordered = [...new Set([...(firstPath ? [firstPath] : []), ...paths])].filter(Boolean);
  preloadChain = preloadChain.then(async () => {
    for (const p of ordered) {
      try { await loadSvg(p); } catch { /* ignore, useSvg reports errors */ }
    }
  });
}

/**
 * Call during app startup, BEFORE the navigator renders, and await it.
 * Waits for `firstPath` (the floor the Dashboard shows first) so it is already
 * in memory when the Dashboard mounts: no spinner, image on the first frame.
 * The other floors keep loading in the background. Never waits longer than
 * `maxWaitMs`, so a broken file can't block the app from opening.
 */
export async function warmUp(paths: string[], firstPath?: string | null, maxWaitMs = 3000) {
  const first = firstPath || paths[0];
  if (first) {
    await Promise.race([
      loadSvg(first).catch(() => {}),
      new Promise<void>((r) => setTimeout(r, maxWaitMs)),
    ]);
  }
  preloadSvgs(paths, first);
}

export function useSvg(path: string | null) {
  const [loaded, setLoaded] = useState<{ path: string; info: SvgInfo } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path || cache.has(path)) return;
    let alive = true;
    setFailed(null);
    loadSvg(path)
      .then((i) => alive && setLoaded({ path, info: i }))
      .catch(() => alive && setFailed(path));
    return () => { alive = false; };
  }, [path, attempt]);

  // Prefer the requested image when cached/loaded. While it loads, retain the
  // previously loaded image so the dashboard does not flash to a blank screen.
  const cachedInfo = path ? cache.get(path) : undefined;
  const isCurrent = !!path && (!!cachedInfo || loaded?.path === path);
  const info = path ? cachedInfo ?? loaded?.info ?? null : null;
  const error = !!path && failed === path && !cachedInfo && loaded?.path !== path;

  /** Try reading the file again (e.g. after it was restored). */
  const retry = () => { if (path) cache.delete(path); setLoaded(null); setFailed(null); setAttempt((n) => n + 1); };

  return { info, error, retry, isCurrent };
}

/** Stretches the SVG to fill its parent (parent should use the SVG's aspect ratio). */
export const SvgFill = React.memo(function SvgFill({ xml, uri }: { xml: string; uri?: string }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="stretch" fadeDuration={0} />;
  }
  return <SvgXml xml={xml} width="100%" height="100%" preserveAspectRatio="none" />;
});

export const SvgSpinner = ({ label }: { label?: string }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator />
    {label ? <Text style={{ color: AppTheme.textSecondary, fontSize: 14, marginTop: 16 }}>{label}</Text> : null}
  </View>
);