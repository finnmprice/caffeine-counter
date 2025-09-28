const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { OAuth2Client } = require("google-auth-library");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Google OAuth setup
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Middleware
app.use(express.json());
app.use(express.static("public"));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI environment variable is not set");
  process.exit(1);
}

if (!GOOGLE_CLIENT_ID) {
  console.error("GOOGLE_CLIENT_ID environment variable is not set");
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", (err) => console.error("MongoDB connection error:", err));
db.once("open", () => {
  console.log("Connected to MongoDB Atlas");
});

// Session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "caffeine-tracker-secret-key",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      collectionName: "sessions",
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// User schema
const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    picture: {
      type: String,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "users",
  }
);

// Size variant schema
const sizeVariantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  caffeineMg: {
    type: Number,
    required: true,
    min: 0,
  },
});

// Updated Drink Type Schema with size variants
const drinkTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: "/images/noImage.png", trim: true },
    sizes: [sizeVariantSchema],
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
  },
  { collection: "types" }
);

// Updated Caffeine Entry Schema with user info
const caffeineEntrySchema = new mongoose.Schema(
  {
    drinkName: {
      type: String,
      required: true,
      trim: true,
    },
    sizeName: {
      type: String,
      required: true,
      trim: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    caffeineMg: {
      type: Number,
      required: true,
      min: 0,
    },
    customDescription: {
      type: String,
      default: "",
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    isCustomDrink: {
      type: Boolean,
      default: false,
    },
    userId: {
      type: String,
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    userAvatar: {
      type: String,
    },
  },
  {
    collection: "entries",
  }
);

const User = mongoose.model("User", userSchema);
const DrinkType = mongoose.model("DrinkType", drinkTypeSchema);
const CaffeineEntry = mongoose.model("CaffeineEntry", caffeineEntrySchema);

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
};

// Auth Routes

// Google OAuth verification
app.post("/api/auth/google", async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = await User.findOne({ googleId });

    if (!user) {
      user = new User({
        googleId,
        email,
        name,
        picture,
        lastLoginAt: new Date(),
      });
      await user.save();
      console.log(`New user created: ${email}`);
    } else {
      // Update last login
      user.lastLoginAt = new Date();
      if (user.picture !== picture) {
        user.picture = picture;
      }
      await user.save();
      console.log(`User logged in: ${email}`);
    }

    // Store user in session
    req.session.user = {
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      picture: user.picture,
    };

    res.json({
      success: true,
      user: req.session.user,
    });
  } catch (error) {
    console.error("Google auth error:"), error;
    res.status(400).json({ error: "Invalid token" });
  }
});

// Check authentication status
app.get("/api/auth/check", (req, res) => {
  if (req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: "Not authenticated" });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Failed to logout", err);
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true });
    console.log("User logged out");
  });
});

// Protected Routes (require authentication)

// Get all drink types
app.get("/api/types", requireAuth, async (req, res) => {
  try {
    const types = await DrinkType.find({ deleted: false }).sort({ name: 1 });
    res.json(types);
  } catch (error) {
    console.error("Error fetching drink types:", error);
    res.status(500).json({ error: "Failed to fetch drink types" });
  }
});

// Add new drink type with sizes
app.post("/api/types", requireAuth, async (req, res) => {
  try {
    const { name, imageUrl, sizes } = req.body;
    const user = req.session.user;

    if (!name || !sizes || !Array.isArray(sizes) || sizes.length === 0) {
      return res.status(400).json({
        error: "Name and at least one size variant are required",
      });
    }

    // Validate each size
    for (const size of sizes) {
      if (!size.name || !size.caffeineMg || size.caffeineMg <= 0) {
        return res.status(400).json({
          error: "Each size must have a name and positive caffeine amount",
        });
      }
    }

    const existingType = await DrinkType.findOne({ name: name.trim() });
    if (existingType) {
      return res.status(400).json({ error: "Drink type already exists" });
    }

    const newType = new DrinkType({
      name: name.trim(),
      imageUrl: imageUrl ? imageUrl.trim() : "/images/noImage.png",
      sizes: sizes.map((size) => ({
        name: size.name.trim(),
        caffeineMg: parseFloat(size.caffeineMg),
      })),
    });

    const savedType = await newType.save();
    res.status(201).json(savedType);
    console.log(`New drink type added: ${user.name} added ${savedType.name}`);
  } catch (error) {
    console.error("Error saving drink type:", error);
    res.status(500).json({ error: "Failed to save drink type" });
  }
});

// Get all caffeine entries (all users, sorted by timestamp)
app.get("/api/entries", requireAuth, async (req, res) => {
  try {
    const entries = await CaffeineEntry.find()
      .sort({ timestamp: -1 })
      .limit(50);
    res.json(entries);
  } catch (error) {
    console.error("Error fetching entries:", error);
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

// Add new caffeine entry
app.post("/api/entries", requireAuth, async (req, res) => {
  try {
    const {
      drinkName,
      sizeName,
      caffeineMg,
      customDescription,
      isCustomDrink,
    } = req.body;

    if (!drinkName || !sizeName || !caffeineMg || caffeineMg <= 0) {
      return res.status(400).json({
        error:
          "Drink name, size name, and positive caffeine amount are required",
      });
    }

    const fullName = `${sizeName} ${drinkName}`;

    const newEntry = new CaffeineEntry({
      drinkName: drinkName.trim(),
      sizeName: sizeName.trim(),
      fullName: fullName.trim(),
      caffeineMg: parseFloat(caffeineMg),
      customDescription: customDescription ? customDescription.trim() : "",
      isCustomDrink: Boolean(isCustomDrink),
      userId: req.session.user.googleId,
      userName: req.session.user.name,
      userAvatar: req.session.user.picture,
    });

    const savedEntry = await newEntry.save();
    res.status(201).json(savedEntry);
    console.log(
      `New entry added for user ${req.session.user.email}: ${savedEntry.fullName} (${savedEntry.caffeineMg}mg)`
    );
  } catch (error) {
    console.error("Error saving entry:", error);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

// Get total caffeine consumed today (for ALL users)
app.get("/api/total-today", requireAuth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayEntries = await CaffeineEntry.find({
      timestamp: {
        $gte: today,
        $lt: tomorrow,
      },
    });

    const total = todayEntries.reduce(
      (sum, entry) => sum + entry.caffeineMg,
      0
    );
    res.json({ total, count: todayEntries.length });
  } catch (error) {
    console.error("Error calculating today's total:", error);
    res.status(500).json({ error: "Failed to calculate today's total" });
  }
});

// Get total caffeine consumed all time (for ALL users)
app.get("/api/total-all", requireAuth, async (req, res) => {
  try {
    const allEntries = await CaffeineEntry.find({});
    const total = allEntries.reduce((sum, entry) => sum + entry.caffeineMg, 0);
    res.json({ total, count: allEntries.length });
  } catch (error) {
    console.error("Error calculating total:", error);
    res.status(500).json({ error: "Failed to calculate total" });
  }
});

// Delete an entry (only allow users to delete their own entries)
app.delete("/api/entries/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await CaffeineEntry.findById(id);
    const user = req.session.user;

    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }

    // Check if user owns this entry
    if (entry.userId !== req.session.user.googleId) {
      return res
        .status(403)
        .json({ error: "Not authorized to delete this entry" });
    }

    // Drink description
    const drinkDesc = `${entry.sizeName} ${entry.drinkName} (${entry.caffeineMg}mg)`;

    await CaffeineEntry.findByIdAndDelete(id);
    res.json({ message: "Entry deleted successfully" });

    console.log(`Entry deleted: ${user.name} deleted ${drinkDesc}`);
  } catch (error) {
    console.error("Error deleting entry:", error);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// Delete a drink type (any authenticated user can delete)
app.delete("/api/types/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const drink = await DrinkType.findById(id);
    const user = req.session.user;

    if (!drink) {
      return res.status(404).json({ error: "Drink type not found" });
    }

    if (drink.deleted) {
      return res.status(400).json({ error: "Drink type already deleted" });
    }

    drink.deleted = true;
    await drink.save();

    res.json({ message: `Drink type "${drink.name}" marked as deleted` });
    console.log(`Drink type deleted: ${user.name} deleted ${drink.name}`);
  } catch (error) {
    console.error("Error deleting drink type:", error);
    res.status(500).json({ error: "Failed to delete drink type" });
  }
});

// Leaderboard API
app.get("/api/leaderboard", requireAuth, async (req, res) => {
  try {
    const { period = "week" } = req.query;

    let dateFilter = {};
    const now = new Date();

    switch (period) {
      case "week": {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        dateFilter = { timestamp: { $gte: weekAgo } };
        break;
      }
      case "month": {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        dateFilter = { timestamp: { $gte: monthAgo } };
        break;
      }
      case "year": {
        const yearAgo = new Date(now);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        dateFilter = { timestamp: { $gte: yearAgo } };
        break;
      }
      case "all":
        // no date filter
        break;
      default:
        return res.status(400).json({ error: "Invalid period" });
    }

    // Aggregate caffeine consumption by user
    const pipeline = [
      { $match: dateFilter },
      {
        $group: {
          _id: "$userId",
          totalCaffeine: { $sum: "$caffeineMg" },
          entryCount: { $sum: 1 },
          userName: { $first: "$userName" },
          userAvatar: { $first: "$userAvatar" },
        },
      },
      { $sort: { totalCaffeine: -1 } },
      { $limit: 50 },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          totalCaffeine: 1,
          entryCount: 1,
          userName: 1,
          userAvatar: 1,
        },
      },
    ];

    const leaderboard = await CaffeineEntry.aggregate(pipeline);
    res.json(leaderboard);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// Chart data API
app.get("/api/caffeine-chart", requireAuth, async (req, res) => {
  try {
    const { period = "week" } = req.query;
    const now = new Date();

    // Normalize today to midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let startDate;
    let labelFormatter;
    let step;

    switch (period) {
      case "week": {
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 6); // 7 days total incl today
        labelFormatter = (d) =>
          d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        step = "day";
        break;
      }

      case "month": {
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 29); // 30 days incl today
        labelFormatter = (d) =>
          d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        step = "day";
        break;
      }

      case "year": {
        startDate = new Date(today);
        startDate.setFullYear(today.getFullYear() - 1);
        labelFormatter = (d) =>
          d.toLocaleDateString("en-US", { month: "short" });
        step = "month";
        break;
      }

      case "all": {
        // Fetch earliest and latest entries
        const earliest = await CaffeineEntry.findOne().sort({ timestamp: 1 });
        const latest = await CaffeineEntry.findOne().sort({ timestamp: -1 });

        if (!earliest || !latest) {
          return res.json({ labels: [], values: [] });
        }

        startDate = new Date(earliest.timestamp);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(latest.timestamp);
        endDate.setHours(0, 0, 0, 0);

        const daysSpan =
          Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

        if (daysSpan <= 90) {
          // Short span → daily
          step = "day";
          labelFormatter = (d) =>
            d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
        } else if (daysSpan <= 18 * 30) {
          // Medium span → monthly
          step = "month";
          startDate.setDate(1); // align to month start
          labelFormatter = (d) =>
            d.toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            });
        } else {
          // Long span → yearly
          step = "year";
          startDate = new Date(startDate.getFullYear(), 0, 1);
          labelFormatter = (d) => d.getFullYear().toString();
        }
        break;
      }

      default:
        return res.status(400).json({ error: "Invalid period" });
    }

    // Query only relevant entries
    const entries = await CaffeineEntry.find({
      timestamp: { $gte: startDate, $lte: now },
    });

    // Group in memory
    const buckets = {};

    entries.forEach((entry) => {
      const d = new Date(entry.timestamp);
      let key;

      if (step === "day") {
        d.setHours(0, 0, 0, 0);
        key = d.toISOString().slice(0, 10); // YYYY-MM-DD
      } else if (step === "month") {
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      } else if (step === "year") {
        d.setMonth(0, 1); // Jan 1
        d.setHours(0, 0, 0, 0);
        key = `${d.getFullYear()}`;
      }

      if (!buckets[key]) buckets[key] = 0;
      buckets[key] += entry.caffeineMg;
    });

    // Build labels & values with zero-padding
    const labels = [];
    const values = [];

    if (step === "day") {
      for (
        let d = new Date(startDate);
        d <= today;
        d.setDate(d.getDate() + 1)
      ) {
        const key = d.toISOString().slice(0, 10);
        labels.push(labelFormatter(d));
        values.push(buckets[key] || 0);
      }
    } else if (step === "month") {
      const iter = new Date(startDate);
      while (iter <= today) {
        const key = `${iter.getFullYear()}-${String(
          iter.getMonth() + 1
        ).padStart(2, "0")}`;
        labels.push(labelFormatter(iter));
        values.push(buckets[key] || 0);
        iter.setMonth(iter.getMonth() + 1);
      }
    } else if (step === "year") {
      const iter = new Date(startDate);
      while (iter <= today) {
        const key = `${iter.getFullYear()}`;
        labels.push(labelFormatter(iter));
        values.push(buckets[key] || 0);
        iter.setFullYear(iter.getFullYear() + 1);
      }
    }

    res.json({ labels, values });
  } catch (error) {
    console.error("Error fetching chart data:", error);
    res.status(500).json({ error: "Failed to fetch chart data" });
  }
});

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
