// Guards shared by every live rehearsal script. Each script must call requireRehearsalConfirmation before it reads a
// key file or opens a network connection. Nothing in this module touches the network or the filesystem.

export class RehearsalRefusal extends Error {}

// Only an account created for this rehearsal may be used. This pattern is deliberately narrow: it excludes
// mainnet, named accounts, sub-accounts and anything that does not announce itself as a rehearsal.
const DISPOSABLE_ACCOUNT = /^reckon-rehearsal-[a-z0-9]+(?:-[a-z0-9]+)*\.testnet$/;
const DEFAULT_RPC_URL = 'https://rpc.testnet.near.org';

export type ParsedOptions = Map<string, string | true>;

export function parseOptions(argv: string[]): ParsedOptions {
  const options: ParsedOptions = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options.set(token, next);
      index += 1;
    } else {
      options.set(token, true);
    }
  }
  return options;
}

export type Confirmed = {account: string; network: 'testnet'; rpcUrl: string; options: ParsedOptions};

export function requireRehearsalConfirmation(argv: string[], env: NodeJS.ProcessEnv, extra: {irreversible?: string} = {}): Confirmed {
  const options = parseOptions(argv);
  if (options.get('--confirm-disposable-testnet') !== true) {
    throw new RehearsalRefusal('Refusing to run: pass --confirm-disposable-testnet to confirm this is a disposable testnet account that may be spent and locked.');
  }
  if (options.get('--network') !== 'testnet') {
    throw new RehearsalRefusal('Refusing to run: only --network testnet is supported; mainnet and other networks are refused.');
  }
  if ((env.NEAR_ENV ?? '').toLowerCase() === 'mainnet') {
    throw new RehearsalRefusal('Refusing to run: NEAR_ENV is set to mainnet.');
  }
  const account = options.get('--account');
  if (typeof account !== 'string') {
    throw new RehearsalRefusal('Refusing to run: pass --account <name> for the disposable rehearsal account.');
  }
  if (!DISPOSABLE_ACCOUNT.test(account)) {
    throw new RehearsalRefusal('Refusing to run: the account must be a disposable name of the form reckon-rehearsal-<suffix>.testnet.');
  }
  const rpc = options.get('--rpc-url');
  const rpcUrl = typeof rpc === 'string' ? rpc : DEFAULT_RPC_URL;
  if (!rpcUrl.startsWith('https://')) throw new RehearsalRefusal('Refusing to run: the RPC URL must use https.');
  if (/mainnet/i.test(rpcUrl)) throw new RehearsalRefusal('Refusing to run: the RPC URL names mainnet.');
  if (extra.irreversible && options.get(`--confirm-${extra.irreversible}`) !== account) {
    throw new RehearsalRefusal(`Refusing to run: this step is irreversible. Pass --confirm-${extra.irreversible} ${account} (the account name again) to proceed.`);
  }
  return {account, network: 'testnet', rpcUrl, options};
}

/** Remove anything that looks like a secret before text is printed or saved. */
export function redact(text: string): string {
  return text
    .replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}/g, 'ed25519:<redacted secret key>')
    .replace(/"(private_key|secret_key|privateKey|secretKey)":"[^"]*"/g, '"$1":"<redacted>"')
    .replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, '<redacted token>');
}
