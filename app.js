let ws;
let linesData = [];
let latestState = null;
let selectedLineForModal = null;
let additionalData = [];

const lineSearch = document.getElementById('lineSearch');
const lineList = document.getElementById('lineList');
const directionList = document.getElementById('directionList');

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onopen = () => document.getElementById('connection').textContent = 'POŁĄCZONO';
  ws.onclose = () => {
    document.getElementById('connection').textContent = 'BRAK POŁĄCZENIA';
    setTimeout(connect, 2000);
  };
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') render(message.state);
  };
}

function send(action, extra = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('Brak połączenia z serwerem!');
    return;
  }
  ws.send(JSON.stringify({ action, ...extra }));
}

function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}
function closeModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal-backdrop.visible')) document.body.classList.remove('modal-open');
}

function loadLines() {
  fetch('/api/gtfs/lines')
    .then(response => {
      if (!response.ok) throw new Error('Nie udało się pobrać linii GTFS');
      return response.json();
    })
    .then(data => {
      linesData = data;
      renderLineList();
      if (latestState) render(latestState);
      document.getElementById('lineCount').textContent = `${data.length} linii w bazie`;
    })
    .catch(error => {
      console.error(error);
      document.getElementById('connection').textContent = 'BŁĄD GTFS';
    });
}

function renderLineList() {
  const query = lineSearch.value.trim().toLocaleLowerCase('pl');
  const filtered = linesData.filter(item =>
    item.line.toLocaleLowerCase('pl').includes(query) ||
    (item.lineName || '').toLocaleLowerCase('pl').includes(query)
  );
  lineList.innerHTML = '';
  if (!filtered.length) {
    lineList.innerHTML = '<p class="empty-state">Nie znaleziono takiej linii.</p>';
    return;
  }
  filtered.forEach(item => {
    const button = document.createElement('button');
    button.className = 'line-option' + (item.line === selectedLineForModal ? ' selected' : '');
    button.innerHTML = `<strong></strong><small></small>`;
    button.querySelector('strong').textContent = item.line;
    button.querySelector('small').textContent = item.lineName || 'Linia komunikacyjna';
    button.addEventListener('click', () => {
      selectedLineForModal = item.line;
      renderLineList();
      renderDirections(item);
    });
    lineList.appendChild(button);
  });
}

function renderDirections(item) {
  directionList.innerHTML = '';
  (item.directions || []).forEach(name => {
    const button = document.createElement('button');
    button.className = 'direction-option';
    button.textContent = name;
    button.addEventListener('click', () => {
      send('select', { line: item.line, direction: name });
      closeModal('routeModal');
    });
    directionList.appendChild(button);
  });
  if (!item.directions?.length) directionList.innerHTML = '<p class="empty-state">Brak kierunków dla tej linii.</p>';
}

function render(state) {
  latestState = state;
  document.getElementById('currentLine').textContent = state.line || '---';
  document.getElementById('currentDirection').textContent = (state.direction || '---').toUpperCase();
  document.getElementById('status').textContent = state.active ? 'KURS AKTYWNY' : 'NIEAKTYWNY';
  const stops = state.stops || [];
  document.getElementById('currentStop').textContent = state.active ? stops[state.stopIndex]?.name || '---' : '---';
  document.getElementById('stopStatus').textContent = !state.active ? '---' : state.atStop ? 'NA PRZYSTANKU' : 'W TRAKCIE JAZDY';
  document.getElementById('selectedLineChip').textContent = state.line || '---';
  document.getElementById('routeButtonTitle').textContent = state.line ? `Linia ${state.line}` : 'Wybierz linię i kierunek';
  document.getElementById('routeButtonSubtitle').textContent = state.direction || 'Dotknij, aby wybrać kierunek';
}

function openRoutePicker() {
  selectedLineForModal = latestState?.line || null;
  lineSearch.value = '';
  renderLineList();
  const current = linesData.find(item => item.line === selectedLineForModal);
  if (current) renderDirections(current);
  else directionList.innerHTML = '<p class="empty-state">Najpierw wybierz linię.</p>';
  openModal('routeModal');
  lineSearch.focus();
}

function loadAdditional() {
  fetch('/api/announcements/additional')
    .then(response => {
      if (!response.ok) throw new Error('Nie udało się pobrać komunikatów');
      return response.json();
    })
    .then(data => {
      additionalData = data;
      const list = document.getElementById('additionalList');
      list.innerHTML = '';
      if (!data.length) list.innerHTML = '<p class="empty-state">Brak plików MP3 w folderze komunikatów dodatkowych.</p>';
      data.forEach(item => {
        const button = document.createElement('button');
        button.className = 'additional-option';
        const title = document.createElement('strong');
        title.textContent = item.label;
        const filename = document.createElement('small');
        filename.textContent = item.filename;
        const icon = document.createElement('span');
        icon.className = 'audio-icon';
        icon.textContent = '▶';
        button.append(icon, document.createElement('span'));
        button.lastChild.append(title, filename);
        button.addEventListener('click', () => {
          send('playAdditional', { filename: item.filename });
          closeModal('additionalModal');
        });
        list.appendChild(button);
      });
      document.getElementById('additionalCount').textContent = `${data.length} komunikatów`;
    })
    .catch(error => {
      console.error(error);
      document.getElementById('additionalList').innerHTML = '<p class="empty-state">Nie udało się wczytać listy komunikatów.</p>';
    });
}

document.getElementById('openRouteModal').addEventListener('click', openRoutePicker);
document.getElementById('openAdditionalModal').addEventListener('click', () => openModal('additionalModal'));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => {
  if (event.target === backdrop) closeModal(backdrop.id);
}));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop.visible').forEach(modal => closeModal(modal.id));
});
lineSearch.addEventListener('input', renderLineList);

loadLines();
loadAdditional();
connect();