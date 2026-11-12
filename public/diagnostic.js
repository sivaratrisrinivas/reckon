const status = document.querySelector('#latest-status');
const evidence = document.querySelector('#latest-evidence');
try {
  const response = await fetch('/api/diagnostic/latest', {cache: 'no-store'});
  if (response.status === 404) {
    status.textContent = 'No repeatable probe has been run on this machine.';
  } else if (!response.ok) {
    throw new Error('Diagnostic unavailable');
  } else {
    const result = await response.json();
    status.textContent = result.status === 'observed'
      ? `Probe observed at ${result.started_at}. External observation time is not verified.`
      : `Probe unavailable at ${result.started_at}: ${result.reason ?? 'Unknown failure'}.`;
    evidence.hidden = false;
  }
} catch {
  status.textContent = 'Latest local probe is unavailable.';
}
