// Static audits for the deployed Reckon account. Each function is pure: it inspects bytes, text or a key list
// that the caller obtained locally or from a read-only RPC query, and returns human-readable violations.

// Node provides the WebAssembly global at run time; the project's type libraries do not declare it.
declare const WebAssembly: {
  Module: {new (bytes: Uint8Array): unknown; exports(module: unknown): {name: string; kind: string}[]};
};

/** The reviewed public surface of the production Wasm. Adding a method requires changing this list deliberately. */
export const REVIEWED_EXPORTS = [
  'accrue',
  'active_prediction',
  'challenge_prediction',
  'contract_source_metadata',
  'get_prediction',
  'life',
  'list_predictions',
  'new',
  'new_live',
  'on_payment_complete',
  'oracle_on_call',
  'prediction_summary',
  'publish_prediction',
  'quote_prediction',
  'receipt_verifier_head',
  'reconcile_payment',
  'request_settlement',
  'retry_payment',
  'update_receipt_verifier',
  'void_unsettled_prediction',
] as const;

// A second, independent signal: names that suggest control over funds, code, keys or rules.
const ADMINISTRATIVE_NAME = /withdraw|upgrade|migrate|owner|admin|sweep|rescue|emergency|drain|deploy|delete|_key|set_|grant|revoke|pause|resume/;

export function auditExports(wasm: Uint8Array): string[] {
  const exported = WebAssembly.Module.exports(new WebAssembly.Module(wasm))
    .filter(item => item.kind === 'function')
    .map(item => item.name);
  const violations: string[] = [];
  for (const name of exported) {
    if (!(REVIEWED_EXPORTS as readonly string[]).includes(name)) violations.push(`unreviewed exported method ${name}`);
    if (ADMINISTRATIVE_NAME.test(name)) violations.push(`exported method ${name} has an administrative name`);
  }
  for (const name of REVIEWED_EXPORTS) {
    if (!exported.includes(name)) violations.push(`reviewed method ${name} is missing from the module`);
  }
  return violations;
}

// Promise actions that would change code, keys, accounts or stake. No allowance exists for them.
const FORBIDDEN_ACTIONS = [
  'deploy_contract', 'deploy_global_contract', 'use_global_contract', 'add_full_access_key', 'add_access_key',
  'delete_key', 'delete_account', 'stake', 'create_account', 'add_gas_key', 'transfer_to_gas_key',
];
const FORBIDDEN_HOST_FUNCTION = /promise_batch_action_(?:deploy|add_key|add_gas_key|delete_key|delete_account|stake|create_account|use_global|transfer_to_gas)\w*/;
// Outgoing value and calls may only be created by these functions: the payout to the recorded beneficiary
// and the oracle request and callback they schedule.
const PROMISE_SITES: Record<string, string[]> = {
  '.transfer(': ['start_payment_transfer'],
  '.function_call(': ['request_settlement', 'start_payment_transfer'],
};

function withoutComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, '');
}

function enclosingFunction(source: string, offset: number): string | null {
  const names = [...source.slice(0, offset).matchAll(/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/g)];
  return names.at(-1)?.[1] ?? null;
}

export function auditSource(files: Record<string, string>): string[] {
  const violations: string[] = [];
  for (const [name, original] of Object.entries(files)) {
    const source = withoutComments(original);
    for (const action of FORBIDDEN_ACTIONS) {
      if (new RegExp(`\\.${action}[A-Za-z_]*\\s*\\(`).test(source)) violations.push(`${name} schedules the forbidden promise action ${action}`);
    }
    const host = FORBIDDEN_HOST_FUNCTION.exec(source);
    if (host) violations.push(`${name} calls the forbidden host function ${host[0]}`);
    for (const [call, allowed] of Object.entries(PROMISE_SITES)) {
      for (let offset = source.indexOf(call); offset !== -1; offset = source.indexOf(call, offset + call.length)) {
        const site = enclosingFunction(source, offset);
        if (!site || !allowed.includes(site)) violations.push(`${name} uses ${call} in ${site ?? 'unknown scope'}, outside ${allowed.join(', ')}`);
      }
    }
  }
  return violations;
}

export type KeyPolicy = {contractId: string; predictionPublicKey: string; methods: string[]};
type KeyEntry = {
  public_key: string;
  access_key: {permission: 'FullAccess' | {FunctionCall: {allowance: string | null; receiver_id: string; method_names: string[]}}};
};

/** The locked account has exactly one key: finite, publication-only, and addressed to the agent itself. */
export function auditAccessKeys(keys: KeyEntry[], policy: KeyPolicy): string[] {
  const violations: string[] = [];
  for (const key of keys) {
    if (key.access_key.permission === 'FullAccess') {
      violations.push(`full-access key ${key.public_key} remains on the account`);
      continue;
    }
    if (key.public_key !== policy.predictionPublicKey) {
      violations.push(`unexpected key ${key.public_key}`);
      continue;
    }
    const permission = key.access_key.permission.FunctionCall;
    if (permission.allowance === null) violations.push('the prediction key has an unlimited allowance');
    else if (BigInt(permission.allowance) <= 0n) violations.push('the prediction key has no allowance');
    if (permission.receiver_id !== policy.contractId) violations.push(`the prediction key receiver ${permission.receiver_id} is not ${policy.contractId}`);
    const methods = [...permission.method_names].sort();
    if (methods.join(',') !== [...policy.methods].sort().join(',')) violations.push(`the prediction key methods [${methods.join(', ')}] are not [${policy.methods.join(', ')}]`);
  }
  if (!keys.some(key => key.public_key === policy.predictionPublicKey)) violations.push(`the prediction key ${policy.predictionPublicKey} is missing`);
  return violations;
}
