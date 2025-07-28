const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static("public"));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI environment variable is not set");
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB Atlas - caffeineCounter database");
});

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

// Updated Caffeine Entry Schema
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
  },
  {
    collection: "entries",
  }
);

const DrinkType = mongoose.model("DrinkType", drinkTypeSchema);
const CaffeineEntry = mongoose.model("CaffeineEntry", caffeineEntrySchema);

// Routes

// Get all drink types
app.get("/api/types", async (req, res) => {
  try {
    const types = await DrinkType.find().sort({ name: 1 });
    res.json(types);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch drink types" });
  }
});

// Add new drink type with sizes
app.post("/api/types", async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ error: "Failed to save drink type" });
  }
});

// Get all caffeine entries
app.get("/api/entries", async (req, res) => {
  try {
    const entries = await CaffeineEntry.find().sort({ timestamp: -1 });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

// Add new caffeine entry
app.post("/api/entries", async (req, res) => {
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
    });

    const savedEntry = await newEntry.save();
    res.status(201).json(savedEntry);
  } catch (error) {
    res.status(500).json({ error: "Failed to save entry" });
  }
});

// Get total caffeine consumed today
app.get("/api/total-today", async (req, res) => {
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
    res.status(500).json({ error: "Failed to calculate today's total" });
  }
});

// Get total caffeine consumed all time
app.get("/api/total-all", async (req, res) => {
  try {
    const allEntries = await CaffeineEntry.find();
    const total = allEntries.reduce((sum, entry) => sum + entry.caffeineMg, 0);
    res.json({ total, count: allEntries.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to calculate total" });
  }
});

// Delete an entry
app.delete("/api/entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedEntry = await CaffeineEntry.findByIdAndDelete(id);

    if (!deletedEntry) {
      return res.status(404).json({ error: "Entry not found" });
    }

    res.json({ message: "Entry deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// Delete a drink type
app.delete("/api/types/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedType = await DrinkType.findByIdAndDelete(id);

    if (!deletedType) {
      return res.status(404).json({ error: "Drink type not found" });
    }

    res.json({ message: "Drink type deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete drink type" });
  }
});

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
