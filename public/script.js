let drinkTypes = [];
let selectedDrink = null;
let selectedSize = null;
let currentUser = null;
let currentPeriod = "week";

// On DOM ready
window.addEventListener("DOMContentLoaded", () => {
  checkAuthStatus();
});

// Check if user is already authenticated
async function checkAuthStatus() {
  try {
    const response = await fetch("/api/auth/check", {
      credentials: "include",
    });

    if (response.ok) {
      const user = await response.json();
      currentUser = user;
      showMainApp();
      initializeApp();
    } else {
      showLoginScreen();
    }
  } catch (error) {
    console.error("Auth check failed:", error);
    showLoginScreen();
  }
}

// Google Sign-In callback
function handleCredentialResponse(response) {
  fetch("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      token: response.credential,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        currentUser = data.user;
        showMainApp();
        initializeApp();
        showToast(`Welcome, ${data.user.name}!`, "success");
      } else {
        showToast("Login failed. Please try again.", "error");
      }
    })
    .catch((error) => {
      console.error("Login error:", error);
      showToast("Login failed. Please try again.", "error");
    });
}

// Sign out
async function signOut() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });

    currentUser = null;
    showLoginScreen();
    showToast("Signed out successfully", "success");
  } catch (error) {
    console.error("Sign out error:", error);
    showToast("Error signing out", "error");
  }
}

// Show/hide screens
function showLoginScreen() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("mainApp").style.display = "none";
}

function showMainApp() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("mainApp").style.display = "flex";

  // Update user info in header
  if (currentUser) {
    document.getElementById("userAvatar").src = currentUser.picture || "";
    document.getElementById("userName").textContent =
      currentUser.name || "User";
  }
}

// Initialize app after login
function initializeApp() {
  loadStats();
  loadDrinkTypes();
  loadEntries();
  loadLeaderboard();
}

// Tab functionality
function showTab(tabName) {
  // Hide all tabs
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.remove("active");
  });

  // Remove active class from all buttons
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Show selected tab
  document.getElementById(tabName + "Tab").classList.add("active");

  // Add active class to clicked button
  event.target.classList.add("active");

  // Load leaderboard data if switching to leaderboard
  if (tabName === "leaderboard") {
    loadLeaderboard();
  }
}

// Load stats
async function loadStats() {
  if (!currentUser) return;

  try {
    const [todayRes, allRes] = await Promise.all([
      fetch("/api/total-today", { credentials: "include" }),
      fetch("/api/total-all", { credentials: "include" }),
    ]);

    if (!todayRes.ok || !allRes.ok) {
      throw new Error("Failed to fetch stats");
    }

    const today = await todayRes.json();
    const all = await allRes.json();

    document.getElementById("todayTotal").textContent = Math.round(today.total);
    document.getElementById("todayCount").textContent = today.count;
    document.getElementById("allTimeTotal").textContent = Math.round(all.total);
  } catch (err) {
    console.error("Error loading stats", err);
    showToast("Failed to load stats", "error");
  }
}

// Load drinks
async function loadDrinkTypes() {
  try {
    const res = await fetch("/api/types", { credentials: "include" });
    if (!res.ok) throw new Error("Failed to fetch drink types");

    drinkTypes = await res.json();
    renderDrinks();
  } catch (err) {
    console.error("Error loading drink types", err);
    showToast("Failed to load drinks", "error");

    // Show empty state
    const grid = document.getElementById("drinksGrid");
    grid.innerHTML = `
      <div class="drink-card add-drink" onclick="showAddDrinkModal()">
        <div class="plus">+</div>
        <div class="label">Add Drink</div>
      </div>
      <div class="loading">Failed to load drinks. Click + to add manually.</div>
    `;
  }
}

function renderDrinks() {
  const grid = document.getElementById("drinksGrid");
  grid.innerHTML = "";

  // Add button
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
      <button class="delete-btn" onclick="deleteDrinkType('${
        drink._id
      }', event)" title="Delete drink" aria-label="Delete ${
      drink.name
    }">×</button>
      <div class="drink-img-container">
        ${
          drink.imageUrl && drink.imageUrl !== "/images/noImage.png"
            ? `<img src="${drink.imageUrl}" alt="${drink.name}" class="drink-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" loading="lazy" />`
            : ""
        }
        <div class="drink-img-placeholder" ${
          drink.imageUrl && drink.imageUrl !== "/images/noImage.png"
            ? 'style="display:none"'
            : ""
        }>${drink.name.charAt(0).toUpperCase()}</div>
      </div>
      <div class="drink-name">${escapeHtml(drink.name)}</div>
      <div class="drink-caffeine">${caffeineDisplay}</div>
      ${
        drink.sizes.length > 1
          ? '<div class="size-count">' + drink.sizes.length + " sizes</div>"
          : ""
      }
    `;
    card.onclick = (e) => {
      if (!e.target.classList.contains("delete-btn")) {
        selectDrink(drink);
      }
    };
    grid.appendChild(card);
  });
}

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, function (m) {
    return map[m];
  });
}

// Delete drink type
async function deleteDrinkType(drinkId, event) {
  event.stopPropagation();

  if (
    !confirm(
      "Are you sure you want to delete this drink type? This action cannot be undone."
    )
  ) {
    return;
  }

  try {
    const res = await fetch(`/api/types/${drinkId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to delete drink type");
    }

    showToast("Drink type deleted!", "success");
    loadDrinkTypes();
  } catch (err) {
    console.error("Error deleting drink type", err);
    showToast(err.message || "Failed to delete drink type", "error");
  }
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
      <div class="size-option-name">${escapeHtml(size.name)}</div>
      <div class="size-option-caffeine">${size.caffeineMg} mg caffeine</div>
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
    <div><strong>${escapeHtml(fullName)}</strong> - ${
    selectedSize.caffeineMg
  } mg caffeine</div>
  `;
  document.getElementById("addEntryModal").style.display = "flex";

  // Focus the description textarea for better UX
  setTimeout(() => {
    document.getElementById("customDescription").focus();
  }, 100);
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
    <input type="number" placeholder="Caffeine (mg)" class="size-caffeine" required min="1" step="0.1" />
    <button type="button" onclick="removeSizeVariant(this)" class="remove-size" title="Remove size">×</button>
  `;
  container.appendChild(variant);

  // Focus the new size name input
  variant.querySelector(".size-name").focus();
}

function removeSizeVariant(button) {
  const container = document.getElementById("sizeVariants");
  if (container.children.length > 1) {
    button.parentNode.remove();
  } else {
    showToast("You must have at least one size variant", "error");
  }
}

// Modals
function showAddDrinkModal() {
  document.getElementById("addDrinkModal").style.display = "flex";
  // Focus the drink name input
  setTimeout(() => {
    document.getElementById("drinkName").focus();
  }, 100);
}

function closeAddDrinkModal() {
  document.getElementById("addDrinkModal").style.display = "none";
  document.getElementById("addDrinkForm").reset();

  // Reset to one size variant
  const container = document.getElementById("sizeVariants");
  container.innerHTML = `
    <div class="size-variant">
      <input type="text" placeholder="Size name (e.g., 12oz)" class="size-name" required />
      <input type="number" placeholder="Caffeine (mg)" class="size-caffeine" required min="1" step="0.1" />
      <button type="button" onclick="removeSizeVariant(this)" class="remove-size" title="Remove size">×</button>
    </div>
  `;
}

function closeAddEntryModal() {
  document.getElementById("addEntryModal").style.display = "none";
  document.getElementById("addEntryForm").reset();
  selectedDrink = null;
  selectedSize = null;
}

// Close modals when clicking outside
window.onclick = function (e) {
  if (e.target.classList.contains("modal")) {
    closeAddDrinkModal();
    closeAddEntryModal();
    closeSizeSelectionModal();
  }
};

// Close modals with Escape key
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeAddDrinkModal();
    closeAddEntryModal();
    closeSizeSelectionModal();
  }
});

// Add drink form
const addDrinkForm = document.getElementById("addDrinkForm");
addDrinkForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("drinkName").value.trim();
  const imageUrl = document.getElementById("imageUrl").value.trim();

  if (!name) {
    showToast("Please enter a drink name", "error");
    document.getElementById("drinkName").focus();
    return;
  }

  // Collect all size variants
  const sizeVariants = [];
  const variants = document.querySelectorAll(".size-variant");

  for (const variant of variants) {
    const sizeName = variant.querySelector(".size-name").value.trim();
    const caffeine = variant.querySelector(".size-caffeine").value;

    if (sizeName && caffeine && parseFloat(caffeine) > 0) {
      sizeVariants.push({
        name: sizeName,
        caffeineMg: parseFloat(caffeine),
      });
    }
  }

  if (sizeVariants.length === 0) {
    showToast("Please add at least one valid size variant", "error");
    return;
  }

  // Check for duplicate size names
  const sizeNames = sizeVariants.map((s) => s.name.toLowerCase());
  if (sizeNames.length !== new Set(sizeNames).size) {
    showToast("Size names must be unique", "error");
    return;
  }

  try {
    const res = await fetch("/api/types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name,
        imageUrl: imageUrl || undefined,
        sizes: sizeVariants,
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to add drink");
    }

    closeAddDrinkModal();
    loadDrinkTypes();
    showToast(`${name} added successfully!`, "success");
  } catch (err) {
    console.error("Error adding drink", err);
    showToast(err.message || "Could not add drink", "error");
  }
});

// Add entry form
const addEntryForm = document.getElementById("addEntryForm");
addEntryForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedDrink || !selectedSize) {
    showToast("No drink selected", "error");
    return;
  }

  const desc = document.getElementById("customDescription").value.trim();

  try {
    const res = await fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        drinkName: selectedDrink.name,
        sizeName: selectedSize.name,
        caffeineMg: selectedSize.caffeineMg,
        customDescription: desc,
        isCustomDrink: false,
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to add entry");
    }

    closeAddEntryModal();
    loadStats();
    loadEntries();
    showToast(`${selectedSize.name} ${selectedDrink.name} added!`, "success");
  } catch (err) {
    console.error("Error adding entry", err);
    showToast(err.message || "Could not add entry", "error");
  }
});

// Delete entry
async function deleteEntry(entryId) {
  if (!confirm("Are you sure you want to delete this entry?")) {
    return;
  }

  try {
    const res = await fetch(`/api/entries/${entryId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to delete entry");
    }

    showToast("Entry deleted!", "success");
    loadStats();
    loadEntries();
  } catch (err) {
    console.error("Error deleting entry", err);
    showToast(err.message || "Failed to delete entry", "error");
  }
}

// Load entries
async function loadEntries() {
  const list = document.getElementById("entriesList");
  list.innerHTML = `<div class="loading">Loading...</div>`;

  try {
    const res = await fetch("/api/entries", { credentials: "include" });
    if (!res.ok) throw new Error("Failed to fetch entries");

    const data = await res.json();

    if (!data.length) {
      list.innerHTML = `<div class="loading">No entries yet. Add your first drink!</div>`;
      return;
    }

    list.innerHTML = data.map(renderEntry).join("");
  } catch (err) {
    console.error("Error loading entries", err);
    list.innerHTML = `<div class="loading">Failed to load entries. <button onclick="loadEntries()" style="background:none;border:none;color:#00c6ff;cursor:pointer;text-decoration:underline;">Retry</button></div>`;
    showToast("Failed to load entries", "error");
  }
}

function renderEntry(entry) {
  const displayName =
    entry.fullName || `${entry.sizeName || ""} ${entry.drinkName}`.trim();
  const hasUser = entry.userName && entry.userName !== "Anonymous User";
  const isOwnEntry = currentUser && entry.userId === currentUser.googleId;

  return `
    <div class="entry-item">
      ${
        isOwnEntry
          ? `<button class="entry-delete" onclick="deleteEntry('${entry._id}')" title="Delete entry" aria-label="Delete ${displayName} entry">×</button>`
          : ""
      }
      <div class="entry-header">
        <div class="entry-title">${escapeHtml(displayName)}</div>
        <div class="entry-caffeine">${entry.caffeineMg} mg</div>
      </div>
      <div class="entry-time">${formatTime(entry.timestamp)}</div>
      ${
        hasUser
          ? `<div class="entry-user">by ${escapeHtml(entry.userName)}${
              entry.userAvatar
                ? `<img src="${entry.userAvatar}" class="entry-user-avatar" alt="${entry.userName}">`
                : ""
            }</div>`
          : ""
      }
      ${
        entry.customDescription
          ? `<div class="entry-description">"${escapeHtml(
              entry.customDescription
            )}"</div>`
          : ""
      }
    </div>
  `;
}

// Leaderboard functions
function changePeriod(period) {
  currentPeriod = period;

  // Update button states
  document.querySelectorAll(".period-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  event.target.classList.add("active");

  loadLeaderboard();
}

async function loadLeaderboard() {
  const content = document.getElementById("leaderboardContent");
  content.innerHTML = `<div class="loading">Loading leaderboard...</div>`;

  try {
    const res = await fetch(`/api/leaderboard?period=${currentPeriod}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to fetch leaderboard");

    const data = await res.json();
    renderLeaderboard(data);
  } catch (err) {
    console.error("Error loading leaderboard", err);
    content.innerHTML = `<div class="loading">Failed to load leaderboard. <button onclick="loadLeaderboard()" style="background:none;border:none;color:#00c6ff;cursor:pointer;text-decoration:underline;">Retry</button></div>`;
    showToast("Failed to load leaderboard", "error");
  }
}

function renderLeaderboard(data) {
  const content = document.getElementById("leaderboardContent");

  if (!data.length) {
    content.innerHTML = `<div class="loading">No data available for this period.</div>`;
    return;
  }

  const leaderboardHTML = data
    .map((user, index) => {
      const rank = index + 1;
      const isCurrentUser = currentUser && user.userId === currentUser.googleId;

      // Medal/rank display
      let rankDisplay;
      if (rank === 1) rankDisplay = "🥇";
      else if (rank === 2) rankDisplay = "🥈";
      else if (rank === 3) rankDisplay = "🥉";
      else rankDisplay = `#${rank}`;

      return `
      <div class="leaderboard-item ${isCurrentUser ? "current-user" : ""}">
        <div class="rank">${rankDisplay}</div>
        <div class="user-info">
          ${
            user.userAvatar
              ? `<img src="${user.userAvatar}" class="leaderboard-avatar" alt="${user.userName}">`
              : '<div class="leaderboard-avatar-placeholder">' +
                (user.userName ? user.userName.charAt(0).toUpperCase() : "U") +
                "</div>"
          }
          <div class="user-details">
            <div class="user-name">${escapeHtml(
              user.userName || "Unknown User"
            )}</div>
            <div class="user-stats">${user.entryCount} entries</div>
          </div>
        </div>
        <div class="caffeine-total">
          <span class="caffeine-amount">${Math.round(
            user.totalCaffeine
          )} mg</span>
        </div>
      </div>
    `;
    })
    .join("");

  content.innerHTML = `
    <div class="leaderboard-list">
      ${leaderboardHTML}
    </div>
  `;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = (now - date) / 1000; // difference in seconds

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;

  // If it's today, show time
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // If it's yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  // Otherwise show date
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className = `toast show toast-${type}`;

  // Clear any existing timeout
  if (toast.timeoutId) {
    clearTimeout(toast.timeoutId);
  }

  // Set new timeout
  toast.timeoutId = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// Auto-refresh stats and entries every 30 seconds
setInterval(() => {
  if (currentUser) {
    loadStats();
    // Only reload entries if no modals are open
    const modalsOpen =
      document.querySelectorAll('.modal[style*="flex"]').length > 0;
    if (!modalsOpen) {
      loadEntries();

      // Refresh leaderboard if on leaderboard tab
      const leaderboardTab = document.getElementById("leaderboardTab");
      if (leaderboardTab && leaderboardTab.classList.contains("active")) {
        loadLeaderboard();
      }
    }
  }
}, 30000);

// Service Worker registration for offline support (optional)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("SW registered: ", registration);
      })
      .catch((registrationError) => {
        console.log("SW registration failed: ", registrationError);
      });
  });
}
