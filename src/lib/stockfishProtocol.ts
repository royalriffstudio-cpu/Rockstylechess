import type { EngineMove, StockfishConfig } from './botEngine';
import { STOCKFISH_JS_SOURCE, STOCKFISH_WASM_BASE64 } from './stockfishEngineAssets';

/**
 * Assembles the HTML page StockfishEngine's hidden WebView loads.
 *
 * The vendor build's documented usage is a Worker; we don't use one here.
 * Loaded as a plain inline `<script id="sf-vendor">`, the vendor file's own
 * final line falls to its "plain browser script" branch and does
 * `document.currentScript._exports = t()`, where `t()` returns the raw,
 * uninvoked Emscripten Module factory (verified directly against the vendor
 * source and empirically round-tripped via Node before writing this).
 * We grab that factory by element id (currentScript is only valid while the
 * vendor script itself is executing) and call it ourselves with a
 * `wasmBinary` short-circuit -- no network fetch, no Worker, no relative-path
 * resolution needed at all.
 *
 * Commands are sent via `Module.ccall('command', null, ['string'], [cmd],
 * { async: /^go\b/.test(cmd) })`, matching the vendor's own internal usage
 * (mirrors its `o()` helper) -- not `postMessage`, which this build doesn't
 * expose outside of its Worker branch.
 */
export function buildStockfishHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script id="sf-vendor">
${STOCKFISH_JS_SOURCE}
</script>
<script>
(function () {
  function base64ToUint8Array(base64) {
    var binaryString = atob(base64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  function post(line) {
    if (
      line.indexOf('uciok') === 0 ||
      line.indexOf('readyok') === 0 ||
      line.indexOf('bestmove') === 0 ||
      line.indexOf('info') === 0
    ) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(line);
    }
  }

  var factory = document.getElementById('sf-vendor')._exports;
  var wasmBinary = base64ToUint8Array(${JSON.stringify(STOCKFISH_WASM_BASE64)});
  var engineModule = null;

  factory({ wasmBinary: wasmBinary, listener: post })
    .then(function (mod) {
      engineModule = mod;
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('__ready__');
    })
    .catch(function (err) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('__error__ ' + String(err));
    });

  window.__sfSend = function (cmd) {
    if (!engineModule) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('__error__ engine not ready for: ' + cmd);
      return;
    }
    engineModule.ccall('command', null, ['string'], [cmd], { async: /^go\\b/i.test(cmd) });
  };
})();
</script>
</body>
</html>`;
}

/** The `go` command for a bot move request -- depth AND movetime together, so Stockfish stops at whichever limit hits first. */
export function buildGoCommand(config: StockfishConfig): string {
  return `go depth ${config.depth} movetime ${config.movetimeMs}`;
}

// For evaluatePosition (game analysis) -- deliberately no depth cap, only
// movetime. Analysis wants Stockfish's honest best assessment of a
// position, not one deliberately shallowed for difficulty pacing.
export function buildAnalysisOptions(): string[] {
  return ['setoption name UCI_LimitStrength value false'];
}

export type ParsedEngineLine =
  | { type: 'uciok' }
  | { type: 'readyok' }
  | { type: 'bestmove'; move: EngineMove | null }
  | { type: 'info'; scoreCp?: number; scoreMate?: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'unknown' };

const PROMOTION_LETTERS = new Set(['q', 'r', 'b', 'n']);

function parseUciMove(uci: string): EngineMove | null {
  // e2e4 or e7e8q (promotion). "(none)" is what Stockfish sends for
  // bestmove when there are no legal moves (shouldn't happen here, since we
  // never ask for a move in a game-over position, but guard anyway).
  if (uci.length < 4) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotionLetter = uci.length > 4 ? uci[4].toLowerCase() : undefined;
  return {
    from: from as EngineMove['from'],
    to: to as EngineMove['to'],
    promotion: promotionLetter && PROMOTION_LETTERS.has(promotionLetter) ? (promotionLetter as EngineMove['promotion']) : undefined,
  };
}

export function parseEngineLine(line: string): ParsedEngineLine {
  if (line === '__ready__') return { type: 'ready' };
  if (line.startsWith('__error__')) return { type: 'error', message: line.slice('__error__'.length).trim() };
  if (line.startsWith('uciok')) return { type: 'uciok' };
  if (line.startsWith('readyok')) return { type: 'readyok' };
  if (line.startsWith('bestmove')) {
    const parts = line.split(/\s+/);
    const uci = parts[1];
    if (!uci || uci === '(none)') return { type: 'bestmove', move: null };
    return { type: 'bestmove', move: parseUciMove(uci) };
  }
  if (line.startsWith('info')) {
    // Depth-only info lines (no "score" yet) and "info string ..." lines
    // both fall through to unknown -- only score-bearing lines matter here.
    const match = line.match(/score (cp|mate) (-?\d+)/);
    if (!match) return { type: 'unknown' };
    const value = Number(match[2]);
    return match[1] === 'cp' ? { type: 'info', scoreCp: value } : { type: 'info', scoreMate: value };
  }
  return { type: 'unknown' };
}
