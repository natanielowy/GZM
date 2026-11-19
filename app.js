let ws;
let linesData = [];
let latestState = null;

const line = document.getElementById('line');
const direction = document.getElementById('direction');

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    document.getElementById('connection').textContent = 'POŁĄCZONO';
  };

  ws.onclose = () => {
    document.getElementById('connection').textContent = 'BRAK POŁĄCZENIA';
    setTimeout(connect, 2000);
  };

  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') render(message.state);
  };
}

function send(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('Brak połączenia z serwerem!');
    return;
  }
  ws.send(JSON.stringify({ action }));
}

function loadLines() {
  fetch('/api/gtfs/lines')
    .then(response => {
      if (!response.ok) throw new Error('Nie udało się pobrać linii GTFS');
      return response.json();
    })
    .then(data => {
      linesData = data;
      line.innerHTML = '';
      data.forEach(item => {
        const option = document.createElement('option');
        option.value = item.line;
        option.textContent = item.line;
        line.appendChild(option);
      });
      if (latestState?.line && [...line.options].some(option => option.value === latestState.line)) {
        line.value = latestState.line;
      }
      updateDirections(latestState?.direction);
      if (latestState) render(latestState);
    })
    .catch(error => {
      console.error(error);
      document.getElementById('connection').textContent = 'BŁĄD GTFS';
    });
}

function updateDirections(selectedDirection) {
  const item = linesData.find(entry => entry.line === line.value);
  direction.innerHTML = '';
  (item?.directions || []).forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    direction.appendChild(option);
  });
  if (selectedDirection && [...direction.options].some(option => option.value === selectedDirection)) {
    direction.value = selectedDirection;
  }
}

function render(state) {
  latestState = state;
  if (!linesData.length) {
    document.getElementById('currentLine').textContent = state.line || '---';
    document.getElementById('currentDirection').textContent = (state.direction || '---').toUpperCase();
    document.getElementById('status').textContent = state.active ? 'KURS AKTYWNY' : 'NIEAKTYWNY';
    document.getElementById('currentStop').textContent = '---';
    document.getElementById('stopStatus').textContent = '---';
    return;
  }

  document.getElementById('currentLine').textContent = state.line || '---';
  document.getElementById('currentDirection').textContent = (state.direction || '---').toUpperCase();
  document.getElementById('status').textContent = state.active ? 'KURS AKTYWNY' : 'NIEAKTYWNY';

  const stops = state.stops || [];
  document.getElementById('currentStop').textContent =
    state.active ? stops[state.stopIndex]?.name || '---' : '---';

  document.getElementById('stopStatus').textContent =
    !state.active ? '---' : state.atStop ? 'NA PRZYSTANKU' : 'W TRAKCIE JAZDY';

  if (line.value !== state.line) line.value = state.line || '';
  updateDirections(state.direction);
}

line.addEventListener('change', () => {
  updateDirections();
  selectRoute();
});
direction.addEventListener('change', selectRoute);

function selectRoute() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    action: 'select',
    line: line.value,
    direction: direction.value
  }));
}

loadLines();
connect();
