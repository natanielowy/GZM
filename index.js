const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const GTFS_DIR = path.join(__dirname, '../data/gtfs/current');
const AUDIO_DIR = path.join(__dirname, '../data/announcements/Zapowiedzi');
const AUDIO_DEVICE = 'alsa/plughw:CARD=PCH,DEV=3';

function normalizeAudioName(value) {
  return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function collectAudioFiles(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectAudioFiles(fullPath, result);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp3')) result.push(fullPath);
  }
  return result;
}
const audioFiles = collectAudioFiles(AUDIO_DIR);
const audioByName = new Map();
for (const file of audioFiles) {
  const key = normalizeAudioName(path.basename(file, path.extname(file)));
  if (!audioByName.has(key)) audioByName.set(key, []);
  audioByName.get(key).push(file);
}
const audioQueue = [];
let audioPlaying = false;
function queueAudio(files) {
  for (const file of files.filter(Boolean)) {
    if (fs.existsSync(file)) audioQueue.push(file);
    else console.warn('Brak pliku zapowiedzi:', file);
  }
  playNextAudio();
}
function playNextAudio() {
  if (audioPlaying || !audioQueue.length) return;
  const file = audioQueue.shift();
  audioPlaying = true;
  console.log('Zapowiedź audio:', path.basename(file));
  const player = spawn('mpv', ['--no-video', '--really-quiet', '--audio-device=' + AUDIO_DEVICE, file], { stdio: 'ignore' });
  player.on('error', error => console.error('Nie udało się uruchomić MPV:', error.message));
  player.on('close', code => {
    if (code !== 0) console.warn('MPV zakończył odtwarzanie kodem:', code);
    audioPlaying = false;
    playNextAudio();
  });
}
function getAdditionalAudio(filename) {
  return audioByName.get(normalizeAudioName(filename))?.[0] || null;
}
function getStopAudio(stop) {
  if (!stop) return null;
  const matches = audioByName.get(normalizeAudioName(stop.name)) || [];
  if (!matches.length) {
    console.warn('Nie znaleziono nagrania dla przystanku:', stop.name);
    return null;
  }
  if (stop.city) {
    const cityKey = normalizeAudioName(stop.city);
    const cityMatch = matches.find(file => normalizeAudioName(file).includes(cityKey));
    if (cityMatch) return cityMatch;
  }
  return matches[0];
}
function announceNextStop(stop, terminal = false) {
  const files = [];
  const prefix = getAdditionalAudio(terminal ? '3_KoniecTrasy' : '1_NastepnyPrzystanek');
  if (prefix) files.push(prefix);
  const stopAudio = getStopAudio(stop);
  if (stopAudio) files.push(stopAudio);
  queueAudio(files);
}

function parseCSV(content) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value.replace(/\r$/, ''));
  if (row.some(cell => cell !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map(header => header.replace(/^\uFEFF/, '').trim());
  return rows.map(cells => {
    const item = {};
    headers.forEach((header, index) => item[header] = cells[index] ?? '');
    return item;
  });
}

function readGTFSFile(name, required = false) {
  const file = path.join(GTFS_DIR, name);
  if (!fs.existsSync(file)) {
    if (required) throw new Error('Brak pliku GTFS: ' + file);
    return [];
  }
  return parseCSV(fs.readFileSync(file, 'utf8'));
}

function loadGTFS() {
  const routesRows = readGTFSFile('routes.txt', true);
  const tripsRows = readGTFSFile('trips.txt', true);
  const stopsRows = readGTFSFile('stops.txt', true);
  const stopTimesRows = readGTFSFile('stop_times.txt', true);
  const stopExtRows = readGTFSFile('stops_ext.txt');

  const stopNames = new Map(stopsRows.map(stop => [stop.stop_id, stop.stop_name]));
  const stopCities = new Map(stopExtRows.map(stop => [stop.stop_id, stop.city]));
  const timesByTrip = new Map();

  for (const item of stopTimesRows) {
    if (!timesByTrip.has(item.trip_id)) timesByTrip.set(item.trip_id, []);
    timesByTrip.get(item.trip_id).push(item);
  }

  const routeInfo = new Map(routesRows.map(route => [route.route_id, route]));
  const tripGroups = new Map();

  for (const trip of tripsRows) {
    const route = routeInfo.get(trip.route_id);
    if (!route) continue;
    const times = (timesByTrip.get(trip.trip_id) || [])
      .slice()
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    if (!times.length) continue;

    const headsign = (trip.trip_headsign || route.route_long_name || 'Nieznany kierunek').trim();
    const pattern = times.map(item => item.stop_id).join(',');
    const groupKey = [route.route_id, headsign, pattern].join('|');

    if (!tripGroups.has(groupKey)) {
      tripGroups.set(groupKey, {
        routeId: route.route_id,
        line: route.route_short_name || route.route_id,
        lineName: route.route_long_name || '',
        routeType: route.route_type,
        color: route.route_color || '',
        headsign,
        pattern,
        stops: times.map(item => ({
          id: item.stop_id,
          name: stopNames.get(item.stop_id) || item.stop_id,
          city: stopCities.get(item.stop_id) || '',
          arrivalTime: item.arrival_time || '',
          departureTime: item.departure_time || '',
          sequence: Number(item.stop_sequence)
        })),
        trips: []
      });
    }

    tripGroups.get(groupKey).trips.push({
      tripId: trip.trip_id,
      serviceId: trip.service_id,
      tripName: trip.trip_short_name || '',
      departure: times[0].departure_time || times[0].arrival_time || ''
    });
  }

  // Dla każdego kierunku wybieramy najczęstszy wariant przebiegu.
  // Różne kierunki o tym samym direction_id pozostają rozdzielone po headsign.
  const lineMap = new Map();
  for (const group of tripGroups.values()) {
    if (!lineMap.has(group.line)) {
      lineMap.set(group.line, { line: group.line, lineName: group.lineName, routeType: group.routeType, color: group.color, directions: new Map() });
    }
    const line = lineMap.get(group.line);
    const current = line.directions.get(group.headsign);
    if (!current || group.trips.length > current.trips.length) {
      line.directions.set(group.headsign, group);
    }
  }

  const catalog = {};
  for (const [lineName, line] of lineMap) {
    catalog[lineName] = {
      line: line.line,
      lineName: line.lineName,
      routeType: line.routeType,
      color: line.color,
      directions: {}
    };
    for (const [headsign, group] of line.directions) {
      catalog[lineName].directions[headsign] = group;
    }
  }

  const lineNames = Object.keys(catalog).sort((a, b) =>
    a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' })
  );
  console.log(`GTFS: wczytano ${lineNames.length} linii i ${tripGroups.size} wariantów kursów.`);
  return { catalog, lineNames };
}

let gtfs;
try {
  gtfs = loadGTFS();
} catch (error) {
  console.error('Nie udało się wczytać GTFS:', error.message);
  gtfs = { catalog: {}, lineNames: [] };
}

const initialLine = gtfs.catalog.M3 ? 'M3' : (gtfs.lineNames[0] || '');
const initialDirection = initialLine
  ? Object.keys(gtfs.catalog[initialLine].directions)[0]
  : '';

let state = {
  line: initialLine,
  direction: initialDirection,
  active: false,
  stopIndex: 0,
  atStop: false,
  announcement: null
};

function getRoute(line = state.line, direction = state.direction) {
  return gtfs.catalog[line]?.directions?.[direction] || null;
}

function getPublicState() {
  const route = getRoute();
  return { ...state, stops: route ? route.stops : [] };
}

function broadcast(type, data = {}) {
  const message = JSON.stringify({ type, ...data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

function publishState() {
  broadcast('state', { state: getPublicState() });
}

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => res.redirect('/display'));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, '../public/display/index.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, '../public/driver/index.html')));
app.get('/api/state', (req, res) => res.json(getPublicState()));

app.get('/api/gtfs/lines', (req, res) => {
  res.json(gtfs.lineNames.map(name => {
    const line = gtfs.catalog[name];
    return {
      line: name,
      lineName: line.lineName,
      directions: Object.keys(line.directions).sort((a, b) => a.localeCompare(b, 'pl'))
    };
  }));
});

app.get('/api/gtfs/route', (req, res) => {
  const route = getRoute(req.query.line, req.query.direction);
  if (!route) return res.status(404).json({ error: 'Nie znaleziono kierunku w GTFS.' });
  res.json({
    line: route.line,
    direction: route.headsign,
    stops: route.stops,
    trips: route.trips.length
  });
});

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', state: getPublicState() }));

  ws.on('message', raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (message.action) {
      case 'start':
        if (!getRoute()) return;
        state.active = true;
        state.stopIndex = 0;
        state.atStop = false;
        state.announcement = null;
        break;

      case 'select':
        if (!getRoute(message.line, message.direction)) return;
        state.line = message.line;
        state.direction = message.direction;
        state.stopIndex = 0;
        state.active = false;
        state.atStop = false;
        state.announcement = null;
        break;

      case 'arrived': {
        if (!state.active) return;
        state.atStop = true;
        state.announcement = null;
        queueAudio([getStopAudio(getRoute()?.stops?.[state.stopIndex])]);
        break;
      }

      case 'next': {
        if (!state.active) return;
        const stops = getRoute()?.stops || [];
        if (state.stopIndex < stops.length - 1) {
          state.stopIndex++;
          announceNextStop(stops[state.stopIndex]);
        } else {
          announceNextStop(stops[state.stopIndex], true);
        }
        state.atStop = false;
        state.announcement = null;
        break;
      }

      case 'previous':
        if (!state.active) return;
        if (state.stopIndex > 0) state.stopIndex--;
        state.atStop = false;
        state.announcement = null;
        break;

      case 'announce': {
        if (!state.active) return;
        const stops = getRoute()?.stops || [];
        const next = stops[state.stopIndex + 1];
        const text = next ? `Następny przystanek: ${next.name}` : `Koniec trasy: ${stops[state.stopIndex]?.name || ''}`;
        state.announcement = text;
        announceNextStop(next || stops[state.stopIndex], !next);
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
