let ws;

const line = document.getElementById('line');
const direction = document.getElementById('direction');

const stops = {
  M3: {
    'Piekary Dwór': [
      'Bobrowniki Dworzec',
      'Nowy Świat',
      'Centrum handlowe',
      'Osiedle',
      'Centrum przesiadkowe',
      'Piekary Dwór'
    ],
    'Bobrowniki Dworzec': [
      'Piekary Dwór',
      'Centrum przesiadkowe',
      'Osiedle',
      'Centrum handlowe',
      'Nowy Świat',
      'Bobrowniki Dworzec'
    ]
  }
};

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

    if (message.type === 'state') {
      render(message.state);
    }
  };
}

function send(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('Brak połączenia z serwerem!');
    return;
  }

  ws.send(JSON.stringify({ action }));
}

function render(state) {
  document.getElementById('currentLine').textContent = state.line;

  document.getElementById('currentDirection').textContent =
    state.direction.toUpperCase();

  document.getElementById('status').textContent =
    state.active ? 'KURS AKTYWNY' : 'NIEAKTYWNY';

  const route = stops[state.line]?.[state.direction] || [];

  document.getElementById('currentStop').textContent =
    state.active ? route[state.stopIndex] || '---' : '---';

  document.getElementById('stopStatus').textContent =
    !state.active ? '---' : state.atStop ? 'NA PRZYSTANKU' : 'W TRAKCIE JAZDY';

  line.value = state.line;
  direction.value = state.direction;
}

line.addEventListener('change', selectRoute);
direction.addEventListener('change', selectRoute);

function selectRoute() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    action: 'select',
    line: line.value,
    direction: direction.value
  }));
}

connect();