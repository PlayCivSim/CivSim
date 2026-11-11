// Web Worker entry: runs the authoritative simulation off the main thread.
import { createHost } from './host.js';

const host = createHost((msg, transfer) => self.postMessage(msg, transfer || []));
self.onmessage = e => host(e.data);
