import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StockfishConfig } from './presets.generated.js';
import type { EngineMove } from './types.js';

// The SAME Stockfish 18 lite single-threaded WASM build the app embeds (see
// scripts/gen-server-bots.mjs), run in-process. The vendor build is documented for
// Worker use; this mirrors the small loader in the stockfish package's own index.js
// (init the Emscripten factory with locateFile, then drive it with ccall('command')).

const require = createRequire(import.meta.url);
const VENDOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vendor', 'stockfish');
const JS_PATH = path.join(VENDOR_DIR, 'stockfish-18-lite-single.js');
const WASM_PATH = path.join(VENDOR_DIR, 'stockfish-18-lite-single.wasm');

interface EngineModule {
  listener?: (line: string) => void;
  ccall: (name: string, ret: null, args: string[], values: string[], opts?: { async: boolean }) => unknown;
  _isReady?: () => boolean;
}

export interface UciEngine {
  send(cmd: string): void;
  onLine(listener: (line: string) => void): void;
}

export function loadStockfish(): Promise<UciEngine> {
  // The vendored Emscripten build runs `fetch=null` as an implicit global when it detects Node, which would
  // otherwise leave the whole process without fetch (Expo push, AdMob SSV key download, ...). Put it back.
  const nativeFetch = globalThis.fetch;
  const restoreFetch = (): void => {
    if (globalThis.fetch !== nativeFetch) globalThis.fetch = nativeFetch;
  };
  return new Promise((resolve, reject) => {
    try {
      const factory = require(JS_PATH) as () => (mod: Record<string, unknown>) => Promise<unknown>;
      let lineListener: (line: string) => void = () => {};
      const mod: Record<string, unknown> = {
        locateFile: (file: string) => (file.includes('.wasm') ? WASM_PATH : JS_PATH),
        listener: (line: string) => lineListener(line),
      };
      const loading = factory()(mod);
      restoreFetch();
      loading
        .then(function ready() {
          restoreFetch();
          const engine = mod as unknown as EngineModule;
          if (engine._isReady && !engine._isReady()) return void setTimeout(ready, 10);
          resolve({
            send(cmd) {
              setImmediate(() => engine.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) }));
            },
            onLine(listener) {
              lineListener = listener;
            },
          });
        })
        .catch((error) => {
          restoreFetch();
          reject(error);
        });
    } catch (error) {
      restoreFetch();
      reject(error);
    }
  });
}

export function parseBestMove(line: string): EngineMove | null | undefined {
  if (!line.startsWith('bestmove')) return undefined;
  const uci = line.split(/\s+/)[1];
  if (!uci || uci === '(none)' || uci.length < 4) return null;
  const promotion = uci.length > 4 ? uci[4].toLowerCase() : undefined;
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: promotion && 'qrbn'.includes(promotion) ? (promotion as EngineMove['promotion']) : undefined,
  };
}

export const goCommand = (config: StockfishConfig) => `go depth ${config.depth} movetime ${config.movetimeMs}`;
