const $ = (id) => document.getElementById(id);
const near = (amount) => `${(Number(BigInt(amount) / 10n ** 20n) / 10000).toFixed(4)} NEAR`;
function duration(ns) {
  const seconds = Number(BigInt(ns) / 1000000000n);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
async function refresh() {
  try {
    const response = await fetch('/api/life', {cache: 'no-store'});
    if (!response.ok) throw new Error('Unavailable');
    const life = await response.json();
    $('remaining').textContent = duration(life.remaining_life_ns);
    $('state').textContent = life.dead ? 'Depleted · permanently dead' : 'Alive · upkeep continues';
    $('spendable').textContent = near(life.spendable_bankroll);
    $('retired').textContent = near(life.retired_bankroll);
    $('reserve').textContent = near(life.operational_reserve);
    $('meter').style.width = `${Math.max(0, Math.min(100, Number(BigInt(life.remaining_life_ns) * 10000n / BigInt(life.idle_life_ns)) / 100))}%`;
  } catch {
    $('state').textContent = 'Sandbox unavailable · reconnecting';
    $('remaining').textContent = '—';
    for (const id of ['spendable', 'retired', 'reserve']) $(id).textContent = '—';
    $('meter').style.width = '0%';
  }
}
void refresh();
setInterval(refresh, 3000);
