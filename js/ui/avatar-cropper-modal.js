import { isAllowedImageFormat, loadImage } from '../utils/auth/image-file.js';
/**
 * Модальне вікно інтерактивного обрізання (crop & zoom) аватарки.
 * Працює на базі нативного <dialog> та HTML5 Canvas.
 * Підтримує перетягування мишкою й тачем, масштабування повзунком/коліщатком
 * та експортує фінальний 256×256 Blob (WebP/JPEG).
 */

const OUTPUT_SIZE = 256;
const PREVIEW_SIZE = 280; // розмір інтерактивного полотна в модалі

let dialogEl = null;
let canvasEl = null;
let sliderEl = null;
let currentResolve = null;
let openToken = 0; // I-6: номер останнього виклику openAvatarCropper(): застарілі виклики не чіпають спільний стан

let imgSource = null;
let imgWidth = 0;
let imgHeight = 0;
let baseScale = 1;
let currentZoom = 1; // 1.0 ... 3.0
let panX = 0;
let panY = 0;

let isDragging = false;
let startPointerX = 0;
let startPointerY = 0;
let startPanX = 0;
let startPanY = 0;

function createDialogHtml() {
  const dialog = document.createElement('dialog');
  dialog.id = 'avatar-crop-modal';
  dialog.className = 'avatar-crop-dialog';
  dialog.setAttribute('closedby', 'any');
  dialog.setAttribute('aria-labelledby', 'avatar-crop-title');

  dialog.innerHTML = `
    <div class="avatar-crop-card">
      <div class="avatar-crop-header">
        <h3 id="avatar-crop-title">Налаштування аватарки</h3>
        <p class="avatar-crop-subtitle">Перетягніть фото та налаштуйте масштаб</p>
      </div>

      <div class="avatar-crop-canvas-wrap">
        <canvas id="avatar-crop-canvas" width="${PREVIEW_SIZE}" height="${PREVIEW_SIZE}"></canvas>
      </div>

      <div class="avatar-crop-zoom-row">
        <button type="button" class="avatar-crop-zoom-btn" id="avatar-crop-zoom-out" aria-label="Зменшити">−</button>
        <input type="range" id="avatar-crop-zoom-slider" min="1" max="3" step="0.02" value="1" aria-label="Масштаб фото">
        <button type="button" class="avatar-crop-zoom-btn" id="avatar-crop-zoom-in" aria-label="Збільшити">+</button>
      </div>

      <div class="avatar-crop-actions">
        <button type="button" class="avatar-crop-btn avatar-crop-btn--cancel" id="avatar-crop-cancel-btn">Скасувати</button>
        <button type="button" class="avatar-crop-btn avatar-crop-btn--apply" id="avatar-crop-apply-btn">Застосувати</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
  return dialog;
}

function initDialog() {
  if (dialogEl) return;
  dialogEl = createDialogHtml();
  canvasEl = dialogEl.querySelector('#avatar-crop-canvas');
  sliderEl = dialogEl.querySelector('#avatar-crop-zoom-slider');

  // Fallback для закриття кліком по backdrop (якщо браузер ще не підтримує closedby="any")
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialogEl.addEventListener('click', (e) => {
      if (e.target !== dialogEl) return;
      const rect = dialogEl.getBoundingClientRect();
      const isInside = (
        rect.top <= e.clientY && e.clientY <= rect.bottom &&
        rect.left <= e.clientX && e.clientX <= rect.right
      );
      if (!isInside) closeDialog(null);
    });
  }

  // Обробка Esc / cancel
  dialogEl.addEventListener('cancel', () => closeDialog(null));

  dialogEl.querySelector('#avatar-crop-cancel-btn').addEventListener('click', () => closeDialog(null));
  dialogEl.querySelector('#avatar-crop-apply-btn').addEventListener('click', () => applyCrop());

  // Зум повзунком
  sliderEl.addEventListener('input', () => {
    currentZoom = parseFloat(sliderEl.value) || 1;
    clampPan();
    renderCrop();
  });

  // Кнопки зуму - / +
  dialogEl.querySelector('#avatar-crop-zoom-out').addEventListener('click', () => {
    currentZoom = Math.max(1, currentZoom - 0.2);
    sliderEl.value = currentZoom;
    clampPan();
    renderCrop();
  });
  dialogEl.querySelector('#avatar-crop-zoom-in').addEventListener('click', () => {
    currentZoom = Math.min(3, currentZoom + 0.2);
    sliderEl.value = currentZoom;
    clampPan();
    renderCrop();
  });

  // Зум колесом миші над canvas
  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    currentZoom = Math.min(3, Math.max(1, currentZoom + delta));
    sliderEl.value = currentZoom;
    clampPan();
    renderCrop();
  }, { passive: false });

  // Перетягування (Pointer Events - миша й тач-палець)
  canvasEl.addEventListener('pointerdown', (e) => {
    isDragging = true;
    startPointerX = e.clientX;
    startPointerY = e.clientY;
    startPanX = panX;
    startPanY = panY;
    canvasEl.setPointerCapture(e.pointerId);
  });

  canvasEl.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startPointerX;
    const dy = e.clientY - startPointerY;
    panX = startPanX + dx;
    panY = startPanY + dy;
    clampPan();
    renderCrop();
  });

  const stopDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    try { canvasEl.releasePointerCapture(e.pointerId); } catch (err) {}
  };

  canvasEl.addEventListener('pointerup', stopDrag);
  canvasEl.addEventListener('pointercancel', stopDrag);
}

// Обмежуємо зсув, щоб зображення завжди закривало круглий сектор
function clampPan() {
  if (!imgSource) return;
  const scale = baseScale * currentZoom;
  const drawW = imgWidth * scale;
  const drawH = imgHeight * scale;

  // Радіус круга в центрі полотна
  const radius = (PREVIEW_SIZE * 0.88) / 2;
  const cx = PREVIEW_SIZE / 2;
  const cy = PREVIEW_SIZE / 2;

  // Межі, за які не повинен виходити край картинки відносно круга
  const maxPanX = (drawW / 2) - radius;
  const minPanX = -maxPanX;
  const maxPanY = (drawH / 2) - radius;
  const minPanY = -maxPanY;

  panX = Math.min(maxPanX, Math.max(minPanX, panX));
  panY = Math.min(maxPanY, Math.max(minPanY, panY));
}

function renderCrop() {
  if (!canvasEl || !imgSource) return;
  const ctx = canvasEl.getContext('2d');
  const w = PREVIEW_SIZE;
  const h = PREVIEW_SIZE;

  ctx.clearRect(0, 0, w, h);

  // Фон під полотном
  ctx.fillStyle = '#0a0c12';
  ctx.fillRect(0, 0, w, h);

  // 1. Малюємо саму картинку з масштабом та зсувом
  const scale = baseScale * currentZoom;
  const drawW = imgWidth * scale;
  const drawH = imgHeight * scale;
  const drawX = (w / 2) + panX - (drawW / 2);
  const drawY = (h / 2) + panY - (drawH / 2);

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imgSource, drawX, drawY, drawW, drawH);

  // 2. Малюємо затемнену маску навколо круглого видошукача
  const radius = (PREVIEW_SIZE * 0.88) / 2;
  const cx = w / 2;
  const cy = h / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(10, 12, 18, 0.72)';
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  // вирізаємо коло проти годинникової стрілки (evenodd-ефект)
  ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();

  // 3. Тонка рамка видошукача
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--hazard').trim() || '#f0a868'; // колір акценту поточної теми
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Пунктирна сітка всередині круга для центрування
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  ctx.restore();
}

function closeDialog(resultBlob) {
  if (imgSource && typeof imgSource.close === 'function') {
    imgSource.close();
  }
  imgSource = null;
  if (dialogEl && dialogEl.open) {
    dialogEl.close();
  }
  if (currentResolve) {
    const res = currentResolve;
    currentResolve = null;
    res(resultBlob);
  }
}

async function applyCrop() {
  if (!imgSource) return closeDialog(null);

  try {
    // Експортуємо саме круглий сектор у 256×256
    const outCanvas = document.createElement('canvas');
    outCanvas.width = OUTPUT_SIZE;
    outCanvas.height = OUTPUT_SIZE;
    const outCtx = outCanvas.getContext('2d');

    outCtx.fillStyle = '#10121a';
    outCtx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const scale = baseScale * currentZoom;
    const radiusInPreview = (PREVIEW_SIZE * 0.88) / 2;
    const diameterInPreview = radiusInPreview * 2;

    // Співвідношення між PREVIEW діаметром та вихідним розміром (256)
    const factor = OUTPUT_SIZE / diameterInPreview;

    const drawW = imgWidth * scale * factor;
    const drawH = imgHeight * scale * factor;
    const drawX = (OUTPUT_SIZE / 2) + (panX * factor) - (drawW / 2);
    const drawY = (OUTPUT_SIZE / 2) + (panY * factor) - (drawH / 2);

    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(imgSource, drawX, drawY, drawW, drawH);

    // Спроба WebP із якістю 0.88, запасний варіант - JPEG
    const blob = await new Promise(resolve => {
      outCanvas.toBlob(b => {
        if (b && b.type === 'image/webp') return resolve(b);
        outCanvas.toBlob(resolve, 'image/jpeg', 0.88);
      }, 'image/webp', 0.88);
    });

    closeDialog(blob || null);
  } catch (err) {
    console.error('Не вдалося експортувати обрізане фото:', err);
    closeDialog(null);
  }
}

/**
 * Відкриває діалог обрізання для обраного файлу.
 * @param {File|Blob} file
 * @returns {Promise<Blob|null>} Обрізаний Blob або null у разі скасування
 */
export async function openAvatarCropper(file) {
  if (!isAllowedImageFormat(file)) {
    throw new Error('Дозволені лише формати JPEG, PNG, WebP');
  }

  initDialog();

  // I-6: новий виклик скасовує попередній (його проміс завершується null, а не висить назавжди)
  const token = ++openToken;
  if (currentResolve) closeDialog(null);

  const loaded = await loadImage(file, { maxDimension: 1920 });
  if (token !== openToken) { // поки читали файл, нас витіснив новіший виклик
    if (typeof loaded.close === 'function') loaded.close();
    return null;
  }
  imgSource = loaded;
  imgWidth = imgSource.width || imgSource.naturalWidth;
  imgHeight = imgSource.height || imgSource.naturalHeight;

  if (!imgWidth || !imgHeight) {
    imgSource = null;
    if (typeof loaded.close === 'function') loaded.close();
    throw new Error('Не вдалося визначити розміри зображення');
  }

  // Мінімальний масштаб, щоб картинка повністю перекривала круглий видошукач
  const cropDiameter = PREVIEW_SIZE * 0.88;
  const minSide = Math.min(imgWidth, imgHeight);
  baseScale = cropDiameter / minSide;
  currentZoom = 1;
  panX = 0;
  panY = 0;

  sliderEl.value = 1;
  renderCrop();

  return new Promise((resolve) => {
    currentResolve = resolve;
    dialogEl.showModal();
  });
}

