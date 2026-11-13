import {ed25519} from '@noble/curves/ed25519';
import {sha256} from '@noble/hashes/sha256';
import {base58} from '@scure/base';

const $ = (id) => document.getElementById(id);
let currentPrediction = null;
let providerMode = 'fixture';
let agentIsDead = false;
let requestInFlight = false;
let challengeInFlight = false;
let contractAccountId = '';
let challengerAccountId = '';
let challengerSecretKey = null;
let challengerPublicKey = null;

function near(amount) {
  const value = BigInt(amount);
  const whole = value / 10n ** 24n;
  const fraction = (value % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return `${whole}.${fraction || '0'} NEAR`;
}

function potentialReturn(prediction) {
  return near((BigInt(prediction.challenger_stake) + BigInt(prediction.agent_stake)).toString());
}

function price(multiplier, decimals) {
  const value = BigInt(multiplier);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `$${whole}${fraction ? `.${fraction}` : ''}`;
}

function duration(ns) {
  const seconds = Number(BigInt(ns) / 1_000_000_000n);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function dateFromNs(ns) {
  const milliseconds = Number(BigInt(ns) / 1_000_000n);
  return new Date(milliseconds).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'medium'});
}

function showStatus(message, kind = '') {
  const status = $('forecast-status');
  status.textContent = message;
  status.dataset.kind = kind;
}

function setAvailableAction() {
  $('ask-button').hidden = Boolean(currentPrediction) || agentIsDead;
  $('ask-button').disabled = requestInFlight || agentIsDead;
  if (agentIsDead) showStatus('Reckon is permanently dead. New predictions are disabled.', 'unavailable');
  else if (!currentPrediction && !requestInFlight && !$('forecast-status').dataset.kind) {
    showStatus('Reckon is idle. Asking does not reserve the challenger slot.');
  }
}

function renderPrediction(prediction, modelId) {
  currentPrediction = prediction;
  $('ask-button').hidden = true;
  $('prediction').hidden = false;
  $('question').textContent = prediction.question;
  $('reference').textContent = price(prediction.reference_multiplier, prediction.reference_decimals);
  $('decision').textContent = prediction.decision.toUpperCase();
  $('confidence').textContent = `${(prediction.confidence_ppm / 10_000).toFixed(2)}%`;
  $('agent-stake').textContent = near(prediction.agent_stake);
  $('challenger-stake').textContent = near(prediction.challenger_stake);
  $('challenge-deadline').textContent = dateFromNs(prediction.challenge_deadline_ns);
  $('deadline').textContent = dateFromNs(prediction.deadline_ns);
  $('model-id').textContent = modelId || 'Recorded in the downloadable evidence';
  $('fingerprint').textContent = prediction.evidence_hash;
  const fixtureStorage = prediction.evidence_url.startsWith('https://evidence.reckon.invalid/');
  $('evidence-link').href = fixtureStorage ? `/api/evidence/${prediction.evidence_hash}` : prediction.evidence_url;
  $('hosting-note').textContent = fixtureStorage
    ? 'This local snapshot is kept on the sandbox service filesystem and can be downloaded here. Its on-chain HTTPS URL represents a labelled storage fixture. It has not been published to durable public hosting.'
    : 'Public evidence is stored in Vercel Blob without automatic expiry. Exhausting the free allowance can pause access for up to thirty days. The on-chain URL and fingerprint remain readable if this application is offline.';
  showStatus(`Prediction #${prediction.id} is published. Its reference, confidence, stakes, and deadlines are fixed.`, 'published');
  renderChallengeOffer();
}

function renderChallengeOffer() {
  const panel = $('challenge-panel');
  const button = $('challenge-button');
  if (!currentPrediction) {
    panel.hidden = true;
    return;
  }

  const acceptedBy = currentPrediction.challenger_account_id;
  if (acceptedBy) {
    panel.hidden = true;
    const state = acceptedBy === challengerAccountId
      ? `Prediction #${currentPrediction.id} challenge accepted on chain by your local wallet.`
      : `Prediction #${currentPrediction.id} challenge position was taken by ${acceptedBy}.`;
    showStatus(state, 'accepted');
    if (acceptedBy === challengerAccountId && !$('transaction-state').textContent.includes('accepted on chain')) {
      $('transaction-state').textContent = 'The contract confirms your position and Reckon stake are committed.';
    }
    return;
  }

  const deadlineOpen = BigInt(Date.now()) * 1_000_000n < BigInt(currentPrediction.challenge_deadline_ns);
  if (!deadlineOpen) {
    panel.hidden = true;
    showStatus(`Prediction #${currentPrediction.id} challenge window is closed. Its original deadline was not extended.`, 'closed');
    return;
  }

  panel.hidden = !challengerSecretKey || !contractAccountId;
  button.disabled = challengeInFlight || !challengerSecretKey || !contractAccountId || !deadlineOpen;
  $('challenger-side').textContent = currentPrediction.decision === 'yes' ? 'NO' : 'YES';
  $('challenge-confidence').textContent = `${(currentPrediction.confidence_ppm / 10_000).toFixed(2)}% that Reckon's side is correct`;
  $('challenge-stake').textContent = near(currentPrediction.challenger_stake);
  $('challenge-return').textContent = potentialReturn(currentPrediction);
  $('challenge-deadline').textContent = dateFromNs(currentPrediction.challenge_deadline_ns);
}

function fillWalletApproval() {
  if (!currentPrediction) return;
  $('approval-side').textContent = $('challenger-side').textContent;
  $('approval-stake').textContent = near(currentPrediction.challenger_stake);
  $('approval-return').textContent = potentialReturn(currentPrediction);
  $('approval-confidence').textContent = $('challenge-confidence').textContent;
  $('approval-deadline').textContent = dateFromNs(currentPrediction.challenge_deadline_ns);
}

async function loadSandboxWallet() {
  try {
    const wallet = await getJson('/api/wallet');
    const [secretType, secretBase58] = wallet.secret_key.split(':');
    const [publicType, publicBase58] = wallet.public_key.split(':');
    if (secretType !== 'ed25519' || publicType !== 'ed25519') throw new Error('Unsupported sandbox wallet key');
    challengerSecretKey = base58.decode(secretBase58).slice(0, 32);
    challengerPublicKey = base58.decode(publicBase58);
    if (!equalBytes(ed25519.getPublicKey(challengerSecretKey), challengerPublicKey)) throw new Error('Sandbox wallet key does not match');
    await sandboxRpc('query', {request_type: 'view_account', account_id: wallet.account_id, finality: 'optimistic'});
    challengerAccountId = wallet.account_id;
    $('wallet-state').textContent = `CONNECTED · ${wallet.account_id} · EPHEMERAL SANDBOX KEY`;
    $('wallet-balance').textContent = `Available ${near(wallet.available_balance)}`;
    renderChallengeOffer();
  } catch {
    challengerSecretKey = null;
    challengerPublicKey = null;
    $('wallet-state').textContent = 'LOCAL SANDBOX WALLET · UNAVAILABLE';
    $('wallet-balance').textContent = 'Challenge signing unavailable';
    renderChallengeOffer();
  }
}

async function refreshWalletBalance() {
  try {
    const wallet = await getJson('/api/wallet/balance');
    $('wallet-balance').textContent = `Available ${near(wallet.available_balance)}`;
  } catch {
    $('wallet-balance').textContent = 'Balance unavailable';
  }
}

function openChallengeApproval() {
  if (!challengerSecretKey || !currentPrediction || challengeInFlight) return;
  if (BigInt(Date.now()) * 1_000_000n >= BigInt(currentPrediction.challenge_deadline_ns)) {
    renderChallengeOffer();
    return;
  }
  fillWalletApproval();
  $('challenge-dialog').showModal();
}

async function approveChallenge() {
  if (!challengerSecretKey || !currentPrediction || challengeInFlight) return;
  const prediction = currentPrediction;
  if (BigInt(Date.now()) * 1_000_000n >= BigInt(prediction.challenge_deadline_ns)) {
    $('challenge-dialog').close();
    renderChallengeOffer();
    return;
  }

  challengeInFlight = true;
  $('challenge-button').disabled = true;
  $('challenge-dialog').close();
  $('transaction-state').textContent = 'Wallet approved. Signing and submitting the exact quoted stake…';
  try {
    const accessKey = await sandboxRpc('query', {
      request_type: 'view_access_key', account_id: challengerAccountId, public_key: `ed25519:${base58.encode(challengerPublicKey)}`, finality: 'final',
    });
    const block = await sandboxRpc('block', {finality: 'final'});
    const args = new globalThis.TextEncoder().encode(JSON.stringify({prediction_id: prediction.id}));
    const transactionBytes = serializeFunctionCallTransaction({
      signerId: challengerAccountId,
      publicKey: challengerPublicKey,
      nonce: BigInt(accessKey.nonce) + 1n,
      receiverId: contractAccountId,
      blockHash: base58.decode(block.header.hash),
      methodName: 'challenge_prediction',
      args,
      gas: 30n * 10n ** 12n,
      deposit: BigInt(prediction.challenger_stake),
    });
    const transactionHashBytes = sha256(transactionBytes);
    const signature = ed25519.sign(transactionHashBytes, challengerSecretKey);
    $('transaction-state').textContent = 'Wallet approved. Transaction signed and submitted; waiting for final chain confirmation…';
    const outcome = await sandboxRpc('send_tx', {
      signed_tx_base64: encodeBase64(concatBytes(transactionBytes, Uint8Array.of(0), signature)),
      wait_until: 'FINAL',
    });
    if (outcome.status?.Failure) throw new Error(JSON.stringify(outcome.status.Failure));
    const transactionHash = outcome.transaction_outcome?.id || base58.encode(transactionHashBytes);
    $('transaction-state').textContent = transactionHash
      ? `Transaction ${transactionHash} confirmed by the sandbox. Checking the contract's accepted position…`
      : 'Transaction confirmed by the sandbox. Checking the contract\'s accepted position…';

    let confirmed = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await getJson('/api/predictions/active');
      confirmed = result.prediction;
      if (confirmed?.id === prediction.id && confirmed.challenger_account_id) break;
      await new Promise(resolve => globalThis.setTimeout(resolve, 200));
    }
    if (confirmed?.id === prediction.id) {
      currentPrediction = confirmed;
      renderChallengeOffer();
      if (confirmed.challenger_account_id === challengerAccountId) {
        $('transaction-state').textContent = transactionHash
          ? `Transaction ${transactionHash} confirmed; the contract accepted your position.`
          : 'Transaction confirmed; the contract accepted your position.';
      } else {
        showStatus('The challenge transaction confirmed, but another participant holds the position.', 'closed');
        $('transaction-state').textContent = 'The contract records a different challenger. Your stake was not accepted.';
      }
    } else {
      $('transaction-state').textContent = 'The transaction completed, but the accepted position is not yet visible. Checking the contract again…';
      await refreshPrediction();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    await refreshPrediction();
    if (currentPrediction?.challenger_account_id) {
      $('transaction-state').textContent = currentPrediction.challenger_account_id === challengerAccountId
        ? 'The contract confirms your challenge was accepted.'
        : 'The position was taken by another wallet before this transaction arrived.';
    } else if (message.includes('challenge window has closed') || BigInt(Date.now()) * 1_000_000n >= BigInt(prediction.challenge_deadline_ns)) {
      showStatus(`Prediction #${prediction.id} expired before acceptance. Its original deadline was not extended.`, 'closed');
      $('transaction-state').textContent = 'The challenge was rejected as late. The incoming deposit was not accepted.';
    } else if (message.includes('position is already taken') || message.includes('not the active challenge')) {
      showStatus(`Prediction #${prediction.id} was taken before your transaction was accepted.`, 'closed');
      $('transaction-state').textContent = 'The contract rejected this take. The incoming deposit was not accepted.';
    } else {
      $('transaction-state').textContent = 'The transaction was not accepted. No challenger position was recorded.';
    }
  } finally {
    challengeInFlight = false;
    renderChallengeOffer();
    void refreshWalletBalance();
  }
}

async function getJson(path) {
  const response = await fetch(path, {cache: 'no-store'});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unavailable');
  return body;
}

async function sandboxRpc(method, params) {
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 'reckon-local-wallet', method, params}),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const detail = body.error?.data || body.error?.message || 'Local sandbox RPC request failed';
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return body.result;
}

function serializeFunctionCallTransaction({signerId, publicKey, nonce, receiverId, blockHash, methodName, args, gas, deposit}) {
  const functionCallAction = concatBytes(
    Uint8Array.of(2),
    borshString(methodName),
    borshVector(args),
    littleEndian(gas, 8),
    littleEndian(deposit, 16),
  );
  return concatBytes(
    borshString(signerId),
    Uint8Array.of(0),
    publicKey,
    littleEndian(nonce, 8),
    borshString(receiverId),
    blockHash,
    littleEndian(1n, 4),
    functionCallAction,
  );
}

function borshString(value) {
  return borshVector(new globalThis.TextEncoder().encode(value));
}

function borshVector(bytes) {
  return concatBytes(littleEndian(BigInt(bytes.length), 4), bytes);
}

function littleEndian(value, byteLength) {
  let remaining = BigInt(value);
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new RangeError(`Value does not fit in ${byteLength} bytes`);
  return bytes;
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function encodeBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

async function refreshLife() {
  try {
    const life = await getJson('/api/life');
    $('remaining').textContent = duration(life.remaining_life_ns);
    agentIsDead = life.dead;
    $('life-state').textContent = life.dead ? 'Depleted · permanently dead' : 'Alive · upkeep continues';
    $('spendable').textContent = near(life.spendable_bankroll);
    $('committed').textContent = near(life.committed_bankroll);
    $('custody').textContent = near(life.challenger_custody);
    $('retired').textContent = near(life.retired_bankroll);
    $('reserve').textContent = near(life.operational_reserve);
    const percentage = Number(BigInt(life.remaining_life_ns) * 10_000n / BigInt(life.idle_life_ns)) / 100;
    $('meter').style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    if (agentIsDead) setAvailableAction();
  } catch {
    $('life-state').textContent = 'Sandbox unavailable · reconnecting';
    $('remaining').textContent = '—';
    for (const id of ['spendable', 'committed', 'custody', 'retired', 'reserve']) $(id).textContent = '—';
    $('meter').style.width = '0%';
  }
}

async function refreshPrediction() {
  try {
    const {prediction} = await getJson('/api/predictions/active');
    if (prediction && (!currentPrediction || currentPrediction.id !== prediction.id)) {
      renderPrediction(prediction);
    } else if (prediction) {
      currentPrediction = prediction;
      renderChallengeOffer();
    } else if (!prediction && !currentPrediction && !requestInFlight) {
      setAvailableAction();
    }
  } catch {
    if (!currentPrediction && !requestInFlight) showStatus('Prediction service unavailable · no forecast was created.', 'unavailable');
  }
}

async function loadConfiguration() {
  try {
    const config = await getJson('/api/config');
    providerMode = config.provider_mode;
    contractAccountId = config.contract_account_id;
    renderChallengeOffer();
    $('provider-label').textContent = providerMode === 'fixture'
      ? 'FORECAST INPUTS · SCRIPTED LOCAL FIXTURES'
      : 'FORECAST INPUTS · LIVE PROVIDERS';
  } catch {
    $('provider-label').textContent = 'FORECAST PROVIDERS · UNAVAILABLE';
  }
}

async function requestForecast() {
  if (requestInFlight || currentPrediction || agentIsDead) return;
  requestInFlight = true;
  $('ask-button').disabled = true;
  $('ask-button').textContent = 'Thinking…';
  showStatus('Checking recent market evidence and the settlement reference, then asking the configured model.', 'thinking');
  try {
    const response = await fetch('/api/forecast', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    const result = await response.json();
    if (result.status === 'published') {
      renderPrediction(result.prediction, result.model_id);
    } else if (result.status === 'abstained') {
      showStatus(`Reckon abstained. No prediction was published. ${result.justification}`, 'abstained');
    } else if (result.status === 'busy') {
      if (result.prediction) renderPrediction(result.prediction);
      else {
        await refreshPrediction();
        if (!currentPrediction) showStatus('Another forecast request is already in progress.', 'busy');
      }
    } else if (result.status === 'cooldown') {
      const seconds = Math.ceil(result.retry_after_ms / 1_000);
      showStatus(`Request cooldown · try again in about ${seconds} seconds.`, 'unavailable');
    } else if (result.status === 'rate_limited') {
      showStatus('Forecasting is temporarily unavailable because the daily model-call budget is exhausted.', 'unavailable');
    } else {
      showStatus(`No prediction was published. ${result.reason || 'A required provider is unavailable.'}`, 'unavailable');
    }
  } catch {
    showStatus('No prediction was published. The forecast service is unavailable.', 'unavailable');
  } finally {
    requestInFlight = false;
    $('ask-button').textContent = 'Ask Reckon';
    setAvailableAction();
    void refreshLife();
  }
}

$('ask-button').addEventListener('click', () => void requestForecast());
$('challenge-button').addEventListener('click', openChallengeApproval);
$('approve-challenge').addEventListener('click', () => void approveChallenge());
$('cancel-challenge').addEventListener('click', () => $('challenge-dialog').close());
void Promise.all([refreshLife(), refreshPrediction(), loadConfiguration(), loadSandboxWallet()]);
setInterval(() => void refreshLife(), 3_000);
setInterval(() => void refreshPrediction(), 5_000);
