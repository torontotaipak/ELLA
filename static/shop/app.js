let state = {
  canManage: false,
  purchases: [],
  batches: [],
  sales: [],
  writeoffs: [],
  stats: { totalUnits: 0 }
};

const canManage = document.body.dataset.canManage === "true";
const purchaseForm = document.querySelector("#purchaseForm");
const purchaseSelect = document.querySelector("#purchaseSelect");
const purchaseHint = document.querySelector("#purchaseHint");
const batchForm = document.querySelector("#batchForm");
const saleForm = document.querySelector("#saleForm");
const deadForm = document.querySelector("#deadForm");
const saleType = document.querySelector("#saleType");
const singleSaleFields = document.querySelector("#singleSaleFields");
const bouquetSaleFields = document.querySelector("#bouquetSaleFields");
const bouquetItems = document.querySelector("#bouquetItems");
const addBouquetItem = document.querySelector("#addBouquetItem");
const saleFlower = document.querySelector("#saleFlower");
const deadFlower = document.querySelector("#deadFlower");
const saleHint = document.querySelector("#saleHint");
const deadHint = document.querySelector("#deadHint");
const inventoryBody = document.querySelector("#inventoryBody");
const salesBody = document.querySelector("#salesBody");
const writeoffsBody = document.querySelector("#writeoffsBody");
const clearData = document.querySelector("#clearData");

const packInputs = ["packCost", "packQuantity", "deadOnArrival", "retailPrice"]
  .map((id) => document.querySelector(`#${id}`))
  .filter(Boolean);

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
saleType.addEventListener("change", renderSaleMode);
addBouquetItem.addEventListener("click", () => addBouquetRow());
bouquetSaleFields.addEventListener("input", renderBouquetPreview);
bouquetSaleFields.addEventListener("change", renderBouquetPreview);

loadState();
renderPackPreview();
renderSaleMode();

if (purchaseForm) purchaseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(purchaseForm);
  const response = await apiPost("/api/purchases/", {
    note: cleanName(form.get("note"))
  });

  if (!response.ok) return showHint(purchaseHint, response.error || "Не удалось создать закупку.");

  state = response.state;
  purchaseForm.reset();
  showHint(purchaseHint, `Создана закупка №${response.purchase.number}.`, true);
  render();
});

if (batchForm) batchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(batchForm);
  const response = await apiPost("/api/batches/", {
    purchaseId: form.get("purchaseId"),
    name: cleanName(form.get("name")),
    packCost: toNumber(form.get("packCost")),
    packQuantity: toNumber(form.get("packQuantity")),
    deadOnArrival: toNumber(form.get("deadOnArrival")),
    retailPrice: toNumber(form.get("retailPrice"))
  });

  if (!response.ok) return showHint(purchaseHint || saleHint, response.error || "Проверьте данные пачки.");

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
  const type = form.get("saleType");
  const payload = type === "bouquet"
    ? {
        saleType: "bouquet",
        bouquetName: cleanName(form.get("bouquetName")),
        bouquetPrice: toNumber(form.get("bouquetPrice")),
        items: getBouquetItems()
      }
    : {
        saleType: "single",
        name: form.get("name"),
        quantity: toNumber(form.get("quantity")),
        customPrice: form.get("customPrice")
      };

  const response = await apiPost("/api/sales/", payload);
  if (!response.ok) return showHint(saleHint, response.error || "Продажа не оформлена.");

  state = response.state;
  saleForm.reset();
  saleForm.quantity.value = 1;
  resetBouquetRows();
  renderSaleMode();
  const message = canManage
    ? `Продажа оформлена. Прибыль: ${money(response.sale.profit)}.`
    : "Продажа оформлена.";
  showHint(saleHint, message, true);
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
  const message = canManage
    ? `Списано в потери: ${money(response.writeoff.cost)}.`
    : "Списание оформлено.";
  showHint(deadHint, message, true);
  render();
});

inventoryBody.addEventListener("click", async (event) => {
  if (!canManage) return;

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

if (clearData) clearData.addEventListener("click", async () => {
  const confirmed = confirm("Очистить весь склад, закупки, продажи и списания?");
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
  renderSaleMode();
  renderStats();
  renderPurchaseOptions();
  renderFlowerOptions();
  renderInventory();
  renderSales();
  renderWriteoffs();
  renderBouquetPreview();
}

function renderPackPreview() {
  if (!batchForm) return;

  const packCost = toNumber(document.querySelector("#packCost").value);
  const packQuantity = toNumber(document.querySelector("#packQuantity").value) || 1;
  const deadOnArrival = Math.min(toNumber(document.querySelector("#deadOnArrival").value), packQuantity);
  const liveQuantity = Math.max(packQuantity - deadOnArrival, 0);
  const unitCost = packCost / packQuantity;
  const retailPrice = toNumber(document.querySelector("#retailPrice").value);
  const unitProfit = retailPrice - unitCost;

  setText("#livePreview", `${liveQuantity} шт.`);
  setText("#unitCostPreview", money(unitCost));
  setText("#retailPreview", money(retailPrice));
  setText("#unitProfitPreview", money(unitProfit));
}

function renderSaleMode() {
  const isBouquet = saleType.value === "bouquet";
  singleSaleFields.classList.toggle("is-hidden", isBouquet);
  bouquetSaleFields.classList.toggle("is-hidden", !isBouquet);
  if (isBouquet && bouquetItems.children.length === 0) addBouquetRow();
}

function renderStats() {
  setText("#totalUnits", `${state.stats.totalUnits} шт.`);
  setText("#stockCost", money(state.stats.stockCost));
  setText("#revenue", money(state.stats.revenue));
  setText("#deadLoss", money(state.stats.deadLoss));
  setText("#profit", money(state.stats.profit));
}

function renderPurchaseOptions() {
  if (!purchaseSelect) return;

  purchaseSelect.innerHTML = "";
  if (state.purchases.length === 0) {
    purchaseSelect.append(new Option("Создать автоматически", ""));
    return;
  }

  for (const purchase of state.purchases) {
    purchaseSelect.append(new Option(`Закуп №${purchase.number} от ${date(purchase.createdAt)}`, purchase.id));
  }
}

function renderFlowerOptions() {
  const names = [...new Set(state.batches.filter((batch) => batch.quantity > 0).map((batch) => batch.name))].sort();

  fillFlowerSelect(saleFlower, names);
  fillFlowerSelect(deadFlower, names);
  document.querySelectorAll(".bouquet-flower").forEach((select) => {
    const value = select.value;
    fillFlowerSelect(select, names);
    if (names.includes(value)) select.value = value;
  });
}

function fillFlowerSelect(select, names) {
  if (!select) return;
  select.innerHTML = "";
  if (names.length === 0) {
    select.append(new Option("Сначала добавьте цветы", ""));
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const name of names) {
    select.append(new Option(`${name} - ${getAvailable(name)} шт.`, name));
  }
}

function renderInventory() {
  const rows = [...state.batches].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (rows.length === 0) {
    const colspan = canManage ? 9 : 3;
    inventoryBody.innerHTML = `<tr class="empty-row"><td colspan="${colspan}">Склад пуст.</td></tr>`;
    return;
  }

  if (!canManage) {
    inventoryBody.innerHTML = rows.map((batch) => `
      <tr>
        <td>${date(batch.createdAt)}</td>
        <td><strong>${escapeHtml(batch.name)}</strong></td>
        <td><span class="pill">${batch.quantity} шт.</span></td>
      </tr>
    `).join("");
    return;
  }

  const groups = state.purchases.map((purchase) => ({
    purchase,
    batches: rows.filter((batch) => batch.purchaseId === purchase.id)
  })).filter((group) => group.batches.length > 0);

  const ungrouped = rows.filter((batch) => !batch.purchaseId);
  if (ungrouped.length > 0) {
    groups.push({
      purchase: { number: "-", createdAt: new Date().toISOString(), stockCost: ungrouped.reduce((sum, batch) => sum + batch.quantity * batch.cost, 0) },
      batches: ungrouped
    });
  }

  inventoryBody.innerHTML = groups.map(({ purchase, batches }) => `
    <tr class="purchase-row">
      <td colspan="9">Закуп №${purchase.number} от ${date(purchase.createdAt)} · остаток ${sumQuantity(batches)} шт. · себестоимость остатка ${money(purchase.stockCost || 0)}</td>
    </tr>
    ${batches.map((batch) => `
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
    `).join("")}
  `).join("");
}

function renderSales() {
  if (state.sales.length === 0) {
    const colspan = canManage ? 6 : 3;
    salesBody.innerHTML = `<tr class="empty-row"><td colspan="${colspan}">Продаж пока нет.</td></tr>`;
    return;
  }

  salesBody.innerHTML = state.sales.map((sale) => `
    <tr>
      <td>${date(sale.createdAt)}</td>
      <td><strong>${escapeHtml(sale.name)}</strong>${sale.saleType === "bouquet" ? " · букет" : ""}</td>
      <td>${sale.quantity} шт.</td>
      ${canManage ? `
        <td>${money(sale.revenue)}</td>
        <td>${money(sale.cost)}</td>
        <td><strong>${money(sale.profit)}</strong></td>
      ` : ""}
    </tr>
  `).join("");
}

function renderWriteoffs() {
  if (state.writeoffs.length === 0) {
    const colspan = canManage ? 5 : 4;
    writeoffsBody.innerHTML = `<tr class="empty-row"><td colspan="${colspan}">Списаний пока нет.</td></tr>`;
    return;
  }

  writeoffsBody.innerHTML = state.writeoffs.map((item) => `
    <tr>
      <td>${date(item.createdAt)}</td>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>${item.quantity} шт.</td>
      ${canManage ? `<td><strong>${money(item.cost)}</strong></td>` : ""}
      <td>${escapeHtml(item.reason)}</td>
    </tr>
  `).join("");
}

function addBouquetRow(item = {}) {
  const row = document.createElement("div");
  row.className = "bouquet-item";
  row.innerHTML = `
    <label>
      Цветок
      <select class="bouquet-flower"></select>
    </label>
    <label>
      Кол-во
      <input class="bouquet-quantity" type="number" min="1" step="1" value="${item.quantity || 1}">
    </label>
    <button class="row-btn" type="button" title="Убрать">x</button>
  `;
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    renderBouquetPreview();
  });
  bouquetItems.append(row);
  renderFlowerOptions();
  if (item.name) row.querySelector(".bouquet-flower").value = item.name;
  renderBouquetPreview();
}

function resetBouquetRows() {
  bouquetItems.innerHTML = "";
}

function getBouquetItems() {
  return [...bouquetItems.querySelectorAll(".bouquet-item")].map((row) => ({
    name: row.querySelector(".bouquet-flower").value,
    quantity: toNumber(row.querySelector(".bouquet-quantity").value)
  })).filter((item) => item.name && item.quantity > 0);
}

function renderBouquetPreview() {
  const items = getBouquetItems();
  const price = toNumber(document.querySelector("[name='bouquetPrice']").value);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const cost = items.reduce((sum, item) => sum + calculateFifoCost(item.name, item.quantity), 0);

  setText("#bouquetQtyPreview", `${quantity} шт.`);
  setText("#bouquetPricePreview", money(price));
  setText("#bouquetCostPreview", money(cost));
  setText("#bouquetProfitPreview", money(price - cost));
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

function calculateFifoCost(name, quantity) {
  let remaining = quantity;
  let cost = 0;
  const rows = state.batches
    .filter((batch) => batch.name === name)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const batch of rows) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    cost += take * (batch.cost || 0);
    remaining -= take;
  }

  return cost;
}

function getAvailable(name) {
  return state.batches
    .filter((batch) => batch.name === name)
    .reduce((sum, batch) => sum + batch.quantity, 0);
}

function sumQuantity(batches) {
  return batches.reduce((sum, batch) => sum + batch.quantity, 0);
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

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
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
