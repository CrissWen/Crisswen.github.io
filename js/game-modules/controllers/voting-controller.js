import { supabase } from '../../services/supabase.js';
import { finishVoting } from '../../utils/host-actions.js';
import { showGlobalToast } from '../overlays/global-toast.js';

// ===== Поведінка голосування на сторінці гри (мережа, скрол, автозавершення) =====
// Розмітка блоку — у voting.js. Стан модуля нижче живе лише в пам'яті вкладки; ctx — з game.js.

let wasVotingActive = false; // щоб автоскрол до #voting-section спрацював рівно один раз на кожне запускання голосування, а не при кожному рендері
let votingFinishInFlight = false; // щоб декілька швидких postgres_changes підряд не відправили кілька паралельних finishVoting

// Скидання при виході зі сторінки гри
export function resetVotingState() {
  wasVotingActive = false;
  votingFinishInFlight = false;
}

// Скролить до #voting-section рівно один раз на кожне "запускання" голосування (перехід isActive false→true) для
// живого гравця, який ще не проголосував — а не на кожен renderActiveGame() (він перевиконується на
// КОЖНЕ оновлення кімнати, навіть не пов'язане з голосуванням, інакше екран смикався б при кожній дії ведучого).
export function syncVotingScroll(pState, bState, ctx) {
  const userId = ctx.getUserId();
  const isActive = !!bState?.voting?.isActive;
  const amAlive = !ctx.isSpectator() && pState?.[userId]?.is_alive !== false;
  const myVote = bState?.voting?.votes?.[userId];

  if (isActive && !wasVotingActive && amAlive && !myVote) {
    requestAnimationFrame(() => {
      document.getElementById('voting-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  wasVotingActive = isActive;
}

// Живий клієнт ведучого ("майстер-клієнт") на кожне оновлення кімнати перевіряє, чи проголосували всі живі, і,
// якщо так — сам пише voting.isActive = false в БД. Лише ведучий (а не кожен гравець), щоб не було
// гонки кількох одночасних UPDATE від різних клієнтів у момент, коли останній голос щойно прийшов по WebSocket.
export function maybeAutoFinishVoting(roomData, ctx) {
  if (roomData.host_id !== ctx.getUserId()) return;

  const voting = roomData.bunker_state?.voting;
  if (!voting?.isActive) return;

  const aliveCount = Object.values(roomData.players_state || {}).filter(p => p.is_alive !== false).length;
  const votedCount = Object.keys(voting.votes || {}).length;
  if (aliveCount === 0 || votedCount !== aliveCount) return;

  if (votingFinishInFlight) return;
  votingFinishInFlight = true;
  finishVoting(ctx.getRoomCode())
    .catch(err => console.error('Не вдалося автозавершити голосування:', err))
    .finally(() => { votingFinishInFlight = false; });
}

// Клік по радіо-плитці кандидата — розблоковує кнопку "Проголосувати" в тому ж блоці #voting-section.
export function handleVoteRadioChange(e) {
  if (e.target.name !== 'vote') return;
  const btn = e.target.closest('#voting-section')?.querySelector('[data-vote-submit]');
  if (btn) btn.disabled = false;
}

// Запис голосу — звичайний UPDATE кімнати (як і решта механік гри), без RPC. Голосує рядовий гравець,
// а не ведучий, тож прямий запис у bunker_state має працювати незалежно від того, чи застосовано
// host-rls.sql (там UPDATE дозволений лише host_id = auth.uid()) — окрема RLS-політика на голосування
// має дозволяти будь-якому гравцю кімнати оновлювати лише bunker_state.voting.votes.
export async function handleVoteSubmit(btn, ctx) {
  if (ctx.isSpectator()) return; // глядач не голосує
  const section = btn.closest('#voting-section');
  const checked = section?.querySelector('input[name="vote"]:checked');
  if (!checked) return;

  const candidateId = checked.value;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Голосуємо...';

  try {
    // Читаємо свіжий bunker_state прямо перед записом, щоб не затерти голос когось,
    // хто проголосував між останнім Realtime-оновленням локального стейту і цим кліком.
    const { data: room, error: fetchError } = await supabase
      .from('rooms')
      .select('bunker_state')
      .eq('room_code', ctx.getRoomCode())
      .single();
    if (fetchError || !room) throw new Error(fetchError?.message || 'Кімнату не знайдено');

    const bunker_state = room.bunker_state || {};
    if (!bunker_state.voting?.isActive) throw new Error('Голосування вже завершено');

    bunker_state.voting.votes = { ...bunker_state.voting.votes, [ctx.getUserId()]: candidateId };

    const { error } = await supabase
      .from('rooms')
      .update({ bunker_state })
      .eq('room_code', ctx.getRoomCode());
    if (error) throw new Error(error.message);

    // Локально відразу відмічаємо свій голос: не чекаємо round-trip через WebSocket, а перемальовуємо
    // дошку зараз — voting.js сам сховає сітку кандидатів і покаже зелену панель "Ви проголосували..."
    // (стан визначається наявністю bunker_state.voting.votes[currentUserId]).
    const roomState = ctx.getRoomState();
    if (roomState) {
      roomState.bunker_state = bunker_state;
      ctx.refreshBoard();
    }
  } catch (err) {
    console.error('Не вдалося проголосувати:', err);
    showGlobalToast(err.message || 'Не вдалося проголосувати');
    btn.disabled = false;
    btn.textContent = original;
  }
}
