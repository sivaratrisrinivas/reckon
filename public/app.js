const $ = (id) => document.getElementById(id);
let currentPrediction = null;
let providerMode = 'fixture';
let agentIsDead = false;
let requestInFlight = false;

function near(amount) {
  const value = BigInt(amount);
  const whole = value / 10n ** 24n;
  const fraction = (value % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return `${whole}.${fraction || '0'} NEAR`;
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

function renderPrediction(prediction, evidenceUrl, modelId) {
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
  $('evidence-link').href = evidenceUrl || `/api/evidence/${prediction.evidence_hash}`;
  $('hosting-note').textContent = 'This local snapshot is kept on the sandbox service filesystem and can be downloaded here. It has not been published to durable public hosting.';
  showStatus(`Prediction #${prediction.id} is published. Its reference, confidence, stakes, and deadlines are fixed.`, 'published');
}

async function getJson(path) {
  const response = await fetch(path, {cache: 'no-store'});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unavailable');
  return body;
}

async function refreshLife() {
  try {
    const life = await getJson('/api/life');
    $('remaining').textContent = duration(life.remaining_life_ns);
    agentIsDead = life.dead;
    $('life-state').textContent = life.dead ? 'Depleted · permanently dead' : 'Alive · upkeep continues';
    $('spendable').textContent = near(life.spendable_bankroll);
    $('retired').textContent = near(life.retired_bankroll);
    $('reserve').textContent = near(life.operational_reserve);
    const percentage = Number(BigInt(life.remaining_life_ns) * 10_000n / BigInt(life.idle_life_ns)) / 100;
    $('meter').style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    if (agentIsDead) setAvailableAction();
  } catch {
    $('life-state').textContent = 'Sandbox unavailable · reconnecting';
    $('remaining').textContent = '—';
    for (const id of ['spendable', 'retired', 'reserve']) $(id).textContent = '—';
    $('meter').style.width = '0%';
  }
}

async function refreshPrediction() {
  try {
    const {prediction} = await getJson('/api/predictions/active');
    if (prediction && (!currentPrediction || currentPrediction.id !== prediction.id)) {
      renderPrediction(prediction);
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
      renderPrediction(result.prediction, result.evidence_url, result.model_id);
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
void Promise.all([refreshLife(), refreshPrediction(), loadConfiguration()]);
setInterval(() => void refreshLife(), 3_000);
setInterval(() => void refreshPrediction(), 5_000);
