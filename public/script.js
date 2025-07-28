let drinkTypes = [];
let selectedDrink = null;
let selectedSize = null;

// On DOM ready
window.addEventListener("DOMContentLoaded", () => {
  loadStats();
  loadDrinkTypes();
  loadEntries();
});

// Load stats
async function loadStats() {
  try {
    const [todayRes, allRes] = await Promise.all([
      fetch("/api/total-today"),
      fetch("/api/total-all"),
    ]);
    const today = await todayRes.json();
    const all = await allRes.json();

    document.getElementById("todayTotal").textContent = Math.round(today.total);
    document.getElementById("todayCount").textContent = today.count;
    document.getElementById("allTimeTotal").textContent = Math.round(all.total);
  } catch (err) {
    console.error("Error loading stats", err);
  }
}

// Load drinks
async function loadDrinkTypes() {
  try {
    const res = await fetch("/api/types");
    drinkTypes = await res.json();
    renderDrinks();
  } catch (err) {
    console.error("Error loading drink types", err);
  }
}

function renderDrinks() {
  const grid = document.getElementById("drinksGrid");
  grid.innerHTML = "";
  const addBtn = document.createElement("div");
  addBtn.className = "drink-card add-drink";
  addBtn.onclick = showAddDrinkModal;
  addBtn.innerHTML = `<div class="plus">+</div><div class="label">Add Drink</div>`;
  grid.appendChild(addBtn);

  drinkTypes.forEach((drink) => {
    const card = document.createElement("div");
    card.className = "drink-card";

    // Show caffeine range if multiple sizes
    const caffeineDisplay =
      drink.sizes.length > 1
        ? `${Math.min(...drink.sizes.map((s) => s.caffeineMg))}-${Math.max(
            ...drink.sizes.map((s) => s.caffeineMg)
          )} mg`
        : `${drink.sizes[0].caffeineMg} mg`;

    card.innerHTML = `
      <div class="drink-img-container">
        ${
          drink.imageUrl
            ? `<img src="${drink.imageUrl}" alt="${drink.name}" class="drink-img" />`
            : `<div class="drink-img-placeholder">${drink.name[0]}</div>`
        }
      </div>
      <div class="drink-name">${drink.name}</div>
      <div class="drink-caffeine">${caffeineDisplay}</div>
      ${
        drink.sizes.length > 1
          ? '<div class="size-count">' + drink.sizes.length + " sizes</div>"
          : ""
      }
    `;
    card.onclick = () => selectDrink(drink);
    grid.appendChild(card);
  });
}

// Drink selection
function selectDrink(drink) {
  selectedDrink = drink;

  if (drink.sizes.length === 1) {
    // Only one size, go directly to entry modal
    selectedSize = drink.sizes[0];
    showAddEntryModal();
  } else {
    // Multiple sizes, show size selection modal
    showSizeSelectionModal();
  }
}

function showSizeSelectionModal() {
  document.getElementById(
    "sizeModalTitle"
  ).textContent = `Select ${selectedDrink.name} Size`;

  const sizeOptions = document.getElementById("sizeOptions");
  sizeOptions.innerHTML = "";

  selectedDrink.sizes.forEach((size) => {
    const sizeOption = document.createElement("div");
    sizeOption.className = "size-option";
    sizeOption.innerHTML = `
      <div class="size-option-name">${size.name}</div>
      <div class="size-option-caffeine">${size.caffeineMg} mg</div>
    `;
    sizeOption.onclick = () => selectSize(size);
    sizeOptions.appendChild(sizeOption);
  });

  document.getElementById("sizeSelectionModal").style.display = "flex";
}

function selectSize(size) {
  selectedSize = size;
  closeSizeSelectionModal();
  showAddEntryModal();
}

function showAddEntryModal() {
  const fullName = `${selectedSize.name} ${selectedDrink.name}`;
  document.getElementById(
    "entryModalTitle"
  ).textContent = `Add ${fullName} Entry`;
  document.getElementById("selectedDrinkInfo").innerHTML = `
    <div><strong>${fullName}</strong> - ${selectedSize.caffeineMg} mg</div>
  `;
  document.getElementById("addEntryModal").style.display = "flex";
}

function closeSizeSelectionModal() {
  document.getElementById("sizeSelectionModal").style.display = "none";
}

// Size variant management for add drink form
function addSizeVariant() {
  const container = document.getElementById("sizeVariants");
  const variant = document.createElement("div");
  variant.className = "size-variant";
  variant.innerHTML = `
    <input type="text" placeholder="Size name (e.g., 12oz)" class="size-name" required />
    <input type="number" placeholder="Caffeine (mg)" class="size-caffeine" required min="1" />
    <button type="button" onclick="removeSizeVariant(this)" class="remove-size">×</button>
  `;
  container.appendChild(variant);
}

function removeSizeVariant(button) {
  const container = document.getElementById("sizeVariants");
  if (container.children.length > 1) {
    button.parentNode.remove();
  }
}

// Modals
function showAddDrinkModal() {
  document.getElementById("addDrinkModal").style.display = "flex";
}

function closeAddDrinkModal() {
  document.getElementById("addDrinkModal").style.display = "none";
  document.getElementById("addDrinkForm").reset();

  // Reset to one size variant
  const container = document.getElementById("sizeVariants");
  container.innerHTML = `
    <div class="size-variant">
      <input type="text" placeholder="Size name (e.g., 12oz)" class="size-name" required />
      <input type="number" placeholder="Caffeine (mg)" class="size-caffeine" required min="1" />
      <button type="button" onclick="removeSizeVariant(this)" class="remove-size">×</button>
    </div>
  `;
}

function closeAddEntryModal() {
  document.getElementById("addEntryModal").style.display = "none";
  document.getElementById("addEntryForm").reset();
  selectedDrink = null;
  selectedSize = null;
}

window.onclick = function (e) {
  if (e.target.classList.contains("modal")) {
    closeAddDrinkModal();
    closeAddEntryModal();
    closeSizeSelectionModal();
  }
};

// Add drink form
const addDrinkForm = document.getElementById("addDrinkForm");
addDrinkForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("drinkName").value;
  const imageUrl = document.getElementById("imageUrl").value;

  // Collect all size variants
  const sizeVariants = [];
  const variants = document.querySelectorAll(".size-variant");

  for (const variant of variants) {
    const sizeName = variant.querySelector(".size-name").value.trim();
    const caffeine = variant.querySelector(".size-caffeine").value;

    if (sizeName && caffeine) {
      sizeVariants.push({
        name: sizeName,
        caffeineMg: parseFloat(caffeine),
      });
    }
  }

  if (sizeVariants.length === 0) {
    showToast("Please add at least one size variant", "error");
    return;
  }

  try {
    const res = await fetch("/api/types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        imageUrl,
        sizes: sizeVariants,
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to add drink");
    }

    closeAddDrinkModal();
    loadDrinkTypes();
    showToast("Drink added!", "success");
  } catch (err) {
    showToast(err.message || "Could not add drink", "error");
  }
});

// Add entry form
const addEntryForm = document.getElementById("addEntryForm");
addEntryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedDrink || !selectedSize) return;

  const desc = document.getElementById("customDescription").value;

  try {
    const res = await fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        drinkName: selectedDrink.name,
        sizeName: selectedSize.name,
        caffeineMg: selectedSize.caffeineMg,
        customDescription: desc,
        isCustomDrink: false,
      }),
    });

    if (!res.ok) throw new Error("Failed to add entry");

    closeAddEntryModal();
    loadStats();
    loadEntries();
    showToast("Entry added!", "success");
  } catch (err) {
    showToast("Could not add entry", "error");
  }
});

// Load entries
async function loadEntries() {
  const list = document.getElementById("entriesList");
  list.innerHTML = `<div class="loading">Loading...</div>`;
  try {
    const res = await fetch("/api/entries");
    const data = await res.json();
    if (!data.length) {
      list.innerHTML = `<div class="loading">No entries yet</div>`;
      return;
    }
    list.innerHTML = data.map(renderEntry).join("");
  } catch (err) {
    list.innerHTML = `<div class="loading">Failed to load entries</div>`;
  }
}

function renderEntry(entry) {
  const displayName =
    entry.fullName || `${entry.sizeName || ""} ${entry.drinkName}`.trim();

  return `
    <div class="entry-item">
      <div class="entry-header">
        <span>${displayName}</span>
        <span>${entry.caffeineMg} mg</span>
      </div>
      <div class="entry-time">${formatTime(entry.timestamp)}</div>
      ${
        entry.customDescription
          ? `<div class="entry-description">${entry.customDescription}</div>`
          : ""
      }
    </div>
  `;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return date.toLocaleDateString();
}

function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className = `toast show toast-${type}`;
  setTimeout(() => toast.classList.remove("show"), 3000);
}
