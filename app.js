const productsData = {
  "מוצר רגיל": {
    "שתייה": [
      { name: "לימונדה יפנית", price: 100 },
      { name: "תה ירוק", price: 100 },
      { name: "מים", price: 100 }
    ],
    "אוכל קל": [
      { name: "קאסטלה יפנית", price: 160 },
      { name: "פנקייק יפני", price: 125 }
    ],
    "אוכל כבד": [
      { name: "ראמן מסורתי", price: 390 },
      { name: "סושי מיקס", price: 390 },
      { name: "טריאקי סלמון", price: 350 },
      { name: "גיוזה לוקוס", price: 380 }
    ],
    "ארוחות": [{ name: "ארוחת גפניטה", price: 550 }]
  },
  "מבצע": {
    "מבצעים": [
      { name: "מבצע קטן", price: 1560, regularPrice: 2950, details: "5 ראמן, 10 לימונדה" },
      { name: "מבצע גדול", price: 3120, regularPrice: 5900, details: "10 ראמן, 20 לימונדה" }
    ]
  }
};

const STORAGE_KEY = "sales-calculator-state-v2";

const rowsBody = document.getElementById("rowsBody");
const totalValue = document.getElementById("totalValue");
const savingsLine = document.getElementById("savingsLine");
const formatOutput = document.getElementById("formatOutput");
const toast = document.getElementById("toast");
const copyButton = document.getElementById("copyButton");
const outputCopyButton = document.getElementById("outputCopyButton");
const outputClearButton = document.getElementById("outputClearButton");
const addRowButton = document.getElementById("addRowButton");
const clearAllButton = document.getElementById("clearAllButton");

const rows = [];
const rowRefs = new Map();
const rowErrors = new Map();
let rowCounter = 1;
let toastTimer = null;

const regularPriceIndex = Object.values(productsData["מוצר רגיל"] || {}).flat().map((product) => ({
  name: normalizeText(product.name),
  price: product.price
}));

function formatNumber(value) {
  return Number(value).toLocaleString("he-IL");
}

function formatCurrency(value) {
  return `₪${formatNumber(value)}`;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sanitizeQuantity(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return { value: 1, invalid: true };
  }
  return { value: parsed, invalid: false };
}

function getTypes() {
  return Object.keys(productsData);
}

function getCategories(type) {
  return Object.keys(productsData[type] || {});
}

function getProducts(type, category) {
  if (!type || !category || !productsData[type] || !productsData[type][category]) {
    return [];
  }
  return productsData[type][category];
}

function buildDefaultRow(seed = {}) {
  const types = getTypes();
  const type = types.includes(seed.type) ? seed.type : types[0] || "";

  const categories = getCategories(type);
  const category = categories.includes(seed.category) ? seed.category : categories[0] || "";

  const products = getProducts(type, category);
  const incomingProductIndex = Number.parseInt(seed.productIndex, 10);
  const productIndex = Number.isInteger(incomingProductIndex) && incomingProductIndex >= 0 && incomingProductIndex < products.length
    ? incomingProductIndex
    : products.length
      ? 0
      : -1;

  const quantityInfo = sanitizeQuantity(seed.quantity);

  return {
    id: `row-${Date.now()}-${rowCounter++}`,
    type,
    category,
    productIndex,
    quantity: quantityInfo.value
  };
}

function ensureErrorObject(rowId) {
  if (!rowErrors.has(rowId)) {
    rowErrors.set(rowId, { category: "", product: "", quantity: "" });
  }
  return rowErrors.get(rowId);
}

function setFieldError(rowId, field, message) {
  const errors = ensureErrorObject(rowId);
  errors[field] = message || "";

  if (!errors.category && !errors.product && !errors.quantity) {
    rowErrors.delete(rowId);
  }

  applyRowErrors(rowId);
}

function clearAllRowErrors(rowId) {
  rowErrors.delete(rowId);
  applyRowErrors(rowId);
}

function applyRowErrors(rowId) {
  const refs = rowRefs.get(rowId);
  if (!refs) {
    return;
  }

  const errors = rowErrors.get(rowId) || { category: "", product: "", quantity: "" };

  refs.categoryError.textContent = errors.category;
  refs.productError.textContent = errors.product;
  refs.quantityError.textContent = errors.quantity;

  refs.categorySelect.classList.toggle("has-error", Boolean(errors.category));
  refs.productSelect.classList.toggle("has-error", Boolean(errors.product));
  refs.quantityInput.classList.toggle("has-error", Boolean(errors.quantity));
}

function findRegularUnitPriceByToken(token) {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    return null;
  }

  const exact = regularPriceIndex.find((item) => item.name === normalizedToken);
  if (exact) {
    return exact.price;
  }

  const partial = regularPriceIndex.find(
    (item) => item.name.includes(normalizedToken) || normalizedToken.includes(item.name)
  );
  return partial ? partial.price : null;
}

function computeBundleRegularPrice(product) {
  if (!product || typeof product.details !== "string") {
    return null;
  }

  const parts = product.details
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  let sum = 0;
  for (const part of parts) {
    const match = part.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      return null;
    }

    const amount = Number.parseInt(match[1], 10);
    const unitPrice = findRegularUnitPriceByToken(match[2]);
    if (!Number.isFinite(unitPrice)) {
      return null;
    }

    sum += amount * unitPrice;
  }

  return sum;
}

function getComparableRegularPrice(product) {
  if (!product) {
    return null;
  }

  if (Number.isFinite(product.regularPrice)) {
    return product.regularPrice;
  }

  const inferred = computeBundleRegularPrice(product);
  return Number.isFinite(inferred) ? inferred : product.price;
}

function populateSelect(select, options, selectedValue, placeholderText, includePlaceholder = true) {
  select.innerHTML = "";

  if (includePlaceholder) {
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholderText;
    select.appendChild(placeholderOption);
  }

  options.forEach((option) => {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    select.appendChild(optionEl);
  });

  if (selectedValue != null) {
    select.value = String(selectedValue);
  }

  if (select.value !== String(selectedValue ?? "")) {
    select.value = includePlaceholder ? "" : options[0]?.value || "";
  }
}

function getRowProduct(row) {
  const products = getProducts(row.type, row.category);
  if (!products.length || row.productIndex < 0 || row.productIndex >= products.length) {
    return null;
  }
  return products[row.productIndex];
}

function buildRowOutputLabel(product) {
  if (!product) {
    return "";
  }
  const details = product.details ? ` (${product.details})` : "";
  return `${product.name}${details}`;
}

function createTableCell(label) {
  const td = document.createElement("td");
  td.setAttribute("data-label", label);

  const wrap = document.createElement("div");
  wrap.className = "cell";
  td.appendChild(wrap);

  return { td, wrap };
}

function syncRowSelects(row, refs) {
  const typeOptions = getTypes().map((type) => ({ value: type, label: type }));
  populateSelect(refs.typeSelect, typeOptions, row.type, "בחרו סוג", false);

  const categories = getCategories(row.type);
  const categoryOptions = categories.map((category) => ({ value: category, label: category }));

  if (!row.category || !categories.includes(row.category)) {
    row.category = "";
  }

  populateSelect(refs.categorySelect, categoryOptions, row.category, "בחרו קטגוריה");

  const products = getProducts(row.type, row.category);
  const productOptions = products.map((product, index) => {
    const details = product.details ? ` (${product.details})` : "";
    return {
      value: String(index),
      label: `${product.name}${details} • ${formatCurrency(product.price)}`
    };
  });

  if (!Number.isInteger(row.productIndex) || row.productIndex < 0 || row.productIndex >= products.length) {
    row.productIndex = -1;
  }

  populateSelect(refs.productSelect, productOptions, row.productIndex >= 0 ? String(row.productIndex) : "", "בחרו מוצר");
  refs.quantityInput.value = String(row.quantity);
}

function renderRows() {
  rowsBody.innerHTML = "";
  rowRefs.clear();

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");

    const typeCell = createTableCell("סוג");
    const categoryCell = createTableCell("קטגוריה");
    const productCell = createTableCell("מוצר");
    const quantityCell = createTableCell("כמות");
    const unitPriceCell = createTableCell("מחיר ליחידה");
    const rowTotalCell = createTableCell("סכום שורה");
    const actionCell = createTableCell("פעולות");

    const typeSelect = document.createElement("select");
    typeSelect.className = "field";
    typeSelect.setAttribute("aria-label", `סוג שורה ${index + 1}`);
    typeCell.wrap.appendChild(typeSelect);

    const categorySelect = document.createElement("select");
    categorySelect.className = "field";
    categorySelect.setAttribute("aria-label", `קטגוריה שורה ${index + 1}`);
    categoryCell.wrap.appendChild(categorySelect);

    const categoryError = document.createElement("div");
    categoryError.className = "error-msg";
    categoryError.setAttribute("aria-live", "polite");
    categoryCell.wrap.appendChild(categoryError);

    const productSelect = document.createElement("select");
    productSelect.className = "field";
    productSelect.setAttribute("aria-label", `מוצר שורה ${index + 1}`);
    productCell.wrap.appendChild(productSelect);

    const productError = document.createElement("div");
    productError.className = "error-msg";
    productError.setAttribute("aria-live", "polite");
    productCell.wrap.appendChild(productError);

    const quantityWrap = document.createElement("div");
    quantityWrap.className = "qty-wrap";

    const minusButton = document.createElement("button");
    minusButton.type = "button";
    minusButton.className = "qty-btn";
    minusButton.textContent = "−";
    minusButton.setAttribute("aria-label", `הפחת כמות בשורה ${index + 1}`);

    const quantityInput = document.createElement("input");
    quantityInput.type = "number";
    quantityInput.min = "1";
    quantityInput.step = "1";
    quantityInput.inputMode = "numeric";
    quantityInput.className = "qty-input";
    quantityInput.setAttribute("aria-label", `כמות שורה ${index + 1}`);

    const plusButton = document.createElement("button");
    plusButton.type = "button";
    plusButton.className = "qty-btn";
    plusButton.textContent = "+";
    plusButton.setAttribute("aria-label", `הוסף כמות בשורה ${index + 1}`);

    quantityWrap.appendChild(minusButton);
    quantityWrap.appendChild(quantityInput);
    quantityWrap.appendChild(plusButton);
    quantityCell.wrap.appendChild(quantityWrap);

    const quantityError = document.createElement("div");
    quantityError.className = "error-msg";
    quantityError.setAttribute("aria-live", "polite");
    quantityCell.wrap.appendChild(quantityError);

    const unitPrice = document.createElement("span");
    unitPrice.className = "price";
    unitPrice.textContent = formatCurrency(0);
    unitPriceCell.wrap.appendChild(unitPrice);

    const rowTotal = document.createElement("span");
    rowTotal.className = "row-total";
    rowTotal.textContent = formatCurrency(0);
    rowTotalCell.wrap.appendChild(rowTotal);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn-secondary row-remove";
    removeButton.textContent = "מחק שורה";
    removeButton.setAttribute("aria-label", `מחק שורה ${index + 1}`);
    actionCell.wrap.appendChild(removeButton);

    tr.appendChild(typeCell.td);
    tr.appendChild(categoryCell.td);
    tr.appendChild(productCell.td);
    tr.appendChild(quantityCell.td);
    tr.appendChild(unitPriceCell.td);
    tr.appendChild(rowTotalCell.td);
    tr.appendChild(actionCell.td);

    rowsBody.appendChild(tr);

    rowRefs.set(row.id, {
      tr,
      typeSelect,
      categorySelect,
      productSelect,
      quantityInput,
      minusButton,
      plusButton,
      unitPrice,
      rowTotal,
      categoryError,
      productError,
      quantityError
    });

    syncRowSelects(row, rowRefs.get(row.id));

    typeSelect.addEventListener("change", () => {
      row.type = typeSelect.value;
      const categories = getCategories(row.type);
      row.category = categories[0] || "";
      const products = getProducts(row.type, row.category);
      row.productIndex = products.length ? 0 : -1;
      clearAllRowErrors(row.id);
      syncRowSelects(row, rowRefs.get(row.id));
      refreshState({ persist: true, updateOutput: true, showValidationErrors: false });
    });

    categorySelect.addEventListener("change", () => {
      row.category = categorySelect.value;
      const products = getProducts(row.type, row.category);
      row.productIndex = products.length ? 0 : -1;
      setFieldError(row.id, "category", row.category ? "" : "יש לבחור קטגוריה");
      setFieldError(row.id, "product", row.productIndex >= 0 ? "" : "יש לבחור מוצר");
      syncRowSelects(row, rowRefs.get(row.id));
      refreshState({ persist: true, updateOutput: true, showValidationErrors: false });
    });

    productSelect.addEventListener("change", () => {
      const nextIndex = Number.parseInt(productSelect.value, 10);
      row.productIndex = Number.isInteger(nextIndex) ? nextIndex : -1;
      setFieldError(row.id, "product", row.productIndex >= 0 ? "" : "יש לבחור מוצר");
      refreshState({ persist: true, updateOutput: true, showValidationErrors: false });
    });

    const applyQuantityChange = (rawValue) => {
      const quantityInfo = sanitizeQuantity(rawValue);
      row.quantity = quantityInfo.value;
      quantityInput.value = String(row.quantity);

      if (quantityInfo.invalid) {
        setFieldError(row.id, "quantity", "כמות לא תקינה, עודכנה ל-1");
      } else {
        setFieldError(row.id, "quantity", "");
      }

      refreshState({ persist: true, updateOutput: true, showValidationErrors: false });
    };

    quantityInput.addEventListener("input", () => {
      applyQuantityChange(quantityInput.value);
    });

    quantityInput.addEventListener("blur", () => {
      applyQuantityChange(quantityInput.value);
    });

    minusButton.addEventListener("click", () => {
      row.quantity = Math.max(1, row.quantity - 1);
      quantityInput.value = String(row.quantity);
      setFieldError(row.id, "quantity", "");
      refreshState({ persist: true, updateOutput: true, showValidationErrors: false });
    });

    plusButton.addEventListener("click", () => {
      row.quantity = row.quantity + 1;
      quantityInput.value = String(row.quantity);
      setFieldError(row.id, "quantity", "");
      refreshState({ persist: true, updateOutput: true, showValidationErrors: false });
    });

    removeButton.addEventListener("click", () => {
      const rowIndex = rows.findIndex((entry) => entry.id === row.id);
      if (rowIndex >= 0) {
        rows.splice(rowIndex, 1);
      }

      rowErrors.delete(row.id);
      rowRefs.delete(row.id);

      if (!rows.length) {
        rows.push(buildDefaultRow());
      }

      renderRows();
      refreshState({ persist: true, updateOutput: true, showValidationErrors: false });
    });

    applyRowErrors(row.id);
  });
}

function validateAndMeasureRows(showValidationErrors) {
  const items = [];
  let total = 0;
  let savings = 0;
  let canCopy = true;

  rows.forEach((row) => {
    const refs = rowRefs.get(row.id);

    const quantityInfo = sanitizeQuantity(row.quantity);
    if (quantityInfo.invalid) {
      row.quantity = 1;
      if (refs) {
        refs.quantityInput.value = "1";
      }
      if (showValidationErrors) {
        setFieldError(row.id, "quantity", "כמות לא תקינה, עודכנה ל-1");
      }
      canCopy = false;
    }

    const categories = getCategories(row.type);
    const categoryValid = Boolean(row.category) && categories.includes(row.category);
    if (showValidationErrors) {
      setFieldError(row.id, "category", categoryValid ? "" : "יש לבחור קטגוריה");
    }

    const products = categoryValid ? getProducts(row.type, row.category) : [];
    const productValid = Number.isInteger(row.productIndex) && row.productIndex >= 0 && row.productIndex < products.length;
    if (showValidationErrors) {
      setFieldError(row.id, "product", productValid ? "" : "יש לבחור מוצר");
    }

    const product = productValid ? products[row.productIndex] : null;
    const quantity = row.quantity;
    const unitPrice = product ? product.price : 0;
    const rowTotal = unitPrice * quantity;

    total += rowTotal;

    if (product) {
      const regularPrice = getComparableRegularPrice(product);
      if (Number.isFinite(regularPrice) && regularPrice > product.price) {
        savings += (regularPrice - product.price) * quantity;
      }

      items.push({
        type: row.type,
        category: row.category,
        product,
        quantity,
        unitPrice,
        rowTotal
      });
    }

    if (!categoryValid || !productValid || quantityInfo.invalid) {
      canCopy = false;
    }

    if (refs) {
      refs.unitPrice.textContent = formatCurrency(unitPrice);
      refs.rowTotal.textContent = formatCurrency(rowTotal);
      refs.quantityInput.value = String(row.quantity);
    }
  });

  return { items, total, savings, canCopy };
}

function buildOutputText(summary) {
  if (!summary.items.length) {
    return "";
  }

  const lines = ["פורמט מכירה"];

  summary.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.category} - ${buildRowOutputLabel(item.product)} | כמות: ${item.quantity} | מחיר ליחידה: ${formatCurrency(
        item.unitPrice
      )} | סכום: ${formatCurrency(item.rowTotal)}`
    );
  });

  lines.push(`סה״כ: ${formatCurrency(summary.total)}`);

  if (summary.savings > 0) {
    lines.push(`חסכת ${formatCurrency(summary.savings)}`);
  }

  return lines.join("\n");
}

function refreshState({ persist, updateOutput, showValidationErrors }) {
  const summary = validateAndMeasureRows(showValidationErrors);

  totalValue.textContent = formatCurrency(summary.total);

  if (summary.savings > 0) {
    savingsLine.textContent = `חסכת ${formatCurrency(summary.savings)}`;
    savingsLine.classList.remove("hidden");
  } else {
    savingsLine.classList.add("hidden");
  }

  if (updateOutput) {
    formatOutput.textContent = buildOutputText(summary);
  }

  if (persist) {
    saveState();
  }

  return summary;
}

function saveState() {
  const state = rows.map((row) => ({
    type: row.type,
    category: row.category,
    productIndex: row.productIndex,
    quantity: row.quantity
  }));

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Local storage might be blocked by the browser mode.
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return false;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) {
      return false;
    }

    parsed.forEach((entry) => {
      rows.push(buildDefaultRow(entry));
    });

    return rows.length > 0;
  } catch (error) {
    return false;
  }
}

function hideToast() {
  toast.classList.remove("show");
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

function showToast() {
  hideToast();
  toast.classList.add("show");
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    toastTimer = null;
  }, 1500);
}

async function copyText(text) {
  if (!text) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.style.position = "fixed";
    fallback.style.left = "-9999px";
    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();

    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (copyError) {
      success = false;
    }

    document.body.removeChild(fallback);
    return success;
  }
}

async function handleCopy() {
  const summary = refreshState({ persist: true, updateOutput: true, showValidationErrors: true });
  if (!summary.canCopy) {
    return;
  }

  const text = buildOutputText(summary);
  if (!text) {
    return;
  }

  const copied = await copyText(text);
  if (copied) {
    showToast();
  }
}

function resetAll() {
  rows.splice(0, rows.length);
  rowErrors.clear();
  rowRefs.clear();

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // Ignore storage errors.
  }

  hideToast();

  rows.push(buildDefaultRow());
  renderRows();
  refreshState({ persist: false, updateOutput: true, showValidationErrors: false });
}

addRowButton.addEventListener("click", () => {
  rows.push(buildDefaultRow());
  renderRows();
  refreshState({ persist: true, updateOutput: true, showValidationErrors: false });
});

clearAllButton.addEventListener("click", () => {
  resetAll();
});

copyButton.addEventListener("click", () => {
  handleCopy();
});

outputCopyButton.addEventListener("click", () => {
  handleCopy();
});

outputClearButton.addEventListener("click", () => {
  formatOutput.textContent = "";
  hideToast();
});

if (!loadState()) {
  rows.push(buildDefaultRow());
}

renderRows();
refreshState({ persist: false, updateOutput: true, showValidationErrors: false });

