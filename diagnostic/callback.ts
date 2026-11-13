type CallbackOptions = {
  nonce: string;
  deadlineMs: number;
  read: (remainingMs: number) => Promise<unknown>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export async function waitForCallback({nonce, deadlineMs, read, now = Date.now, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))}: CallbackOptions): Promise<Record<string, unknown>> {
  while (now() < deadlineMs) {
    const callback = await read(deadlineMs - now());
    if (now() >= deadlineMs) break;
    if (typeof callback === 'object' && callback !== null && !Array.isArray(callback) && 'nonce' in callback && callback.nonce === nonce) return callback;
    await sleep(Math.max(0, Math.min(1_000, deadlineMs - now())));
  }
  throw new Error('Oracle callback timed out');
}
