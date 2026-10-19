import { beforeEach } from 'vitest';

/**
 * Turn the event loop once before every test.
 *
 * Vitest's worker reports progress to the main process over RPC and gives up on
 * a call that has no reply after 60s ("Timeout calling onTaskUpdate"), which
 * fails the whole run even when every test passes. The reply can only be handled
 * when the event loop gets to I/O, and between tests the runner only resolves
 * promises, which never gets it there. A file of back-to-back CPU-bound tests,
 * such as the layout DDLT and corpus specs at a second or more each, therefore
 * starves the reply for as long as the whole file runs. Yielding here bounds that
 * by the slowest single test instead.
 */
// Captured before any test file loads, so a test that installs fake timers
// cannot turn this into a wait that never ends.
const realSetImmediate = setImmediate;

beforeEach(() => new Promise<void>((resolve) => realSetImmediate(resolve)));
