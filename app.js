const lineNumber = document.getElementById("lineNumber");
const times = document.getElementById("times");
const stopsElement = document.getElementById("stops");
const directionElement = document.getElementById("direction");
const clockElement = document.getElementById("clock");
const dateElement = document.getElementById("date");

function updateClock() {
  const now = new Date();
  clockElement.textContent = now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  dateElement.textContent = now.toLocaleDateString("pl-PL");
}

function render(state) {
  if (!state || !state.line || !state.direction) return;
  const routeStops = state.stops || [];
  const index = Math.max(0, Math.min(Number(state.stopIndex) || 0, Math.max(0, routeStops.length - 1)));

  lineNumber.textContent = state.line;
  directionElement.textContent = state.direction;
  stopsElement.innerHTML = "";
  times.innerHTML = "";

  const visibleStops = routeStops.slice(index, index + 5);
  for (let i = 0; i < 5; i++) {
    const row = document.createElement("div");
    if (i < visibleStops.length) {
      row.className = "stop-row" + (i === 0 ? " current" : "");
      if (i === 0) {
        const label = document.createElement("div");
        label.className = "stop-label";
        label.textContent = state.atStop ? "Tu jesteś:" : "Następny przystanek:";
        row.appendChild(label);
      }
      const marker = document.createElement("span");
      marker.className = "stop-marker";
      const name = document.createElement("span");
      name.className = "stop-name";
      name.textContent = visibleStops[i].name || "---";
      row.append(marker, name);
    } else {
      row.className = "stop-row empty";
    }
    stopsElement.appendChild(row);
  }

  for (let i = 1; i <= 4; i++) {
    const cell = document.createElement("div");
    cell.className = "time-cell";
    if (visibleStops[i]) {
      const value = document.createElement("span");
      value.textContent = visibleStops[i].arrivalTime || "—";
      const unit = document.createElement("small");
      unit.textContent = "";
      cell.append(value, unit);
    } else {
      cell.style.borderBottom = "0";
    }
    times.appendChild(cell);
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}`);
  socket.addEventListener("message", event => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "state") render(message.state);
    } catch (error) {
      console.error("Błąd WebSocket:", error);
    }
  });
  socket.addEventListener("close", () => setTimeout(connect, 2000));
}

updateClock();
setInterval(updateClock, 1000);
connect();
fetch("/api/state").then(response => response.json()).then(render)
  .catch(error => console.error("Błąd pobierania stanu:", error));
