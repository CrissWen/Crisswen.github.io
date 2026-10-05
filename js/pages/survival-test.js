// Тест "Оцінка виживання бункера" — окрема сторінка (survival-test.html), відкривається з гри в НОВІЙ вкладці.
// З решти гри імпортує лише config-manager (числа тесту — секція survivalTest у game-config.base.js / .local.js)
// і не звертається до Supabase: усе рахується локально в цій вкладці.
// (Хедер сторінки живе в survival-test-header.js — він єдиний читає сесію, лише для імені в профілі.)
import { getGameConfig } from '../config/config-manager.js';
//
// ЛОГІКА
//   Крок 1: їжа.              «Ні» -> фінал "голод"
//   Крок 2: хвороби/ізоляція. «Ні» -> фінал "загибель"
//   Крок 3: ворожий бункер.   «Немає можливості відбитися» -> фінал "захоплення"
//   Крок 4: решта питань списком + «Дізнатися результат» (бали сумуються)
// Усі відповіді за замовчуванням — «Ні» (останній варіант), тому «Далі» активна завжди.
// Бали користувач не бачить — вони лише вирішують, який із двох фіналів показати наприкінці.
// Поріг успіху і вага відповіді — у конфігу (survivalTest.passScore / survivalTest.goodAnswerPoints).

const YES_NO = [
  { value: 'yes', label: 'Так' },
  { value: 'no', label: 'Ні' }
];
const GOOD_BAD = [
  { value: 'yes', label: 'Так, порядок', good: true },
  { value: 'no', label: 'Нажаль, ні', good: false }
];

// Кроки з раннім виходом: якщо обрано failValue — одразу фінал failResult, без подальших питань
const GATE_STEPS = [
  {
    id: 'food',
    text: 'Вам вистачає їжі на весь період (включно з відіграшем здобуття їжі)?',
    options: YES_NO,
    defaultValue: 'no',
    failValue: 'no',
    failResult: 'hunger'
  },
  {
    id: 'infection',
    text: 'Усі небезпечні та заразні вцілілі ізольовані, або є людина/предмет, який може врятувати решту?',
    options: YES_NO,
    defaultValue: 'no',
    failValue: 'no',
    failResult: 'doom'
  },
  {
    id: 'enemy',
    text: 'За наявності ворожого бункера: чи є зброя або боєздатна людина (військовий, знає бойові мистецтва чи подібне)?',
    options: [
      { value: 'none', label: 'Ворожих бункерів немає' },
      { value: 'armed', label: 'Є ворожий бункер, але є зброя / боєздатна людина (військовий / знає бойові мистецтва / подібне)' },
      { value: 'defenseless', label: 'Є ворожий бункер і немає можливості відбитися' }
    ],
    defaultValue: 'defenseless',
    failValue: 'defenseless',
    failResult: 'captured'
  }
];

// Загальний тест — одним списком на останньому екрані (балується)
const LIST_QUESTIONS = [
  { id: 'disabled', text: 'Половина вцілілих від загальної кількості тих, хто зайшов у бункер, не інваліди?' },
  { id: 'fragile', text: 'Половина вцілілих від загальної кількості тих, хто зайшов у бункер, не тендітні й без ожиріння?' },
  { id: 'elderly', text: 'Половина вцілілих від загальної кількості тих, хто зайшов у бункер, не літні?' },
  { id: 'negative', text: 'Половина вцілілих від загальної кількості тих, хто зайшов у бункер, не мають негативної людської риси?' },
  { id: 'profession', text: 'Чи є хоча б 2 вцілілих від загальної кількості тих, хто зайшов у бункер, з корисною професією?' },
  { id: 'hobby', text: 'Чи є хоча б 2 вцілілих від загальної кількості тих, хто зайшов у бункер, з корисним хобі?' },
  { id: 'inventory', text: 'Чи є хоча б 2 вцілілих від загальної кількості тих, хто зайшов у бункер, з корисним інвентарем?' },
  { id: 'info', text: 'Чи є хоча б 2 вцілілих від загальної кількості тих, хто зайшов у бункер, з корисними дод. відомостями?' },
  { id: 'couple', text: 'Чи є хоча б одна пара для продовження роду або є діти?' },
  { id: 'friendly', text: 'Чи є дружній бункер (зокрема з будівельниками, медиками, жінками, чоловіками)?' },
  { id: 'problems', text: 'Проблеми в бункері відсутні, вирішені (зокрема безхатько)?' }
].map(q => ({ ...q, options: GOOD_BAD, defaultValue: 'no' }));

const RESULTS = {
  hunger: {
    tone: 'bad',
    lines: [
      'З часом мешканці бункера померли від голоду….',
      'Можливо, варто було інакше обирати претендентів на прохід до бункера'
    ]
  },
  doom: {
    tone: 'bad',
    lines: ['Нажаль! Швидше за все ваш бункер незабаром загине…']
  },
  captured: {
    tone: 'bad',
    lines: [
      'Ваш бункер згодом захопили вороги, а мешканці не зуміли дати відсіч… Ніхто не вижив.',
      'Можливо, варто було подбати про зброю або обрати тих, хто вміє захищатися'
    ]
  },
  success: {
    tone: 'good',
    lines: ['Вітаємо! Усім мешканцям вдалося вижити, і, можливо, саме ваша база стане початком нової цивілізації в майбутньому']
  }
};

// ---------- Стан ----------
// step: 0..GATE_STEPS.length-1 (кроки з раннім виходом), GATE_STEPS.length (список), 'result'
let step = 0;
let resultKey = null;
let answers = createDefaultAnswers();

function createDefaultAnswers() {
  const a = {};
  [...GATE_STEPS, ...LIST_QUESTIONS].forEach(q => { a[q.id] = q.defaultValue; });
  return a;
}

const root = document.getElementById('survival-test');

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ---------- Підрахунок ----------
async function computeFinalResult() {
  const { passScore, goodAnswerPoints } = (await getGameConfig()).survivalTest;
  const score = LIST_QUESTIONS.reduce((sum, q) => {
    const picked = q.options.find(o => o.value === answers[q.id]);
    return sum + (picked?.good ? goodAnswerPoints : 0);
  }, 0);
  return score >= passScore ? 'success' : 'doom';
}

// ---------- Рендер ----------
function questionHtml(q) {
  const options = q.options.map(o => `
    <label class="st-option">
      <input type="radio" name="${esc(q.id)}" value="${esc(o.value)}" ${answers[q.id] === o.value ? 'checked' : ''}>
      <span>${esc(o.label)}</span>
    </label>`).join('');
  return `
    <fieldset class="st-card">
      <legend class="st-question">${esc(q.text)}</legend>
      ${options}
    </fieldset>`;
}

function render() {
  if (step === 'result') {
    const res = RESULTS[resultKey];
    root.innerHTML = `
      <div class="st-card st-result st-result--${res.tone}" role="status">
        ${res.lines.map(esc).join('<br>')}
      </div>
      <button type="button" class="st-btn st-restart" data-action="restart">Пройти заново</button>`;
    return;
  }

  const isList = step === GATE_STEPS.length;
  const body = isList ? LIST_QUESTIONS.map(questionHtml).join('') : questionHtml(GATE_STEPS[step]);

  const back = step > 0 ? '<button type="button" class="st-btn st-btn--ghost" data-action="back">Назад</button>' : '';
  const next = isList
    ? '<button type="button" class="st-btn st-btn--result" data-action="finish">Дізнатися результат</button>'
    : '<button type="button" class="st-btn" data-action="next">Далі</button>';

  root.innerHTML = `${body}<div class="st-actions">${back}${next}</div>`;
  window.scrollTo({ top: 0 });
}

// ---------- Події ----------
function goNext() {
  const gate = GATE_STEPS[step];
  if (gate && answers[gate.id] === gate.failValue) {
    resultKey = gate.failResult; // ранній вихід
    step = 'result';
    return render();
  }
  step += 1;
  render();
}

function goBack() {
  if (typeof step === 'number' && step > 0) {
    step -= 1;
    render();
  }
}

async function finish() {
  resultKey = await computeFinalResult();
  step = 'result';
  render();
}

function restart() {
  answers = createDefaultAnswers();
  resultKey = null;
  step = 0;
  render();
}

root.addEventListener('change', (e) => {
  const input = e.target.closest('input[type="radio"]');
  if (input) answers[input.name] = input.value;
});

root.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'next') goNext();
  else if (action === 'back') goBack();
  else if (action === 'finish') finish();
  else if (action === 'restart') restart();
});

render();
