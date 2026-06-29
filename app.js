"use strict";

const state = {
  currentDate: new Date(),
  loading: false,
  currentDuty: null,
  players: [],
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  elements.weekTitle = document.querySelector("#weekTitle");
  elements.weekDates = document.querySelector("#weekDates");
  elements.personList = document.querySelector("#personList");
  elements.status = document.querySelector("#status");
  elements.previousWeek = document.querySelector("#previousWeek");
  elements.currentWeek = document.querySelector("#currentWeek");
  elements.nextWeek = document.querySelector("#nextWeek");
  elements.playerForm = document.querySelector("#playerForm");
  elements.playerAdminList = document.querySelector("#playerAdminList");
  elements.swapNotice = document.querySelector("#swapNotice");
  elements.swapForm = document.querySelector("#swapForm");
  elements.originalPlayer = document.querySelector("#originalPlayer");
  elements.replacementPlayer = document.querySelector("#replacementPlayer");
  elements.swapButton = document.querySelector("#swapButton");
  elements.swapHint = document.querySelector("#swapHint");

  elements.previousWeek.addEventListener("click", () => moveWeek(-1));
  elements.nextWeek.addEventListener("click", () => moveWeek(1));
  elements.currentWeek.addEventListener("click", () => {
    state.currentDate = new Date();
    loadDuty();
  });
  elements.playerForm.addEventListener("submit", addPlayer);
  elements.swapForm.addEventListener("submit", createSwap);

  loadDuty();
  loadPlayers();
});

function getIsoWeek(date) {
  const utcDate = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12),
  );
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const year = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(
    ((utcDate - yearStart) / 86_400_000 + 1) / 7,
  );
  return { year, week };
}

function moveWeek(offset) {
  state.currentDate.setDate(state.currentDate.getDate() + offset * 7);
  loadDuty();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Serverfehler (${response.status})`);
  }
  return data;
}

function setLoading(loading) {
  state.loading = loading;
  for (const button of [
    elements.previousWeek,
    elements.currentWeek,
    elements.nextWeek,
  ]) {
    button.disabled = loading;
  }
}

function showError(error) {
  elements.status.textContent = error.message;
  elements.status.hidden = false;
}

function clearError() {
  elements.status.hidden = true;
  elements.status.textContent = "";
}

async function loadDuty() {
  if (state.loading) return;
  setLoading(true);
  clearError();

  try {
    const { year, week } = getIsoWeek(state.currentDate);
    const duty = await api(`/api/materialdienst?year=${year}&week=${week}`);
    state.currentDuty = duty;
    renderDuty(duty);
    renderSwapOptions();
  } catch (error) {
    state.currentDuty = null;
    showError(error);
    elements.personList.replaceChildren();
    renderSwapOptions();
  } finally {
    setLoading(false);
  }
}

function renderDuty(duty) {
  elements.weekTitle.textContent =
    `Materialdienst für KW ${duty.calendarWeek}/${duty.year}`;
  const format = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  elements.weekDates.textContent =
    `${format.format(new Date(`${duty.weekStart}T00:00:00Z`))} bis ` +
    format.format(new Date(`${duty.weekEnd}T00:00:00Z`));

  const rows = duty.players.map((player) => {
    const item = document.createElement("li");
    item.className = "person";
    item.textContent = player.scheduled_player
      ? `${player.name} (für ${player.scheduled_player.name})`
      : player.name;
    return item;
  });
  elements.personList.replaceChildren(...rows);
  renderSwapNotice(duty);
}

function renderSwapNotice(duty) {
  elements.swapNotice.replaceChildren();
  if (!duty.appliedSwaps.length) {
    elements.swapNotice.hidden = true;
    return;
  }

  const swap = duty.appliedSwaps[0];
  const firstWeek = swap.first_week_start === duty.weekStart;
  const text = document.createElement("p");
  if (firstWeek) {
    const returnDate = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${swap.second_week_start}T00:00:00Z`));
    text.textContent =
      `${swap.replacement_player_name} übernimmt für ` +
      `${swap.original_player_name}. Der Rücktausch erfolgt am ${returnDate}.`;
  } else {
    text.textContent =
      `${swap.original_player_name} übernimmt den Rücktausch für ` +
      `${swap.replacement_player_name}.`;
  }

  const cancel = document.createElement("button");
  cancel.className = "small-button";
  cancel.type = "button";
  cancel.textContent = "Tausch rückgängig machen";
  cancel.addEventListener("click", () => deleteSwap(swap.id));

  elements.swapNotice.append(text, cancel);
  elements.swapNotice.hidden = false;
}

async function loadPlayers() {
  try {
    const data = await api("/api/players?include_inactive=true");
    state.players = data.players;
    const rows = data.players.map((player) => {
      const item = document.createElement("li");
      item.className = `admin-player${player.active ? "" : " inactive"}`;

      const name = document.createElement("span");
      name.textContent = player.name;

      const actions = document.createElement("div");
      actions.className = "admin-player-actions";

      const renameButton = document.createElement("button");
      renameButton.className = "small-button";
      renameButton.type = "button";
      renameButton.textContent = "Umbenennen";
      renameButton.addEventListener("click", () => renamePlayer(player));

      const activeButton = document.createElement("button");
      activeButton.className = "small-button";
      activeButton.type = "button";
      activeButton.textContent = player.active ? "Deaktivieren" : "Aktivieren";
      activeButton.addEventListener("click", () =>
        setPlayerActive(player, !player.active),
      );

      actions.append(renameButton, activeButton);
      item.append(name, actions);
      return item;
    });
    elements.playerAdminList.replaceChildren(...rows);
    renderSwapOptions();
  } catch (error) {
    showError(error);
  }
}

async function addPlayer(event) {
  event.preventDefault();
  const input = elements.playerForm.elements.name;
  const name = input.value.trim();
  if (!name) return;

  try {
    await api("/api/players", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    input.value = "";
    await loadPlayers();
    await loadDuty();
  } catch (error) {
    showError(error);
  }
}

async function setPlayerActive(player, active) {
  try {
    await api(`/api/players/${player.id}`, {
      method: "PUT",
      body: JSON.stringify({ active }),
    });
    await loadPlayers();
    await loadDuty();
  } catch (error) {
    showError(error);
  }
}

async function renamePlayer(player) {
  const name = window.prompt("Neuer Name:", player.name)?.trim();
  if (!name || name === player.name) return;

  try {
    await api(`/api/players/${player.id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
    await loadPlayers();
    await loadDuty();
  } catch (error) {
    showError(error);
  }
}

function addOption(select, player) {
  const option = document.createElement("option");
  option.value = String(player.id);
  option.textContent = player.name;
  select.append(option);
}

function renderSwapOptions() {
  if (!elements.swapForm) return;

  elements.originalPlayer.replaceChildren();
  elements.replacementPlayer.replaceChildren();
  const duty = state.currentDuty;
  if (!duty) {
    elements.swapButton.disabled = true;
    elements.swapHint.textContent = "Der Dienst konnte noch nicht geladen werden.";
    return;
  }

  for (const player of duty.basePlayers) {
    addOption(elements.originalPlayer, player);
  }
  const scheduledIds = new Set(duty.basePlayers.map((player) => player.id));
  const replacements = state.players.filter(
    (player) => player.active && !scheduledIds.has(player.id),
  );
  for (const player of replacements) {
    addOption(elements.replacementPlayer, player);
  }

  const alreadySwapped = duty.appliedSwaps.length > 0;
  elements.swapButton.disabled = alreadySwapped || replacements.length === 0;
  elements.swapHint.textContent = alreadySwapped
    ? "Für diese Woche besteht bereits ein Tausch."
    : "";
}

async function createSwap(event) {
  event.preventDefault();
  if (!state.currentDuty) return;

  const originalId = Number(elements.originalPlayer.value);
  const replacementId = Number(elements.replacementPlayer.value);
  try {
    elements.swapButton.disabled = true;
    const result = await api("/api/swaps", {
      method: "POST",
      body: JSON.stringify({
        year: state.currentDuty.year,
        week: state.currentDuty.calendarWeek,
        original_player_id: originalId,
        replacement_player_id: replacementId,
      }),
    });
    const swap = result.swap;
    elements.swapHint.textContent =
      `${swap.replacement_player_name} übernimmt jetzt; ` +
      `${swap.original_player_name} übernimmt dafür in KW ` +
      `${swap.second_week.week}/${swap.second_week.year}.`;
    await loadDuty();
  } catch (error) {
    showError(error);
    elements.swapButton.disabled = false;
  }
}

async function deleteSwap(id) {
  try {
    await api(`/api/swaps/${id}`, { method: "DELETE" });
    elements.swapHint.textContent = "Der Tausch wurde rückgängig gemacht.";
    await loadDuty();
  } catch (error) {
    showError(error);
  }
}
