const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const routes = {
  M3: {
    "Piekary Dwór": [
      "Bobrowniki Dworzec",
      "Nowy Świat",
      "Centrum handlowe",
      "Osiedle",
      "Centrum przesiadkowe",
      "Piekary Dwór"
    ],
    "Bobrowniki Dworzec": [
      "Piekary Dwór",
      "Centrum przesiadkowe",
      "Osiedle",
      "Centrum handlowe",
      "Nowy Świat",
      "Bobrowniki Dworzec"
    ]
  }
};

let state = {
  line: "M3",
  direction: "Piekary Dwór",
  active: false,
  stopIndex: 0,
  atStop: false,
  announcement: null
};

function getStops() {
  return routes[state.line][state.direction];
}

function broadcast(type, data = {}) {
  const message = JSON.stringify({ type, ...data });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function publishState() {
  broadcast('state', { state });
}

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.redirect('/display');
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/display/index.html'));
});

app.get('/driver', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/driver/index.html'));
});

app.get('/api/state', (req, res) => {
  res.json(state);
});

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', state }));

  ws.on('message', raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (message.action) {
      case 'start':
        if (!routes[state.line][state.direction]) return;

        state.active = true;
        state.stopIndex = 0;
        state.atStop = false;
        state.announcement = null;
        break;

      case 'select':
        if (!routes[message.line]?.[message.direction]) return;

        state.line = message.line;
        state.direction = message.direction;
        state.stopIndex = 0;
        state.active = false;
        state.atStop = false;
        state.announcement = null;
        break;

      case 'arrived':
        if (!state.active) return;

        state.atStop = true;
        state.announcement = null;
        break;

      case 'next':
        if (!state.active) return;

        if (state.stopIndex < getStops().length - 1) {
          state.stopIndex++;
        }

        state.atStop = false;
        state.announcement = null;
        break;

      case 'previous':
        if (!state.active) return;

        if (state.stopIndex > 0) {
          state.stopIndex--;
        }

        state.atStop = false;
        state.announcement = null;
        break;

      case 'announce': {
        if (!state.active) return;

        const stops = getStops();
        const next = stops[state.stopIndex + 1];

        const text = next
          ? `Następny przystanek: ${next}`
          : `Koniec trasy: ${stops[state.stopIndex]}`;

        state.announcement = text;
        broadcast('announcement', { text });
        break;
      }

      case 'end':
        state.active = false;
        state.stopIndex = 0;
        state.atStop = false;
        state.announcement = null;
        break;

      default:
        return;
    }

    publishState();
  });
});

const PORT = 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('===================================');
  console.log(' GZM PASSENGER SYSTEM');
  console.log('===================================');
  console.log(`Sterownik: http://ADRES-DEBIANA:${PORT}/driver`);
  console.log(`Tablica:    http://ADRES-DEBIANA:${PORT}/display`);
  console.log('Serwer WebSocket uruchomiony.');
});