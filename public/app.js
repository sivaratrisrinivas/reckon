import {ed25519} from '@noble/curves/ed25519';
import {sha256} from '@noble/hashes/sha256';
import {base58} from '@scure/base';

const $ = (id) => document.getElementById(id);
let currentPrediction = null;
let providerMode = 'fixture';
let agentIsDead = false;
let requestInFlight = false;
let challengePreparationInFlight = false;
let walletFundingInFlight = false;
let activeChallengeIntent = null;
let challengeInFlight = false;
let busyControl = null;
let deadlineCheckInFlight = false;
let paymentRetryInFlight = false;
let contractAccountId = '';
let challengerAccountId = '';
let challengerSecretKey = null;
let challengerPublicKey = null;
const publicRecord = new Map();
const modelIds = new Map();
const recordRows = new Map();
let recordSummary = {published: '0', valid_outcomes: '0', correct_outcomes: '0'};
let recordRefreshInFlight = false;
let chainTimestampNs = null;
let chainTimestampRefreshInFlight = false;
let chainTimestampTimer = null;

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

function challengeWindowOpen(prediction) {
  return chainTimestampNs !== null && chainTimestampNs < BigInt(prediction.challenge_deadline_ns);
}

async function refreshChainTimestamp() {
  if (chainTimestampRefreshInFlight) return chainTimestampNs;
  chainTimestampRefreshInFlight = true;
  try {
    const block = await sandboxRpc('block', {finality: 'optimistic'});
    const timestamp = block?.header?.timestamp_nanosec;
    if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) throw new Error('Sandbox block timestamp is missing');
    chainTimestampNs = BigInt(timestamp);
    renderChallengeOffer();
    if (chainTimestampTimer !== null) globalThis.clearTimeout(chainTimestampTimer);
    // Force a fresh authoritative read before the button can remain enabled
    // through a chain deadline. Local time is not used to decide acceptance.
    const challengeDeadline = currentPrediction?.challenge_deadline_ns;
    const untilChallengeDeadlineMs = challengeDeadline && chainTimestampNs < BigInt(challengeDeadline)
      ? Number((BigInt(challengeDeadline) - chainTimestampNs) / 1_000_000n)
      : 0;
    chainTimestampTimer = globalThis.setTimeout(() => {
      chainTimestampNs = null;
      renderChallengeOffer();
      void refreshChainTimestamp();
    }, currentPrediction && untilChallengeDeadlineMs > 0 ? untilChallengeDeadlineMs : 5_000);
    return chainTimestampNs;
  } catch {
    chainTimestampNs = null;
    renderChallengeOffer();
    return null;
  } finally {
    chainTimestampRefreshInFlight = false;
  }
}

// Replacing identical text still makes assistive technology re-announce a live region, so every
// repeated render goes through setText and only real changes reach the page.
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

const STATE_LABELS = {
  '': 'Idle',
  loading: 'Loading',
  preparation: 'Wallet preparation',
  thinking: 'Thinking',
  abstained: 'Abstained',
  cancelled: 'Cancelled',
  open: 'Challenge open',
  approval: 'Awaiting your approval',
  submitted: 'Challenge submitted',
  accepted: 'Challenge accepted',
  closed: 'Challenge closed',
  published: 'Waiting for deadline',
  settling: 'Settling',
  resolved: 'Resolved',
  'payment-pending': 'Payment pending',
  void: 'Void',
  unavailable: 'Unavailable',
  cooldown: 'Cooldown',
  busy: 'Busy',
  dead: 'Dead',
};

function setStateLabel(kind) {
  const label = $('state-label');
  setAttribute(label, 'data-kind', kind);
  setText(label, STATE_LABELS[kind] ?? STATE_LABELS['']);
  setAttribute($('glyph'), 'data-state', kind === 'dead' || agentIsDead ? 'dead' : kind === 'thinking' ? 'thinking' : 'alive');
}

function showStatus(message, kind = '') {
  setText($('forecast-status'), message);
  setAttribute($('forecast-status'), 'data-kind', kind);
  setStateLabel(kind);
}

// Focus belongs to the visitor. It is only moved after the visitor's own action removes the control
// they were on, and then to the status region so the outcome is read rather than lost to <body>.
function restoreFocus(returnToChallenge = false) {
  const active = globalThis.document.activeElement;
  const visible = element => element && element.getClientRects().length > 0;
  if (active && active !== globalThis.document.body && visible(active)) return;
  // Prefer the control that started the work when it is available again; otherwise read the new state.
  const candidates = returnToChallenge ? [$('challenge-button'), busyControl] : [busyControl];
  (candidates.find(visible) ?? $('state-region')).focus({preventScroll: true});
}

// aria-disabled keeps a busy control focusable, so keyboard focus stays where the visitor put it.
function setBusy(button, busyLabel) {
  if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
  setAttribute(button, 'aria-disabled', 'true');
  setText(button, busyLabel);
}

function clearBusy(button) {
  if (button.getAttribute('aria-disabled') !== 'true') return;
  button.removeAttribute('aria-disabled');
  if (button.dataset.idleLabel) setText(button, button.dataset.idleLabel);
}

function isBusy(button) {
  return button.getAttribute('aria-disabled') === 'true';
}

function setAvailableAction() {
  const unresolvedPrediction = currentPrediction && !currentPrediction.outcome;
  const preparing = !$('wallet-preparation').hidden;
  const inFlight = requestInFlight || challengePreparationInFlight;
  const hidden = Boolean(unresolvedPrediction) || agentIsDead || preparing;
  const ask = $('ask-button');
  const watch = $('watch-button');
  // The control the visitor used keeps its place (and focus) as a busy indicator; the other steps aside.
  ask.hidden = hidden || (inFlight && busyControl === watch);
  watch.hidden = hidden || (inFlight && busyControl !== watch);
  // Recovering an existing payment liability outranks starting a new round, so only one of them is primary.
  const paymentOwed = currentPrediction?.payment?.status === 'pending';
  ask.classList.toggle('primary', !paymentOwed);
  ask.classList.toggle('secondary', paymentOwed);
  if (inFlight) setBusy(busyControl === watch ? watch : ask, requestInFlight ? 'Thinking…' : 'Preparing local wallet…');
  else {
    clearBusy(ask);
    clearBusy(watch);
  }
  if (agentIsDead) showStatus('Reckon is permanently dead. New predictions are disabled.', 'dead');
  else if (!currentPrediction && !requestInFlight && !$('forecast-status').dataset.kind) {
    showStatus('Reckon is idle. Asking does not reserve the challenger slot.');
  }
}

function renderPrediction(prediction, modelId) {
  currentPrediction = prediction;
  $('prediction').hidden = false;
  setText($('question'), prediction.question);
  setText($('reference'), price(prediction.reference_multiplier, prediction.reference_decimals));
  setText($('decision'), prediction.decision.toUpperCase());
  setText($('confidence'), `${(prediction.confidence_ppm / 10_000).toFixed(2)}%`);
  setText($('agent-stake'), near(prediction.agent_stake));
  setText($('challenger-stake'), near(prediction.challenger_stake));
  setText($('prediction-challenge-deadline'), dateFromNs(prediction.challenge_deadline_ns));
  setText($('deadline'), dateFromNs(prediction.deadline_ns));
  // A later refresh of the same prediction does not carry the model id; keep the one the publication reported.
  if (modelId) modelIds.set(prediction.id, modelId);
  setText($('model-id'), modelIds.get(prediction.id) || 'Recorded in the downloadable evidence');
  setText($('fingerprint'), prediction.evidence_hash);
  const fixtureStorage = prediction.evidence_url.startsWith('https://evidence.reckon.invalid/');
  $('evidence-link').href = fixtureStorage ? `/api/evidence/${prediction.evidence_hash}` : prediction.evidence_url;
  setText($('hosting-note'), fixtureStorage
    ? 'This local snapshot is kept on the sandbox service filesystem and can be downloaded here. Its on-chain HTTPS URL represents a labelled storage fixture. It has not been published to durable public hosting.'
    : 'Public evidence is stored in Vercel Blob without automatic expiry. Exhausting the free allowance can pause access for up to thirty days. The on-chain URL and fingerprint remain readable if this application is offline.');
  renderSettlementState(prediction);
  renderChallengeOffer();
  setAvailableAction();
}

function renderSettlementState(prediction) {
  const state = $('settlement-state');
  const paymentPending = prediction.payment?.status === 'pending';
  if (prediction.outcome === 'void') {
    setText(state, `Prediction #${prediction.id} was voided because no valid oracle observation arrived within the ${settlementWindowSeconds()}-second window. A challenger refund remains ${prediction.payment?.status === 'paid' ? 'paid on chain' : prediction.payment ? 'pending' : 'not required'}.`);
    if (paymentPending) showStatus(`Prediction #${prediction.id} is void. The challenger refund is pending and not yet confirmed on chain.`, 'payment-pending');
    else showStatus(`Prediction #${prediction.id} is void. Missing oracle data did not select a winner.`, 'void');
  } else if (prediction.outcome === 'yes' || prediction.outcome === 'no') {
    const settlementPrice = prediction.settlement_price
      ? ` at ${price(prediction.settlement_price.multiplier, prediction.settlement_price.decimals)}`
      : '';
    const payment = paymentPending
      ? ` Payment pending for ${near(prediction.payment.amount)}.`
      : prediction.payment?.status === 'paid'
        ? ` Payment confirmed on chain: ${near(prediction.payment.amount)}.`
        : ' No outgoing payment was required.';
    setText(state, `Resolved ${prediction.outcome.toUpperCase()}${settlementPrice}.${payment}`);
    const resolved = `Prediction #${prediction.id} resolved ${prediction.outcome.toUpperCase()}.`;
    if (paymentPending) showStatus(`${resolved} Payment is pending and not yet confirmed on chain.`, 'payment-pending');
    else showStatus(prediction.payment?.status === 'paid' ? `${resolved} Payment confirmed on chain.` : resolved, 'resolved');
  } else if (prediction.settlement_status === 'observing') {
    setText(state, `The keeper requested the declared oracle. A valid response must complete before the ${settlementWindowSeconds()}-second cutoff. The contract uses block time; dates on this device are estimates.`);
    showStatus(`Prediction #${prediction.id} is pending oracle observation.`, 'settling');
  } else if (chainTimestampNs !== null && chainTimestampNs >= BigInt(prediction.deadline_ns)) {
    setText(state, 'The sandbox chain deadline has passed. The keeper requests the declared oracle after the on-chain deadline.');
    showStatus(`Prediction #${prediction.id} is waiting for the on-chain deadline and keeper request.`, 'settling');
  } else {
    setText(state, 'The prediction resolves automatically after its five-minute deadline. No result-reveal action is needed.');
    showStatus(`Prediction #${prediction.id} is published. Its reference, confidence, stakes, and deadlines are fixed.`, 'published');
  }
  renderPaymentRecovery(prediction);
}

// A panel the visitor is operating stays in place, inert, when the offer behind it ends. Hiding it would drop
// keyboard focus to <body>, which is an unexpected focus change the visitor did not ask for.
function retirePanel(panel, button, inertLabel) {
  if (panel.contains(globalThis.document.activeElement)) {
    panel.hidden = false;
    setBusy(button, inertLabel);
  } else {
    panel.hidden = true;
    clearBusy(button);
  }
}

function renderPaymentRecovery(prediction) {
  const panel = $('payment-recovery');
  const button = $('retry-payment-button');
  const payment = prediction.payment;
  if (!payment || payment.status !== 'pending') {
    if (payment?.status === 'paid' && panel.contains(globalThis.document.activeElement)) {
      setText($('payment-recovery-heading'), 'Payment confirmed on chain');
      setText($('payment-recovery-state'), `The transfer receipt confirmed the payment of ${near(payment.amount)} to ${payment.beneficiary_account_id}. Nothing more is owed.`);
    }
    retirePanel(panel, button, 'Payment confirmed');
    return;
  }
  panel.hidden = false;
  setText($('payment-recovery-heading'), 'Payment still owed');
  const idleLabel = payment.transfer_in_flight ? 'Verify payment receipt' : 'Retry payment';
  button.dataset.idleLabel = idleLabel;
  if (paymentRetryInFlight) setBusy(button, 'Recovering…');
  else {
    button.removeAttribute('aria-disabled');
    setText(button, idleLabel);
  }
  setText($('payment-recovery-state'), payment.transfer_in_flight
    ? `A transfer attempt is pending for ${near(payment.amount)} to ${payment.beneficiary_account_id}. The transfer may already have succeeded. Verify its receipt to recover the recorded payment safely.`
    : `The final ${prediction.outcome === 'void' ? 'refund' : 'payout'} of ${near(payment.amount)} remains owed to ${payment.beneficiary_account_id}. Recovery keeps this beneficiary and amount fixed; it does not create a new wager.`);
}

function renderChallengeOffer() {
  const panel = $('challenge-panel');
  const button = $('challenge-button');
  if (agentIsDead) {
    retirePanel(panel, button, 'Reckon is dead');
    if (!currentPrediction?.outcome) showStatus('Reckon is permanently dead. New challenges are disabled.', 'dead');
    return;
  }
  if (!currentPrediction || currentPrediction.outcome || currentPrediction.settlement_status === 'observing') {
    retirePanel(panel, button, currentPrediction?.outcome ? 'Prediction resolved' : 'Settling');
    return;
  }

  const acceptedBy = currentPrediction.challenger_account_id;
  if (acceptedBy) {
    retirePanel(panel, button, acceptedBy === challengerAccountId ? 'Your challenge is accepted' : 'Position taken');
    const state = acceptedBy === challengerAccountId
      ? `Prediction #${currentPrediction.id} challenge accepted on chain by your local wallet.`
      : `Prediction #${currentPrediction.id} challenge position was taken by ${acceptedBy}.`;
    showStatus(state, 'accepted');
    if (acceptedBy === challengerAccountId && !$('transaction-state').textContent.includes('accepted on chain')) {
      setText($('transaction-state'), 'The contract confirms your position and Reckon stake are committed.');
    }
    return;
  }

  if (chainTimestampNs === null) {
    retirePanel(panel, button, 'Checking deadline…');
    showStatus(`Prediction #${currentPrediction.id} is checking the authoritative sandbox deadline.`, 'settling');
    return;
  }
  const deadlineOpen = challengeWindowOpen(currentPrediction);
  if (!deadlineOpen) {
    retirePanel(panel, button, 'Challenge window closed');
    showStatus(`Prediction #${currentPrediction.id} challenge window is closed. Its original deadline was not extended.`, 'closed');
    return;
  }

  panel.hidden = !challengerSecretKey || !contractAccountId;
  button.disabled = !challengerSecretKey || !contractAccountId;
  if (challengeInFlight) setBusy(button, 'Submitting stake…');
  else if (deadlineCheckInFlight) setBusy(button, 'Checking deadline…');
  else clearBusy(button);
  setText($('challenger-side'), currentPrediction.decision === 'yes' ? 'NO' : 'YES');
  setText($('challenge-confidence'), `${(currentPrediction.confidence_ppm / 10_000).toFixed(2)}% that Reckon's side is correct`);
  setText($('challenge-stake'), near(currentPrediction.challenger_stake));
  setText($('challenge-return'), potentialReturn(currentPrediction));
  setText($('challenge-deadline'), dateFromNs(currentPrediction.challenge_deadline_ns));
  if (!panel.hidden) setStateLabel($('challenge-dialog').open ? 'approval' : challengeInFlight ? 'submitted' : 'open');
}

function settlementWindowSeconds() {
  return Number($('settlement-rule').dataset.windowSeconds || 120);
}

function renderPublicRecord() {
  const published = BigInt(recordSummary.published);
  const valid = BigInt(recordSummary.valid_outcomes);
  const correct = BigInt(recordSummary.correct_outcomes);
  const accuracy = valid === 0n ? '' : ` · ${Number(correct * 10_000n / valid) / 100}% accuracy`;
  setText($('record-summary'), `${published} published · ${valid} valid outcomes${accuracy}. Voids do not count.`);

  const predictions = [...publicRecord.values()].sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1);
  const rows = predictions.map(prediction => {
    // Rows that did not change keep their element, so focus and screen-reader position survive every poll.
    const signature = `${JSON.stringify(prediction)}|${paymentRetryInFlight}`;
    const cached = recordRows.get(prediction.id);
    if (cached?.signature === signature) return cached.element;
    const row = createRecordRow(prediction);
    recordRows.set(prediction.id, {signature, element: row});
    return row;
  });
  const container = $('prediction-record');
  if (rows.length !== container.children.length || rows.some((row, index) => container.children[index] !== row)) {
    const hadFocus = container.contains(globalThis.document.activeElement);
    container.replaceChildren(...rows);
    if (hadFocus && !container.contains(globalThis.document.activeElement)) {
      const recovery = container.querySelector('.record-recovery');
      if (recovery) recovery.focus({preventScroll: true});
      else restoreFocus();
    }
  }
  const firstId = predictions.length ? BigInt(predictions[0].id) : 1n;
  $('record-more').hidden = predictions.length === 0 || firstId <= 1n;
}

function createRecordRow(prediction) {
  const row = document.createElement('li');
  row.className = `record-entry${prediction.outcome === 'void' ? ' is-void' : ''}`;
  const title = document.createElement('h3');
  title.textContent = `Prediction #${prediction.id} · Reckon ${prediction.decision.toUpperCase()}`;
  const outcome = document.createElement('p');
  if (prediction.outcome === 'void') {
    outcome.textContent = 'VOID · no valid settlement observation arrived within the bounded window.';
  } else if (prediction.outcome) {
    const settled = prediction.settlement_price
      ? ` · oracle price ${price(prediction.settlement_price.multiplier, prediction.settlement_price.decimals)}`
      : '';
    outcome.textContent = `Outcome ${prediction.outcome.toUpperCase()}${settled}${prediction.challenger_account_id ? ' · challenged' : ' · unchallenged'}.`;
  } else {
    outcome.textContent = prediction.settlement_status === 'observing'
      ? 'Pending oracle observation.'
      : 'Awaiting the prediction deadline.';
  }
  const payment = document.createElement('p');
  payment.className = 'record-payment';
  if (!prediction.payment) payment.textContent = 'No outgoing payment required.';
  else if (prediction.payment.status === 'paid') payment.textContent = `Payment receipt confirmed on chain · ${near(prediction.payment.amount)} to ${prediction.payment.beneficiary_account_id}.`;
  else payment.textContent = `Payment pending · ${near(prediction.payment.amount)} owed to ${prediction.payment.beneficiary_account_id}.`;
  row.append(title, outcome, payment);
  if (prediction.payment?.status === 'pending') {
    const recover = document.createElement('button');
    recover.type = 'button';
    recover.className = 'secondary record-recovery';
    recover.textContent = prediction.payment.transfer_in_flight ? 'Verify payment receipt' : 'Retry payment';
    recover.dataset.idleLabel = recover.textContent;
    if (paymentRetryInFlight) setBusy(recover, 'Recovering…');
    recover.addEventListener('click', () => {
      if (!isBusy(recover)) void retryPaymentForPrediction(prediction.id);
    });
    row.append(recover);
  }
  return row;
}

async function refreshPublicRecord() {
  if (recordRefreshInFlight) return;
  recordRefreshInFlight = true;
  try {
    recordSummary = await getJson('/api/predictions/summary');
    const published = BigInt(recordSummary.published);
    if (published > 0n) {
      const start = published > 50n ? published - 49n : 1n;
      const newest = await getJson(`/api/predictions?start_id=${start}&limit=50`);
      for (const prediction of newest) publicRecord.set(prediction.id, prediction);
    }
    renderPublicRecord();
    if (currentPrediction) {
      const refreshed = publicRecord.get(currentPrediction.id);
      if (refreshed && JSON.stringify(refreshed) !== JSON.stringify(currentPrediction)) {
        renderPrediction(refreshed);
      }
    } else {
      const latest = [...publicRecord.values()].sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1).at(-1);
      if (latest) renderPrediction(latest);
    }
  } catch {
    setText($('record-summary'), 'The public record is temporarily unavailable.');
  } finally {
    recordRefreshInFlight = false;
  }
}

async function loadOlderPredictions() {
  const more = $('record-more');
  if (isBusy(more)) return;
  const predictions = [...publicRecord.values()];
  if (!predictions.length) return;
  const firstId = predictions.reduce((first, prediction) => BigInt(prediction.id) < first ? BigInt(prediction.id) : first, BigInt(predictions[0].id));
  if (firstId <= 1n) return;
  const start = firstId > 50n ? firstId - 50n : 1n;
  setBusy(more, 'Loading…');
  try {
    const older = await getJson(`/api/predictions?start_id=${start}&limit=50`);
    for (const prediction of older) publicRecord.set(prediction.id, prediction);
    renderPublicRecord();
  } catch {
    setText($('record-summary'), 'Older predictions could not be loaded. Try again.');
  } finally {
    clearBusy(more);
  }
}

function fillWalletApproval() {
  if (!currentPrediction) return;
  setText($('approval-side'), $('challenger-side').textContent);
  setText($('approval-stake'), near(currentPrediction.challenger_stake));
  setText($('approval-return'), potentialReturn(currentPrediction));
  setText($('approval-confidence'), $('challenge-confidence').textContent);
  setText($('approval-deadline'), dateFromNs(currentPrediction.challenge_deadline_ns));
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
    setText($('wallet-state'), `CONNECTED · ${wallet.account_id} · EPHEMERAL SANDBOX KEY`);
    setText($('wallet-balance'), `Available ${near(wallet.available_balance)}`);
    void refreshChainTimestamp();
    renderChallengeOffer();
    return true;
  } catch {
    challengerSecretKey = null;
    challengerPublicKey = null;
    setText($('wallet-state'), 'LOCAL SANDBOX WALLET · UNAVAILABLE');
    setText($('wallet-balance'), 'Challenge signing unavailable');
    renderChallengeOffer();
    return false;
  }
}

async function refreshWalletBalance() {
  try {
    const wallet = await getJson('/api/wallet/balance');
    setText($('wallet-balance'), `Available ${near(wallet.available_balance)}`);
  } catch {
    setText($('wallet-balance'), 'Balance unavailable');
  }
}

function challengeIntentIsActive(intent) {
  return activeChallengeIntent === intent && Date.now() < intent.expiresAt;
}

function cancelChallengeIntent(message, kind = 'unavailable') {
  activeChallengeIntent = null;
  $('wallet-preparation').hidden = true;
  clearBusy($('fund-wallet-button'));
  if (message) showStatus(message, kind);
  setAvailableAction();
  restoreFocus(true);
}

async function prepareChallengeIntent(intent) {
  if (!challengeIntentIsActive(intent)) {
    cancelChallengeIntent('Challenge preparation expired. No forecast was requested. Start again to create a fresh request.');
    return;
  }
  try {
    const config = await getJson('/api/config');
    if (config.network_id !== 'sandbox') {
      cancelChallengeIntent(`Challenge preparation stopped: expected the local sandbox, received ${config.network_id}. No forecast was requested.`);
      return;
    }
    if (!challengerSecretKey || !challengerAccountId) {
      if (!await loadSandboxWallet()) {
        cancelChallengeIntent('The local sandbox wallet could not be prepared. No forecast was requested.');
        return;
      }
    }
    const readiness = await getJson('/api/wallet/readiness');
    if (readiness.network_id !== 'sandbox' || readiness.account_id !== challengerAccountId) {
      cancelChallengeIntent('The wallet network or account changed during preparation. No forecast was requested.');
      return;
    }
    if (BigInt(readiness.available_balance) < BigInt(readiness.required_challenge_balance)) {
      setText($('wallet-preparation-state'), `Available ${near(readiness.available_balance)}; at least ${near(readiness.required_challenge_balance)} is needed for the largest supported local challenge. No inference or publication has started.`);
      clearBusy($('fund-wallet-button'));
      $('wallet-preparation').hidden = false;
      showStatus('The local test wallet needs more test money before a challenge forecast. You can fund it or cancel.', 'preparation');
      setAvailableAction();
      $('fund-wallet-button').focus({preventScroll: true});
      return;
    }
    $('wallet-preparation').hidden = true;
    if (!challengeIntentIsActive(intent)) {
      cancelChallengeIntent('Challenge preparation expired. No forecast was requested. Start again to create a fresh request.');
      return;
    }
    await requestForecast(intent);
  } catch {
    cancelChallengeIntent('Local wallet preparation failed. No forecast was requested.');
  }
}

async function beginChallengeForecast() {
  if (challengePreparationInFlight || requestInFlight || agentIsDead || (currentPrediction && !currentPrediction.outcome)) return;
  const intent = {id: globalThis.crypto.randomUUID(), expiresAt: Date.now() + 60_000};
  activeChallengeIntent = intent;
  challengePreparationInFlight = true;
  busyControl = $('ask-button');
  $('wallet-preparation').hidden = true;
  setAvailableAction();
  showStatus('Checking the local wallet before asking. No forecast is requested yet and no stake moves until you approve.', 'preparation');
  try {
    await prepareChallengeIntent(intent);
  } finally {
    challengePreparationInFlight = false;
    setAvailableAction();
  }
}

async function fundWalletForChallengeIntent() {
  const intent = activeChallengeIntent;
  if (!intent || walletFundingInFlight || !challengeIntentIsActive(intent)) {
    cancelChallengeIntent('Challenge preparation expired. No forecast was requested. Start again to create a fresh request.');
    return;
  }
  walletFundingInFlight = true;
  challengePreparationInFlight = true;
  setBusy($('fund-wallet-button'), 'Adding test money…');
  setText($('wallet-preparation-state'), 'Adding local sandbox test money, then rechecking the wallet for this request…');
  try {
    const response = await fetch('/api/wallet/fund', {method: 'POST'});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Local funding failed');
    await refreshWalletBalance();
    if (challengeIntentIsActive(intent)) await prepareChallengeIntent(intent);
    else cancelChallengeIntent('Challenge preparation expired while funding. No forecast was requested. Start again to create a fresh request.');
  } catch {
    cancelChallengeIntent('Local sandbox funding failed. No forecast was requested. Try again when the wallet is available.');
  } finally {
    walletFundingInFlight = false;
    challengePreparationInFlight = false;
    setAvailableAction();
  }
}

function cancelWalletApproval() {
  if ($('challenge-dialog').open) $('challenge-dialog').close();
  cancelChallengeIntent('Challenge approval cancelled. The published forecast remains available and no stake moved.', 'cancelled');
}

// Focus lands on the dialog title, not on the stake-moving button, so a held or repeated Enter key
// that opened the dialog cannot approve the stake before the terms have been read.
function showApprovalDialog() {
  fillWalletApproval();
  $('challenge-dialog').showModal();
  $('wallet-dialog-title').focus({preventScroll: true});
  renderChallengeOffer();
}

async function openChallengeApproval() {
  if (!challengerSecretKey || !currentPrediction || challengeInFlight || isBusy($('challenge-button'))) return;
  // Acknowledge the press immediately; the authoritative deadline check is a network round trip.
  deadlineCheckInFlight = true;
  setBusy($('challenge-button'), 'Checking deadline…');
  try {
    await refreshChainTimestamp();
    if (!challengeWindowOpen(currentPrediction)) return;
    showApprovalDialog();
  } finally {
    deadlineCheckInFlight = false;
    renderChallengeOffer();
  }
}

async function approveChallenge() {
  const approve = $('approve-challenge');
  if (!challengerSecretKey || !currentPrediction || challengeInFlight || isBusy(approve)) return;
  if (activeChallengeIntent && !challengeIntentIsActive(activeChallengeIntent)) {
    $('challenge-dialog').close();
    cancelChallengeIntent('Challenge request expired before approval. No stake moved. Start again to request a new challenge.');
    return;
  }
  const prediction = currentPrediction;
  // Acknowledge the approval at once; the authoritative deadline check is a network round trip.
  setBusy(approve, 'Checking deadline…');
  await refreshChainTimestamp();
  clearBusy(approve);
  if (!challengeWindowOpen(prediction)) {
    $('challenge-dialog').close();
    renderChallengeOffer();
    restoreFocus(true);
    return;
  }

  challengeInFlight = true;
  activeChallengeIntent = null;
  $('challenge-dialog').close();
  renderChallengeOffer();
  setText($('transaction-state'), 'Wallet approved. Signing and submitting the exact quoted stake…');
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
    setText($('transaction-state'), 'Wallet approved. Transaction signed and submitted; waiting for final chain confirmation…');
    const outcome = await sandboxRpc('send_tx', {
      signed_tx_base64: encodeBase64(concatBytes(transactionBytes, Uint8Array.of(0), signature)),
      wait_until: 'FINAL',
    });
    if (outcome.status?.Failure) throw new Error(JSON.stringify(outcome.status.Failure));
    const transactionHash = outcome.transaction_outcome?.id || base58.encode(transactionHashBytes);
    setText($('transaction-state'), transactionHash
      ? `Transaction ${transactionHash} confirmed by the sandbox. Checking the contract's accepted position…`
      : 'Transaction confirmed by the sandbox. Checking the contract\'s accepted position…');

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
        setText($('transaction-state'), transactionHash
          ? `Transaction ${transactionHash} confirmed; the contract accepted your position.`
          : 'Transaction confirmed; the contract accepted your position.');
      } else {
        showStatus('The challenge transaction confirmed, but another participant holds the position.', 'closed');
        setText($('transaction-state'), 'The contract records a different challenger. Your stake was not accepted.');
      }
    } else {
      setText($('transaction-state'), 'The transaction completed, but the accepted position is not yet visible. Checking the contract again…');
      await refreshPrediction();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    await refreshPrediction();
    await refreshChainTimestamp();
    if (currentPrediction?.challenger_account_id) {
      setText($('transaction-state'), currentPrediction.challenger_account_id === challengerAccountId
        ? 'The contract confirms your challenge was accepted.'
        : 'The position was taken by another wallet before this transaction arrived.');
    } else if (message.includes('challenge window has closed') || !challengeWindowOpen(prediction)) {
      showStatus(`Prediction #${prediction.id} expired before acceptance. Its original deadline was not extended.`, 'closed');
      setText($('transaction-state'), 'The challenge was rejected as late. The incoming deposit was not accepted.');
    } else if (message.includes('position is already taken') || message.includes('not the active challenge')) {
      showStatus(`Prediction #${prediction.id} was taken before your transaction was accepted.`, 'closed');
      setText($('transaction-state'), 'The contract rejected this take. The incoming deposit was not accepted.');
    } else {
      setText($('transaction-state'), 'The transaction was not accepted. No challenger position was recorded.');
    }
  } finally {
    challengeInFlight = false;
    // The visitor's own action is complete and the offer is over: read the outcome from the status region
    // rather than leaving focus on an inert button.
    if (currentPrediction?.challenger_account_id) $('state-region').focus({preventScroll: true});
    renderChallengeOffer();
    restoreFocus(true);
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
    setText($('remaining'), duration(life.remaining_life_ns));
    agentIsDead = life.dead;
    setText($('life-state'), life.dead ? 'Depleted · permanently dead' : 'Alive · upkeep continues');
    const deathDate = $('death-date');
    const deathAt = BigInt(life.death_at_ns || '0');
    deathDate.hidden = !life.dead || deathAt === 0n;
    setText(deathDate, deathAt === 0n ? '' : `Death date: ${dateFromNs(deathAt.toString())}`);
    setText($('spendable'), near(life.spendable_bankroll));
    setText($('committed'), near(life.committed_bankroll));
    setText($('custody'), near(life.challenger_custody));
    setText($('retired'), near(life.retired_bankroll));
    setText($('reserve'), near(life.operational_reserve));
    const percentage = Number(BigInt(life.remaining_life_ns) * 10_000n / BigInt(life.idle_life_ns)) / 100;
    $('meter').style.transform = `scaleX(${Math.max(0, Math.min(100, percentage)) / 100})`;
    setAttribute($('glyph'), 'data-state', agentIsDead ? 'dead' : $('state-label').dataset.kind === 'thinking' ? 'thinking' : 'alive');
    renderChallengeOffer();
    if (agentIsDead) setAvailableAction();
  } catch {
    setText($('life-state'), 'Sandbox unavailable · reconnecting');
    setText($('remaining'), '—');
    for (const id of ['spendable', 'committed', 'custody', 'retired', 'reserve']) setText($(id), '—');
    $('meter').style.transform = 'scaleX(0)';
  }
}

async function refreshPrediction() {
  try {
    const {prediction} = await getJson('/api/predictions/active');
    if (prediction && (!currentPrediction || currentPrediction.id !== prediction.id)) {
      renderPrediction(prediction);
    } else if (prediction) {
      if (JSON.stringify(currentPrediction) !== JSON.stringify(prediction)) renderPrediction(prediction);
      else renderChallengeOffer();
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
    setText($('provider-label'), providerMode === 'fixture'
      ? 'FORECAST INPUTS · SCRIPTED LOCAL FIXTURES'
      : 'FORECAST INPUTS · LIVE PROVIDERS');
    const rule = `After its deadline, the keeper requests the declared oracle. The first valid response completed within ${config.settlement_window_seconds} seconds sets the result. Caller timing and provider caching can affect that observation; it is not a historical exact-expiry price. If no valid response arrives in time, the round is void and a challenger is refunded.`;
    setText($('settlement-rule'), rule);
    setText($('approval-settlement-rule'), rule);
    $('settlement-rule').dataset.windowSeconds = String(config.settlement_window_seconds);
  } catch {
    setText($('provider-label'), 'FORECAST PROVIDERS · UNAVAILABLE');
  }
}

async function requestForecast(challengeIntent = null) {
  if (requestInFlight || (currentPrediction && !currentPrediction.outcome) || agentIsDead) return;
  if (challengeIntent && !challengeIntentIsActive(challengeIntent)) {
    cancelChallengeIntent('Challenge preparation expired. No forecast was requested. Start again to create a fresh request.');
    return;
  }
  requestInFlight = true;
  busyControl ??= $('ask-button');
  setAvailableAction();
  showStatus('Checking recent market evidence and the settlement reference, then asking the configured model.', 'thinking');
  let approvalOpened = false;
  try {
    const response = await fetch('/api/forecast', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    const result = await response.json();
    if (result.status === 'published') {
      renderPrediction(result.prediction, result.model_id);
      if (challengeIntent) {
        if (challengeIntentIsActive(challengeIntent)) {
          openChallengeApproval();
          approvalOpened = $('challenge-dialog').open;
        } else {
          showStatus('The forecast was published after its challenge request expired. Review it without an automatic approval prompt.', 'published');
        }
      }
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
      showStatus(`Request cooldown · try again in about ${seconds} seconds.`, 'cooldown');
    } else if (result.status === 'rate_limited') {
      showStatus('Forecasting is temporarily unavailable because the daily model-call budget is exhausted.', 'unavailable');
    } else {
      showStatus(`No prediction was published. ${result.reason || 'A required provider is unavailable.'}`, 'unavailable');
    }
  } catch {
    showStatus('No prediction was published. The forecast service is unavailable.', 'unavailable');
  } finally {
    requestInFlight = false;
    if (challengeIntent && !approvalOpened) {
      if (activeChallengeIntent === challengeIntent) activeChallengeIntent = null;
      $('wallet-preparation').hidden = true;
    }
    setAvailableAction();
    restoreFocus();
    void refreshLife();
  }
}

async function retryPaymentForPrediction(predictionId) {
  const record = publicRecord.get(predictionId) || (currentPrediction?.id === predictionId ? currentPrediction : null);
  if (!record?.payment || record.payment.status !== 'pending' || paymentRetryInFlight) return;
  paymentRetryInFlight = true;
  // Acknowledge the press synchronously, before the receipt check goes out.
  renderPublicRecord();
  if (currentPrediction?.id === predictionId) {
    renderPaymentRecovery(currentPrediction);
    showStatus(`Recovering the recorded ${currentPrediction.outcome === 'void' ? 'refund' : 'payout'} without changing the final result. Payment is still pending until the transfer receipt confirms.`, 'payment-pending');
  }
  try {
    const response = await fetch('/api/payments/retry', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prediction_id: predictionId}),
    });
    const body = await response.json();
    if (body.prediction) {
      publicRecord.set(body.prediction.id, body.prediction);
      if (currentPrediction?.id === predictionId) renderPrediction(body.prediction);
    }
    if (!response.ok) throw new Error(body.error || 'Payment recovery was not accepted');
    if (currentPrediction?.id === predictionId && currentPrediction?.payment?.status === 'paid') {
      showStatus(`Prediction #${currentPrediction.id} payment confirmed on chain.`, 'resolved');
    } else if (currentPrediction?.id === predictionId) {
      showStatus(`Prediction #${currentPrediction.id} remains pending until its transfer receipt confirms.`, 'payment-pending');
    }
    renderPublicRecord();
  } catch {
    if (currentPrediction?.id === predictionId) {
      showStatus('Payment recovery was not accepted. The original beneficiary and liability remain recorded and payment is still pending.', 'payment-pending');
    }
    await refreshPublicRecord();
  } finally {
    paymentRetryInFlight = false;
    if (currentPrediction?.id === predictionId && currentPrediction.payment?.status === 'paid') $('state-region').focus({preventScroll: true});
    renderPublicRecord();
    if (currentPrediction?.id === predictionId) renderPaymentRecovery(currentPrediction);
    restoreFocus();
  }
}

async function retryPayment() {
  if (!currentPrediction?.payment || currentPrediction.payment.status !== 'pending' || paymentRetryInFlight) return;
  await retryPaymentForPrediction(currentPrediction.id);
}

$('ask-button').addEventListener('click', () => void beginChallengeForecast());
$('watch-button').addEventListener('click', () => {
  if (isBusy($('watch-button'))) return;
  busyControl = $('watch-button');
  void requestForecast();
});
$('fund-wallet-button').addEventListener('click', () => {
  if (!isBusy($('fund-wallet-button'))) void fundWalletForChallengeIntent();
});
$('cancel-wallet-preparation').addEventListener('click', () => cancelChallengeIntent('Challenge preparation cancelled. No forecast was requested.', 'cancelled'));
$('challenge-button').addEventListener('click', () => void openChallengeApproval());
$('approve-challenge').addEventListener('click', () => void approveChallenge());
$('cancel-challenge').addEventListener('click', cancelWalletApproval);
// Escape closes the dialog natively; route it through the same cancellation as the Cancel button.
$('challenge-dialog').addEventListener('cancel', event => {
  event.preventDefault();
  cancelWalletApproval();
});
$('retry-payment-button').addEventListener('click', () => {
  if (!isBusy($('retry-payment-button'))) void retryPayment();
});
$('record-more').addEventListener('click', () => void loadOlderPredictions());
void Promise.all([refreshLife(), refreshPrediction(), refreshPublicRecord(), loadConfiguration(), loadSandboxWallet(), refreshChainTimestamp()]);
globalThis.addEventListener('pagehide', () => { activeChallengeIntent = null; });
setInterval(() => void refreshLife(), 3_000);
setInterval(() => { void refreshPrediction(); void refreshPublicRecord(); }, 5_000);
setInterval(() => void refreshChainTimestamp(), 1_000);
