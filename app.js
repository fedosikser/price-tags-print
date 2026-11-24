const { PDFDocument, rgb } = PDFLib;

const MM = 72 / 25.4;
const A4_WIDTH = 297 * MM;
const A4_HEIGHT = 210 * MM;
const GAP = 8 * MM;
const state = { files: [] };

const dropzone = document.querySelector('#dropzone');
const picker = document.querySelector('#picker');
const list = document.querySelector('#files');
const count = document.querySelector('#count');
const sheets = document.querySelector('#sheets');
const generate = document.querySelector('#generate');
const status = document.querySelector('#status');
const scale = document.querySelector('#scale');
const scaleValue = document.querySelector('#scale-value');
let draggedIndex = null;

function humanSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function render() {
  list.innerHTML = '';
  if (!state.files.length) list.innerHTML = '<p class="empty">Пока ничего не добавлено.</p>';

  state.files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file';
    item.draggable = true;
    item.dataset.index = index;
    item.innerHTML = `
      <span class="handle" title="Перетащите, чтобы изменить порядок">⋮⋮</span>
      <span class="file-name"></span>
      <button class="remove" type="button" aria-label="Удалить">×</button>`;

    const name = item.querySelector('.file-name');
    name.textContent = file.name;
    const size = document.createElement('span');
    size.className = 'file-size';
    size.textContent = humanSize(file.size);
    name.appendChild(size);

    item.querySelector('.remove').addEventListener('click', () => {
      state.files.splice(index, 1);
      render();
    });
    item.addEventListener('dragstart', () => {
      draggedIndex = index;
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      draggedIndex = null;
      item.classList.remove('dragging');
    });
    item.addEventListener('dragover', event => event.preventDefault());
    item.addEventListener('drop', event => {
      event.preventDefault();
      if (draggedIndex === null || draggedIndex === index) return;
      const [moved] = state.files.splice(draggedIndex, 1);
      state.files.splice(index, 0, moved);
      render();
    });
    list.appendChild(item);
  });

  count.textContent = state.files.length;
  sheets.textContent = Math.ceil(state.files.length / 2);
  generate.disabled = state.files.length === 0;
  status.className = 'status';
  status.textContent = state.files.length
    ? `Будет создано листов: ${Math.ceil(state.files.length / 2)}.`
    : 'Добавьте PDF-файлы.';
}

function addFiles(fileList) {
  const pdfs = [...fileList].filter(file =>
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
  state.files.push(...pdfs);
  render();
}

dropzone.addEventListener('click', event => {
  if (event.target.closest('button')) return;
  picker.click();
});
document.querySelector('#choose-files').addEventListener('click', event => {
  event.stopPropagation();
  picker.click();
});
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') picker.click();
});
picker.addEventListener('change', () => {
  addFiles(picker.files);
  picker.value = '';
});
['dragenter', 'dragover'].forEach(name => dropzone.addEventListener(name, event => {
  event.preventDefault();
  dropzone.classList.add('drag');
}));
['dragleave', 'drop'].forEach(name => dropzone.addEventListener(name, event => {
  event.preventDefault();
  dropzone.classList.remove('drag');
}));
dropzone.addEventListener('drop', event => addFiles(event.dataTransfer.files));
document.querySelector('#clear').addEventListener('click', () => {
  state.files = [];
  render();
});
scale.addEventListener('input', () => {
  scaleValue.textContent = `${scale.value}%`;
});

async function readAndValidate(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let source;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new Error(`${file.name}: не удалось открыть PDF.`);
  }

  if (source.isEncrypted) throw new Error(`${file.name}: PDF защищён паролем.`);
  const pages = source.getPages();
  if (pages.length !== 1) {
    throw new Error(
      `${file.name}: найдено страниц — ${pages.length}. Нужен отдельный одностраничный PDF одного ценника, а не готовый файл A4.`
    );
  }

  const page = pages[0];
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const { width, height } = page.getSize();
  const effectiveWidth = rotation === 90 || rotation === 270 ? height : width;
  const effectiveHeight = rotation === 90 || rotation === 270 ? width : height;
  if (effectiveWidth >= effectiveHeight) {
    throw new Error(`${file.name}: страница альбомная. Нужен отдельный вертикальный ценник 10 × 15 см, а не лист A4.`);
  }
  if (rotation !== 0) {
    throw new Error(`${file.name}: страница повёрнута. Сохраните ценник вертикально без поворота и добавьте снова.`);
  }

  return { file, bytes, width, height };
}

async function buildPdf(files, scalePercent, frameGray) {
  const sources = [];
  for (const file of files) sources.push(await readAndValidate(file));

  const cardWidth = 100 * (scalePercent / 100) * MM;
  const cardHeight = 150 * (scalePercent / 100) * MM;
  if (2 * cardWidth + GAP > A4_WIDTH || cardHeight > A4_HEIGHT) {
    throw new Error('При таком масштабе два ценника не помещаются на лист A4.');
  }

  const output = await PDFDocument.create();
  output.setTitle('Ценники для печати A4');
  output.setSubject(`10 × 15 см, масштаб ${scalePercent}%, по два ценника на листе`);
  output.setCreator('Ценники на A4');

  for (let start = 0; start < sources.length; start += 2) {
    const batch = sources.slice(start, start + 2);
    const page = output.addPage([A4_WIDTH, A4_HEIGHT]);
    const pairWidth = 2 * cardWidth + GAP;
    const pairStart = (A4_WIDTH - pairWidth) / 2;
    const y = (A4_HEIGHT - cardHeight) / 2;
    const positions = batch.length === 2
      ? [{ x: pairStart, y }, { x: pairStart + cardWidth + GAP, y }]
      : [{ x: (A4_WIDTH - cardWidth) / 2, y }];

    for (let index = 0; index < batch.length; index += 1) {
      const source = batch[index];
      const [embedded] = await output.embedPdf(source.bytes, [0]);
      const fit = Math.min(cardWidth / source.width, cardHeight / source.height);
      const width = source.width * fit;
      const height = source.height * fit;
      const slot = positions[index];

      page.drawPage(embedded, {
        x: slot.x + (cardWidth - width) / 2,
        y: slot.y + (cardHeight - height) / 2,
        width,
        height,
      });
      page.drawRectangle({
        x: slot.x,
        y: slot.y,
        width: cardWidth,
        height: cardHeight,
        borderColor: rgb(frameGray, frameGray, frameGray),
        borderWidth: 0.22 * MM,
      });
    }
  }

  return output.save();
}

generate.addEventListener('click', async () => {
  generate.disabled = true;
  status.className = 'status';
  status.textContent = 'Проверяю файлы и собираю PDF…';
  try {
    const bytes = await buildPdf(
      state.files,
      Number(scale.value),
      Number(document.querySelector('#frame').value),
    );
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ценники_для_печати_A4.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    status.textContent = `Готово: ${Math.ceil(state.files.length / 2)} листа(ов) A4.`;
  } catch (error) {
    status.className = 'status error';
    status.textContent = error.message || 'Не удалось собрать PDF.';
  } finally {
    generate.disabled = state.files.length === 0;
  }
});

render();
