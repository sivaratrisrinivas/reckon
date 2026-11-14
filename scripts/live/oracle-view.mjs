// Read-only: prints the oracle's view of an asset and of its own reporter record.
// Usage: node scripts/live/oracle-view.mjs   (set RECKON_TESTNET_RPC to choose the endpoint)
const rpc = process.env.RECKON_TESTNET_RPC ?? 'https://test.rpc.fastnear.com';
async function view(account, method, args) {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 'v', method: 'query', params: {request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64')}}),
  });
  const body = await response.json();
  if (!body.result?.result) return {error: body.error ?? body.result};
  return JSON.parse(Buffer.from(body.result.result).toString());
}
const iso = ns => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
const asset = await view('price-oracle.testnet', 'get_asset', {asset_id: 'wrap.near'});
console.log('wrap.near reports:', JSON.stringify((asset?.reports ?? []).map(report => ({oracle: report.oracle_id, at: iso(report.timestamp), price: report.price})), null, 1));
const oracle = await view('price-oracle.testnet', 'get_oracle', {account_id: 'price-oracle.testnet'});
console.log('oracle record:', JSON.stringify(oracle && {last_report: oracle.last_report ? iso(oracle.last_report) : null, price_reports: oracle.price_reports}));
const block = await (await fetch(rpc, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 'b', method: 'block', params: {finality: 'final'}})})).json();
console.log('now (chain):', iso(block.result.header.timestamp_nanosec));
