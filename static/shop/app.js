let state = {
  batches: [],
  sales: [],
  writeoffs: [],
  stats: {
    totalUnits: 0,
    stockCost: 0,
    revenue: 0,
    deadLoss: 0,
    profit: 0
  }
};

const batchForm = document.querySelector("#batchForm");
const saleForm = document.querySelector("#saleForm");
const deadForm = document.querySelector("#deadForm");
const saleFlower = document.querySelector("#saleFlower");
const deadFlower = document.querySelector("#deadFlower");
const saleHint = document.querySelector("#saleHint");
const deadHint = document.querySelector("#deadHint");
const inventoryBody = document.querySelector("#inventoryBody");
const salesBody = document.querySelector("#salesBody");
const writeoffsBody = document.querySelector("#writeoffsBody");
const clearData = document.querySelector("#clearData");

const packInputs = ["packCost", "packQuantity", "deadOnArrival", "retailPrice"]
  .map((id) => document.querySelector(`#${id}`));

const formatMoney = new Intl.NumberFormat("ru-KZ", {
  style: "currency",
  currency: "KZT",
  maximumFractionDigits: 0
});

const formatDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

packInputs.forEach((input) => input.addEventListener("input", renderPackPreview));
loadState();
renderPackPreview();

batchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(batchForm);
  const payload = {
    name: cleanName(form.get("name")),
    packCost: toNumber(form.get("packCost")),
    packQuantity: toNumber(form.get("packQuantity")),
    deadOnArrival: toNumber(form.get("deadOnArrival")),
    retailPrice: toNumber(form.get("retailPrice"))
  };

  const response = await apiPost("/api/batches/", payload);
  if (!response.ok) return showHint(saleHint, response.error || "Проверьте данные пачки.");

  state = response.state;
  batchForm.reset();
  batchForm.packQuantity.value = 25;
  batchForm.deadOnArrival.value = 0;
  saleHint.textContent = "";
  deadHint.textContent = "";
  render();
});

saleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(saleForm);
  const response = await apiPost("/api/sales/", {
    name: form.get("name"),
    quantity: toNumber(form.get("quantity")),
    customPrice: form.get("customPrice")
  });

  if (!response.ok) return showHint(saleHint, response.error || "Продажа не оформлена.");

  state = response.state;
  saleForm.reset();
  saleForm.quantity.value = 1;
  showHint(saleHint, `Продажа оформлена. Прибыль: ${money(response.sale.profit)}.`, true);
  render();
});

deadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(deadForm);
  const response = await apiPost("/api/writeoffs/", {
    name: form.get("name"),
    quantity: toNumber(form.get("quantity")),
    reason: cleanName(form.get("reason"))
  });

  if (!response.ok) return showHint(deadHint, response.error || "Списание не оформлено.");

  state = response.state;
  deadForm.reset();
  deadForm.quantity.value = 1;
  showHint(deadHint, `Списано в потери: ${money(response.writeoff.cost)}.`, true);
  render();
});

inventoryBody.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-batch]");
  const writeoffButton = event.target.closest("[data-writeoff-batch]");

  if (writeoffButton) {
    const response = await apiPost(`/api/batches/${writeoffButton.dataset.writeoffBatch}/quick-writeoff/`, {});
    if (!response.ok) return showHint(deadHint, response.error || "Не удалось списать цветок.");
    state = response.state;
    render();
    return;
  }

  if (!deleteButton) return;

  const response = await apiDelete(`/api/batches/${deleteButton.dataset.deleteBatch}/`);
  if (!response.ok) return showHint(deadHint, response.error || "Не удалось удалить пачку.");
  state = response;
  render();
});

clearData.addEventListener("click", async () => {
  const confirmed = confirm("Очистить весь склад, продажи и списания?");
  if (!confirmed) return;

  const response = await apiPost("/api/clear/", {});
  if (!response.ok) return;

  state = response;
  saleHint.textContent = "";
  deadHint.textContent = "";
  render();
});

async function loadState() {
  try {
    const response = await fetch("/api/state/");
    if (response.status === 401) return redirectToLogin();
    state = await response.json();
    render();
  } catch {
    showHint(saleHint, "Не удалось загрузить данные с сервера.");
  }
}

function render() {
  renderPackPreview();
  renderStats();
  renderFlowerOptions();
  renderInventory();
  renderSales();
  renderWriteoffs();
}

function renderPackPreview() {
  const packCost = toNumber(document.querySelector("#packCost").value);
  const packQuantity = toNumber(document.querySelector("#packQuantity").value) || 1;
  const deadOnArrival = Math.min(toNumber(document.querySelector("#deadOnArrival").value), packQuantity);
  const liveQuantity = Math.max(packQuantity - deadOnArrival, 0);
  const unitCost = packCost / packQuantity;
  const retailPrice = toNumber(document.querySelector("#retailPrice").value);
  const unitProfit = retailPrice - unitCost;

  document.querySelector("#livePreview").textContent = `${liveQuantity} шт.`;
  document.querySelector("#unitCostPreview").textContent = money(unitCost);
  document.querySelector("#retailPreview").textContent = money(retailPrice);
  document.querySelector("#unitProfitPreview").textContent = money(unitProfit);
}

function renderStats() {
  document.querySelector("#totalUnits").textContent = `${state.stats.totalUnits} шт.`;
  document.querySelector("#stockCost").textContent = money(state.stats.stockCost);
  document.querySelector("#revenue").textContent = money(state.stats.revenue);
  document.querySelector("#deadLoss").textContent = money(state.stats.deadLoss);
  document.querySelector("#profit").textContent = money(state.stats.profit);
}

function renderFlowerOptions() {
  const names = [...new Set(state.batches.filter((batch) => batch.quantity > 0).map((batch) => batch.name))].sort();

  fillFlowerSelect(saleFlower, names);
  fillFlowerSelect(deadFlower, names);
}

function fillFlowerSelect(select, names) {
  select.innerHTML = "";
  if (names.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Сначала добавьте цветы";
    select.append(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} - ${getAvailable(name)} шт.`;
    select.append(option);
  }
}

function renderInventory() {
  const rows = [...state.batches].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (rows.length === 0) {
    inventoryBody.innerHTML = `<tr class="empty-row"><td colspan="9">Склад пуст. Добавьте первую пачку цветов.</td></tr>`;
    return;
  }

  inventoryBody.innerHTML = rows.map((batch) => `
    <tr>
      <td>${date(batch.createdAt)}</td>
      <td><strong>${escapeHtml(batch.name)}</strong></td>
      <td><span class="pill">${batch.quantity} шт.</span></td>
      <td>${money(batch.packCost)} / ${batch.packQuantity} шт.</td>
      <td>${batch.deadOnArrival || 0} шт.</td>
      <td>${money(batch.cost)}</td>
      <td>${money(batch.retailPrice)}</td>
      <td>${money(batch.quantity * batch.cost)}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn writeoff" type="button" data-writeoff-batch="${batch.id}" title="Списать 1 штуку">-1</button>
          <button class="row-btn" type="button" data-delete-batch="${batch.id}" title="Удалить пачку">x</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderSales() {
  if (state.sales.length === 0) {
    salesBody.innerHTML = `<tr class="empty-row"><td colspan="6">Продаж пока нет.</td></tr>`;
    return;
  }

  salesBody.innerHTML = state.sales.map((sale) => `
    <tr>
      <td>${date(sale.createdAt)}</td>
      <td><strong>${escapeHtml(sale.name)}</strong></td>
      <td>${sale.quantity} шт.</td>
      <td>${money(sale.revenue)}</td>
      <td>${money(sale.cost)}</td>
      <td><strong>${money(sale.profit)}</strong></td>
    </tr>
  `).join("");
}

function renderWriteoffs() {
  if (state.writeoffs.length === 0) {
    writeoffsBody.innerHTML = `<tr class="empty-row"><td colspan="5">Списаний пока нет.</td></tr>`;
    return;
  }

  writeoffsBody.innerHTML = state.writeoffs.map((item) => `
    <tr>
      <td>${date(item.createdAt)}</td>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>${item.quantity} шт.</td>
      <td><strong>${money(item.cost)}</strong></td>
      <td>${escapeHtml(item.reason)}</td>
    </tr>
  `).join("");
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken")
    },
    body: JSON.stringify(payload)
  });
  if (response.status === 401) return redirectToLogin();
  const data = await response.json();
  return { ...data, ok: response.ok };
}

async function apiDelete(url) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "X-CSRFToken": getCookie("csrftoken")
    }
  });
  if (response.status === 401) return redirectToLogin();
  const data = await response.json();
  return { ...data, ok: response.ok };
}

function redirectToLogin() {
  window.location.href = `/login/?next=${encodeURIComponent(window.location.pathname)}`;
  return { ok: false, error: "Нужно войти в аккаунт." };
}

function getAvailable(name) {
  return state.batches
    .filter((batch) => batch.name === name)
    .reduce((sum, batch) => sum + batch.quantity, 0);
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function toNumber(value) {
  return Number.parseFloat(value) || 0;
}

function money(value) {
  return formatMoney.format(value || 0);
}

function date(value) {
  return formatDate.format(new Date(value));
}

function showHint(element, message, ok = false) {
  element.classList.toggle("ok", ok);
  element.textContent = message;
}

function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
