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

const lineNumber = document.getElementById("lineNumber");
const times = document.getElementById("times");
const stopsElement = document.getElementById("stops");
const directionElement = document.getElementById("direction");
const clockElement = document.getElementById("clock");
const dateElement = document.getElementById("date");

let previousStopIndex = null;
let arrivedUntil = 0;
let labelTimer = null;

function updateClock() {
  const now = new Date();

  clockElement.textContent = now.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit"
  });

  dateElement.textContent = now.toLocaleDateString("pl-PL");
}

function render(state) {
  if (!state || !state.line || !state.direction) return;

  const routeStops = routes[state.line]?.[state.direction] || [];
  const index = Math.max(
    0,
    Math.min(Number(state.stopIndex) || 0, Math.max(0, routeStops.length - 1))
  );

  if (previousStopIndex !== null && previousStopIndex !== index) {
    arrivedUntil = Date.now() + 4000;
  }

  previousStopIndex = index;

  lineNumber.textContent = state.line;
  directionElement.textContent = state.direction;

  stopsElement.innerHTML = "";
  times.innerHTML = "";

  const visibleStops = routeStops.slice(index, index + 5);

  // Zawsze pięć równych wierszy.
  for (let i = 0; i < 5; i++) {
    const row = document.createElement("div");

    if (i < visibleStops.length) {
      row.className = "stop-row" + (i === 0 ? " current" : "");

      if (i === 0) {
        const label = document.createElement("div");
        label.className = "stop-label";
        label.textContent = Date.now() < arrivedUntil
          ? "Tu jesteś:"
          : "Następny przystanek:";

        row.appendChild(label);

        if (Date.now() < arrivedUntil) {
          label.classList.add("fade");
          requestAnimationFrame(() => label.classList.remove("fade"));
        }
      }

      const marker = document.createElement("span");
      marker.className = "stop-marker";

      const name = document.createElement("span");
      name.className = "stop-name";
      name.textContent = visibleStops[i];

      row.append(marker, name);
    } else {
      row.className = "stop-row empty";
    }

    stopsElement.appendChild(row);
  }

  // Cztery pola minut zawsze odpowiadają czterem następnym wierszom.
  for (let i = 1; i <= 4; i++) {
    const cell = document.createElement("div");
    cell.className = "time-cell";

    if (visibleStops[i]) {
      const value = document.createElement("span");
      value.textContent = "—";

      const unit = document.createElement("small");
      unit.textContent = "min";

      cell.append(value, unit);
    } else {
      cell.style.borderBottom = "0";
    }

    times.appendChild(cell);
  }

  // Aktualizuj napis bez przerysowywania całej tablicy.
  clearTimeout(labelTimer);
  if (Date.now() < arrivedUntil) {
    labelTimer = setTimeout(() => render(state), arrivedUntil - Date.now());
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("message", event => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === "state") {
        render(message.state);
      }
    } catch (error) {
      console.error("Błąd WebSocket:", error);
    }
  });

  socket.addEventListener("close", () => {
    setTimeout(connect, 2000);
  });
}

updateClock();
setInterval(updateClock, 1000);
connect();

fetch("/api/state")
  .then(response => response.json())
  .then(render)
  .catch(error => console.error("Błąd pobierania stanu:", error));
