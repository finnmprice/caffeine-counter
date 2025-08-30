const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { OAuth2Client } = require("google-auth-library");
import chalk from "chalk";

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
  console.error(chalk.red("MONGODB_URI environment variable is not set"));
  process.exit(1);
}

if (!GOOGLE_CLIENT_ID) {
  console.error(chalk.red("GOOGLE_CLIENT_ID environment variable is not set"));
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", (err) =>
  console.error(chalk.red("MongoDB connection error:"), err)
);
db.once("open", () => {
  console.log(chalk.green("Connected to MongoDB Atlas"));
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      default: "/images/noImage.png",
      trim: true,
    },
    sizes: [sizeVariantSchema], // Array of size variants
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "types",
  }
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
      console.log(chalk.green(`New user created: ${email}`));
    } else {
      // Update last login
      user.lastLoginAt = new Date();
      if (user.picture !== picture) {
        user.picture = picture;
      }
      await user.save();
      console.log(chalk.cyan(`User logged in: ${email}`));
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
    console.error(chalk.red("Google auth error:"), error);
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
      console.error(chalk.red("Failed to logout"), err);
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true });
    console.log(chalk.yellow("User logged out"));
  });
});

// Protected Routes (require authentication)

// Get all drink types
app.get("/api/types", requireAuth, async (req, res) => {
  try {
    const types = await DrinkType.find().sort({ name: 1 });
    res.json(types);
  } catch (error) {
    console.error(chalk.red("Error fetching drink types:"), error);
    res.status(500).json({ error: "Failed to fetch drink types" });
  }
});

// Add new drink type with sizes
app.post("/api/types", requireAuth, async (req, res) => {
  try {
    const { name, imageUrl, sizes } = req.body;

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
    console.log(chalk.green(`New drink type added: ${savedType.name}`));
  } catch (error) {
    console.error(chalk.red("Error saving drink type:"), error);
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
    console.error(chalk.red("Error fetching entries:"), error);
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
      chalk.green(
        `New entry added for user ${req.session.user.email}: ${savedEntry.fullName} (${savedEntry.caffeineMg}mg)`
      )
    );
  } catch (error) {
    console.error(chalk.red("Error saving entry:"), error);
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
    console.error(chalk.red("Error calculating today's total:"), error);
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
    console.error(chalk.red("Error calculating total:"), error);
    res.status(500).json({ error: "Failed to calculate total" });
  }
});

// Delete an entry (only allow users to delete their own entries)
app.delete("/api/entries/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await CaffeineEntry.findById(id);

    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }

    // Check if user owns this entry
    if (entry.userId !== req.session.user.googleId) {
      return res
        .status(403)
        .json({ error: "Not authorized to delete this entry" });
    }

    await CaffeineEntry.findByIdAndDelete(id);
    res.json({ message: "Entry deleted successfully" });
    console.log(chalk.yellow(`Entry deleted: ${id}`));
  } catch (error) {
    console.error(chalk.red("Error deleting entry:"), error);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// Delete a drink type (any authenticated user can delete)
app.delete("/api/types/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const deletedType = await DrinkType.findByIdAndDelete(id);

    if (!deletedType) {
      return res.status(404).json({ error: "Drink type not found" });
    }

    res.json({ message: "Drink type deleted successfully" });
    console.log(chalk.yellow(`Drink type deleted: ${deletedType.name}`));
  } catch (error) {
    console.error(chalk.red("Error deleting drink type:"), error);
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
      case "week":
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        dateFilter = { timestamp: { $gte: weekAgo } };
        break;

      case "month":
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        dateFilter = { timestamp: { $gte: monthAgo } };
        break;

      case "all":
        // No date filter for all time
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
    console.error(chalk.red("Error fetching leaderboard:"), error);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(chalk.red("Unhandled error:"), err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
