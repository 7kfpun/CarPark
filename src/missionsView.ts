import { canClaim, MISSIONS, progressFor, type MissionId, type Missions } from './missions';

/** Draws the daily mission list into `root`; `onClaim` is called with the mission id when its button is pressed. */
export function renderMissions(root: HTMLElement, m: Missions, money: number, onClaim: (id: MissionId) => void): void {
  root.replaceChildren();
  const head = document.createElement('h2');
  head.textContent = 'Daily missions';
  const bal = document.createElement('span');
  bal.textContent = `$${money}`;
  bal.setAttribute('aria-label', `${money} dollars`);
  head.append(bal);
  root.append(head);
  for (const d of MISSIONS) {
    const row = document.createElement('div');
    row.className = 'mission';
    const label = document.createElement('span');
    label.textContent = `${d.label} (${progressFor(m, d.id)}/${d.goal})`;
    const btn = document.createElement('button');
    btn.type = 'button';
    if (m.claimed.includes(d.id)) {
      btn.textContent = 'Claimed';
      btn.disabled = true;
    } else {
      btn.textContent = `Claim $${d.reward}`;
      btn.disabled = !canClaim(m, d.id);
      btn.addEventListener('click', () => onClaim(d.id));
    }
    row.append(label, btn);
    root.append(row);
  }
}
