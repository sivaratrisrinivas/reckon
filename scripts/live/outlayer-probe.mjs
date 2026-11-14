// Read-only probe of outlayer.testnet view methods that may describe recent executions.
const rpc = process.env.RECKON_TESTNET_RPC ?? 'https://test.rpc.fastnear.com';
async function view(account, method, args) {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 'v', method: 'query', params: {request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64')}}),
  });
  const body = await response.json();
  if (body.result?.result) return JSON.parse(Buffer.from(body.result.result).toString());
  const error = body.result?.error ?? body.error?.cause?.info?.error_message ?? body.error?.data ?? body.error;
  return {error: typeof error === 'string' ? error.slice(0, 200) : JSON.stringify(error).slice(0, 200)};
}
for (const [method, args] of [
  ['contract_source_metadata', {}],
  ['get_stats', {}],
  ['get_request', {request_id: 47516}],
  ['get_request_status', {request_id: 47516}],
  ['is_paused', {}],
  ['get_config', {}],
]) {
  console.log(method, JSON.stringify(await view('outlayer.testnet', method, args)).slice(0, 400));
}
