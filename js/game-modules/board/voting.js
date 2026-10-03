// Блок голосування "Кого виключити з бункера?" — рендериться під таблицею спец. можливостей.
// Джерело правди: bunker_state.voting = { isActive: boolean, votes: { [voterId]: candidateId } }.
//
// Стани (у порядку пріоритету):
//   1. Голосування ЗАВЕРШЕНО (isActive === false, але votes непорожній) — таблиця результатів,
//      видима ВСІМ (і живим, і вибулим) для обговорення, доки ведучий не запустить нове голосування.
//   2. Голосування йде, гравець вибув або сам не бере участі — секція порожня.
//   3. Голосування йде, гравець живий і вже проголосував — панель очікування.
//   4. Голосування йде, гравець живий і ще не голосував — форма вибору кандидата.
//   5. Голосування ще не запускалось — секція порожня.

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function candidateTile(id, name) {
  return `
    <label class="vote-tile">
      <input type="radio" name="vote" value="${esc(id)}" class="vote-tile__input">
      <span class="vote-tile__name">${esc(name)}</span>
    </label>
  `;
}

function nameOf(players, id) {
  return players.find(p => p.id === id)?.name || 'Гравець';
}

// Таблиця на 3 колонки: кандидат / хто голосував (через кому) / % від живих гравців.
// Кандидати з 0 голосів не виводяться. aliveCount — ЗНАМЕННИК відсотка: живі гравці НА МОМЕНТ рендеру
// (а не на момент голосування) — так відсоток лишається коректним, навіть якщо хтось вибув між голосуванням і переглядом.
function resultsTableHtml(votes, players, aliveCount) {
  const tally = {};
  Object.entries(votes).forEach(([voterId, candidateId]) => {
    (tally[candidateId] ||= []).push(voterId);
  });

  const rows = Object.entries(tally)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([candidateId, voterIds]) => {
      const percent = aliveCount > 0 ? Math.round((voterIds.length / aliveCount) * 100) : 0;
      return `
        <tr>
          <td>${esc(nameOf(players, candidateId))}</td>
          <td>${voterIds.map(id => esc(nameOf(players, id))).join(', ')}</td>
          <td>${percent}%</td>
        </tr>
      `;
    }).join('');

  return `
    <section id="voting-section" class="voting-block">
      <h3 class="voting-block__title">Результати голосування</h3>
      <div class="vote-results-wrap">
        <table class="vote-results-table">
          <thead>
            <tr><th>Гравець</th><th>Хто проголосував</th><th>Відсоток</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

// ===== Збереження локального (ще не відправленого) вибору при перемальовуванні дошки =====
// Коли будь-хто в кімнаті голосує (або змінюється будь-що інше), Realtime присилає оновлення, і game.js перемальовує
// всю дошку через innerHTML — радіокнопки створюються заново без checked, і вибір гравця зникає.
// captureVoteSelection() викликається ПЕРЕД перемалюванням, restoreVoteSelection() — ПІСЛЯ.
let savedVoteSelection = null;

export function captureVoteSelection() {
  const checked = document.querySelector('#voting-section .vote-tile__input:checked');
  savedVoteSelection = checked ? checked.value : null;
}

export function restoreVoteSelection() {
  const saved = savedVoteSelection;
  savedVoteSelection = null; // одноразово: наступне перемальовування знову почнеться з capture
  if (!saved) return;

  const section = document.getElementById('voting-section');
  // Шукаємо порівнянням value, а не селектором [value="..."] — щоб незвичні символи в id не ламали запит
  const input = [...(section?.querySelectorAll('.vote-tile__input') || [])].find(i => i.value === saved);

  // Якщо кандидата вже немає (вибув), або голосування завершилось — нічого не відновлюємо, кнопка лишається disabled
  if (!input) return;
  input.checked = true;
  const submitBtn = section.querySelector('.vote-submit-btn');
  if (submitBtn) submitBtn.disabled = false; // у новому HTML вона знову disabled за замовчуванням
}

// votingSection({ voting, players, myId, amAlive })
//   voting   — bunker_state.voting (може бути відсутнім)
//   players  — [{ id, name, alive }] ВСІ гравці кімнати (і живі, і вибулі — для мапінгу ID -> ім'я в результатах)
//   myId     — currentUserId
//   amAlive  — чи живий сам гравець
export function votingSection({ voting, players = [], myId, amAlive }) {
  const votes = voting?.votes || {};
  const hasVotes = Object.keys(votes).length > 0;
  const isActive = !!voting?.isActive;
  const aliveList = players.filter(p => p.alive);

  // 1. Завершено — результати бачать усі, незалежно від amAlive
  if (!isActive && hasVotes) {
    return resultsTableHtml(votes, players, aliveList.length);
  }

  // 2./5. Не активне (і ще не було голосів) або гравець вибув — порожня секція (id лишається в DOM)
  if (!isActive || !amAlive) {
    return `<section id="voting-section"></section>`;
  }

  const myVote = votes[myId];

  // 3. Уже проголосував — панель очікування
  if (myVote) {
    return `
      <section id="voting-section" class="voting-block">
        <div class="vote-success-panel">
          <span class="vote-success-panel__icon" aria-hidden="true">✓</span>
          <p>Ви проголосували. Очікуємо інших гравців...</p>
        </div>
      </section>
    `;
  }

  // 4. Форма вибору кандидата
  const candidates = aliveList.filter(p => p.id !== myId);

  if (!candidates.length) {
    return `
      <section id="voting-section" class="voting-block">
        <h3 class="voting-block__title">Голосування</h3>
        <p class="voting-block__empty">Немає кандидатів для голосування.</p>
      </section>
    `;
  }

  return `
    <section id="voting-section" class="voting-block">
      <h3 class="voting-block__title">Голосування: кого виключити з бункера?</h3>
      <div class="vote-grid">
        ${candidates.map(p => candidateTile(p.id, p.name)).join('')}
      </div>
      <button type="button" class="vote-submit-btn" data-vote-submit disabled>Проголосувати</button>
    </section>
  `;
}
