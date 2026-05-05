const STORAGE_KEY = "flower-fifo-business-v2";

const state = loadState();

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
render();

batchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(batchForm);
  const name = cleanName(form.get("name"));
  const packCost = toNumber(form.get("packCost"));
  const packQuantity = toNumber(form.get("packQuantity"));
  const deadOnArrival = Math.min(toNumber(form.get("deadOnArrival")), packQuantity);
  const liveQuantity = packQuantity - deadOnArrival;
  const retailPrice = toNumber(form.get("retailPrice"));

  if (!name || packCost <= 0 || packQuantity <= 0 || liveQuantity <= 0 || retailPrice <= 0) return;

  const unitCost = packCost / packQuantity;
  const batch = {
    id: createId(),
    name,
    packCost,
    packQuantity,
    deadOnArrival,
    quantity: liveQuantity,
    cost: unitCost,
    retailPrice,
    createdAt: new Date().toISOString()
  };

  state.batches.push(batch);

  if (deadOnArrival > 0) {
    state.writeoffs.unshift({
      id: createId(),
      name,
      quantity: deadOnArrival,
      cost: deadOnArrival * unitCost,
      reason: "Мертвые сразу в пачке",
      createdAt: new Date().toISOString()
    });
  }

  saveState();
  batchForm.reset();
  batchForm.packQuantity.value = 25;
  batchForm.deadOnArrival.value = 0;
  saleHint.textContent = "";
  deadHint.textContent = "";
  render();
});

saleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(saleForm);
  const name = form.get("name");
  const quantity = toNumber(form.get("quantity"));
  const customPrice = form.get("customPrice");

  if (!name || quantity <= 0) return;

  const available = getAvailable(name);
  if (available < quantity) {
    showHint(saleHint, `Недостаточно на складе: доступно ${available} шт.`);
    return;
  }

  const sale = sellFifo({
    name,
    quantity,
    customPrice: customPrice === "" ? null : toNumber(customPrice)
  });

  state.sales.unshift(sale);
  removeEmptyBatches();
  saveState();
  saleForm.reset();
  saleForm.quantity.value = 1;
  showHint(saleHint, `Продажа оформлена. Прибыль: ${money(sale.profit)}.`, true);
  render();
});

deadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(deadForm);
  const name = form.get("name");
  const quantity = toNumber(form.get("quantity"));
  const reason = cleanName(form.get("reason")) || "Мертвые цветы";

  if (!name || quantity <= 0) return;

  const available = getAvailable(name);
  if (available < quantity) {
    showHint(deadHint, `Недостаточно на складе: доступно ${available} шт.`);
    return;
  }

  const writeoff = writeoffFifo({ name, quantity, reason });
  state.writeoffs.unshift(writeoff);
  removeEmptyBatches();
  saveState();
  deadForm.reset();
  deadForm.quantity.value = 1;
  showHint(deadHint, `Списано в потери: ${money(writeoff.cost)}.`, true);
  render();
});

inventoryBody.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-batch]");
  const writeoffButton = event.target.closest("[data-writeoff-batch]");

  if (writeoffButton) {
    const batch = state.batches.find((item) => item.id === writeoffButton.dataset.writeoffBatch);
    if (!batch) return;

    batch.quantity -= 1;
    state.writeoffs.unshift({
      id: createId(),
      name: batch.name,
      quantity: 1,
      cost: batch.cost,
      reason: "Быстрое списание со склада",
      createdAt: new Date().toISOString()
    });
    removeEmptyBatches();
    saveState();
    render();
    return;
  }

  if (!deleteButton) return;

  state.batches = state.batches.filter((batch) => batch.id !== deleteButton.dataset.deleteBatch);
  saveState();
  render();
});

clearData.addEventListener("click", () => {
  const confirmed = confirm("Очистить весь склад, продажи и списания?");
  if (!confirmed) return;

  state.batches = [];
  state.sales = [];
  state.writeoffs = [];
  saveState();
  saleHint.textContent = "";
  deadHint.textContent = "";
  render();
});

function sellFifo({ name, quantity, customPrice }) {
  let remaining = quantity;
  let costTotal = 0;
  let revenueTotal = 0;
  const usedBatches = [];

  for (const batch of getFifoBatches(name)) {
    if (remaining <= 0) break;

    const take = Math.min(batch.quantity, remaining);
    const price = customPrice ?? batch.retailPrice;

    batch.quantity -= take;
    remaining -= take;
    costTotal += take * batch.cost;
    revenueTotal += take * price;
    usedBatches.push({
      batchId: batch.id,
      quantity: take,
      cost: batch.cost,
      price
    });
  }

  return {
    id: createId(),
    name,
    quantity,
    revenue: revenueTotal,
    cost: costTotal,
    profit: revenueTotal - costTotal,
    usedBatches,
    createdAt: new Date().toISOString()
  };
}

function writeoffFifo({ name, quantity, reason }) {
  let remaining = quantity;
  let costTotal = 0;
  const usedBatches = [];

  for (const batch of getFifoBatches(name)) {
    if (remaining <= 0) break;

    const take = Math.min(batch.quantity, remaining);
    batch.quantity -= take;
    remaining -= take;
    costTotal += take * batch.cost;
    usedBatches.push({
      batchId: batch.id,
      quantity: take,
      cost: batch.cost
    });
  }

  return {
    id: createId(),
    name,
    quantity,
    cost: costTotal,
    reason,
    usedBatches,
    createdAt: new Date().toISOString()
  };
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
  const totalUnits = state.batches.reduce((sum, batch) => sum + batch.quantity, 0);
  const stockCost = state.batches.reduce((sum, batch) => sum + batch.quantity * batch.cost, 0);
  const revenue = state.sales.reduce((sum, sale) => sum + sale.revenue, 0);
  const salesProfit = state.sales.reduce((sum, sale) => sum + sale.profit, 0);
  const deadLoss = state.writeoffs.reduce((sum, item) => sum + item.cost, 0);

  document.querySelector("#totalUnits").textContent = `${totalUnits} шт.`;
  document.querySelector("#stockCost").textContent = money(stockCost);
  document.querySelector("#revenue").textContent = money(revenue);
  document.querySelector("#deadLoss").textContent = money(deadLoss);
  document.querySelector("#profit").textContent = money(salesProfit - deadLoss);
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
    salesBody.innerHTML = `<tr class="empty-row"><td colspan="7">Продаж пока нет.</td></tr>`;
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

function getFifoBatches(name) {
  return state.batches
    .filter((batch) => batch.name === name && batch.quantity > 0)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function getAvailable(name) {
  return state.batches
    .filter((batch) => batch.name === name)
    .reduce((sum, batch) => sum + batch.quantity, 0);
}

function removeEmptyBatches() {
  state.batches = state.batches.filter((batch) => batch.quantity > 0);
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return { batches: [], sales: [], writeoffs: [] };

  try {
    const parsed = JSON.parse(saved);
    return {
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      writeoffs: Array.isArray(parsed.writeoffs) ? parsed.writeoffs : []
    };
  } catch {
    return { batches: [], sales: [], writeoffs: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function toNumber(value) {
  return Number.parseFloat(value) || 0;
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function money(value) {
  return formatMoney.format(value);
}

function date(value) {
  return formatDate.format(new Date(value));
}

function showHint(element, message, ok = false) {
  element.classList.toggle("ok", ok);
  element.textContent = message;
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
