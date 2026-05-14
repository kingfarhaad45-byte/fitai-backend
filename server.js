require("dotenv").config();
const express  = require("express");
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: "10mb" }));

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    // Drop old username index if exists
    try {
      await mongoose.connection.collection("users").dropIndex("username_1");
      console.log("✅ Old index dropped");
    } catch(e) {
      // Index doesn't exist, that's fine
    }
  })
  .catch(e => console.error("❌ MongoDB error:", e));

// ── Schemas ───────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name:     { type:String, required:true },
  email:    { type:String, required:true, unique:true, lowercase:true },
  password: { type:String, required:true },
  age:      Number, weight:Number, height:Number,
  goals: {
    calories: { type:Number, default:1800 },
    protein:  { type:Number, default:140 },
    carbs:    { type:Number, default:180 },
    fat:      { type:Number, default:55 },
    fiber:    { type:Number, default:25 },
    goalType: { type:String, default:"Lose weight" },
  },
  createdAt: { type:Date, default:Date.now }
});

const MealSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User", required:true },
  name:String, serving:String, calories:Number, protein:Number,
  carbs:Number, fat:Number, fiber:Number, notes:String,
  date:     { type:String, default:()=>new Date().toLocaleDateString() },
  time:     { type:String, default:()=>new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) },
  createdAt:{ type:Date, default:Date.now }
});

const WorkoutSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User", required:true },
  exercise:String,
  sets:     [{ reps:String, weight:String }],
  date:     { type:String, default:()=>new Date().toLocaleDateString() },
  week:     { type:Number, default:()=>getWeekNumber(new Date()) },
  createdAt:{ type:Date, default:Date.now }
});

const WeightLogSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User", required:true },
  weight:Number,
  date:     { type:String, default:()=>new Date().toLocaleDateString() },
  createdAt:{ type:Date, default:Date.now }
});

const WaterSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User", required:true },
  ml:Number,
  time:     { type:String, default:()=>new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) },
  date:     { type:String, default:()=>new Date().toLocaleDateString() },
  createdAt:{ type:Date, default:Date.now }
});

const SleepSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User" },
  bedtime:String, wake:String, hours:Number, quality:Number,
  date:String, createdAt:{ type:Date, default:Date.now }
});

const CardioSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User" },
  type:String, duration:Number, distance:Number, steps:Number, calories:Number,
  date:String, createdAt:{ type:Date, default:Date.now }
});

const MeasSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User" },
  weight:Number, chest:Number, waist:Number, hips:Number,
  bicep:Number, thigh:Number, bodyFat:Number,
  date:String, createdAt:{ type:Date, default:Date.now }
});

const SuppSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User", unique:true },
  list:Array, logs:Object
});

const PRSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User", unique:true },
  records:Object
});

const RecovSchema = new mongoose.Schema({
  userId:   { type:mongoose.Schema.Types.ObjectId, ref:"User" },
  activity:String, soreness:Number, energy:Number, notes:String,
  date:String, createdAt:{ type:Date, default:Date.now }
});

const User        = mongoose.model("User",        UserSchema);
const Meal        = mongoose.model("Meal",        MealSchema);
const Workout     = mongoose.model("Workout",     WorkoutSchema);
const WeightLog   = mongoose.model("WeightLog",   WeightLogSchema);
const Water       = mongoose.model("Water",       WaterSchema);
const Sleep       = mongoose.model("Sleep",       SleepSchema);
const Cardio      = mongoose.model("Cardio",      CardioSchema);
const Measurement = mongoose.model("Measurement", MeasSchema);
const Supplement  = mongoose.model("Supplement",  SuppSchema);
const PR          = mongoose.model("PR",          PRSchema);
const Recovery    = mongoose.model("Recovery",    RecovSchema);

// ── Helpers ───────────────────────────────────────────────────────────────────
function getWeekNumber(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - start) / 86400000) + start.getDay() + 1) / 7);
}

const JWT_SECRET = process.env.JWT_SECRET || "fitai_secret";

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Invalid token" }); }
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "FitAI API running 🚀" }));

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password, age, weight, height, goals } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error:"Missing fields" });
    if (await User.findOne({ email: email.toLowerCase() })) return res.status(400).json({ error:"Email already registered" });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password:hashed, age, weight, height, goals });
    const token = jwt.sign({ id:user._id, email:user.email }, JWT_SECRET, { expiresIn:"30d" });
    res.json({ token, user:{ id:user._id, name:user.name, email:user.email, age:user.age, weight:user.weight, height:user.height, goals:user.goals } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ error:"No account found with this email" });
    if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error:"Incorrect password" });
    const token = jwt.sign({ id:user._id, email:user.email }, JWT_SECRET, { expiresIn:"30d" });
    res.json({ token, user:{ id:user._id, name:user.name, email:user.email, age:user.age, weight:user.weight, height:user.height, goals:user.goals } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Goals ─────────────────────────────────────────────────────────────────────
app.put("/api/user/goals", auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.user.id, { goals:req.body }, { new:true });
    res.json({ goals:user.goals });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Meals ─────────────────────────────────────────────────────────────────────
app.get("/api/meals", auth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString();
    res.json(await Meal.find({ userId:req.user.id, date }).sort({ createdAt:-1 }));
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/meals", auth, async (req, res) => {
  try { res.json(await Meal.create({ ...req.body, userId:req.user.id })); }
  catch(e) { res.status(500).json({ error:e.message }); }
});
app.delete("/api/meals/:id", auth, async (req, res) => {
  try { await Meal.findOneAndDelete({ _id:req.params.id, userId:req.user.id }); res.json({ success:true }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Workouts ──────────────────────────────────────────────────────────────────
app.get("/api/workouts", auth, async (req, res) => {
  try {
    const currentWeek = getWeekNumber(new Date());
    const week = req.query.week === "last" ? currentWeek - 1 : currentWeek;
    res.json(await Workout.find({ userId:req.user.id, week }).sort({ createdAt:-1 }));
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/workouts", auth, async (req, res) => {
  try { res.json(await Workout.create({ ...req.body, userId:req.user.id })); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Weight ────────────────────────────────────────────────────────────────────
app.get("/api/weight", auth, async (req, res) => {
  try { res.json(await WeightLog.find({ userId:req.user.id }).sort({ createdAt:-1 }).limit(30)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/weight", auth, async (req, res) => {
  try { res.json(await WeightLog.create({ weight:req.body.weight, userId:req.user.id })); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Water ─────────────────────────────────────────────────────────────────────
app.get("/api/water/today", auth, async (req, res) => {
  try {
    const date = new Date().toLocaleDateString();
    const logs = await Water.find({ userId:req.user.id, date }).sort({ createdAt:1 });
    const total = logs.reduce((a,l) => a + l.ml, 0);
    let running = 0;
    const logsWithRunning = logs.map(l => { running += l.ml; return { ml:l.ml, time:l.time, running }; });
    res.json({ total, logs:logsWithRunning });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/water", auth, async (req, res) => {
  try {
    await Water.create({ userId:req.user.id, ml:req.body.ml, time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) });
    const date = new Date().toLocaleDateString();
    const logs = await Water.find({ userId:req.user.id, date }).sort({ createdAt:1 });
    const total = logs.reduce((a,l) => a + l.ml, 0);
    let running = 0;
    const logsWithRunning = logs.map(l => { running += l.ml; return { ml:l.ml, time:l.time, running }; });
    res.json({ total, logs:logsWithRunning });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Sleep ─────────────────────────────────────────────────────────────────────
app.get("/api/sleep", auth, async (req, res) => {
  try { res.json(await Sleep.find({ userId:req.user.id }).sort({ createdAt:-1 }).limit(30)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/sleep", auth, async (req, res) => {
  try { res.json(await Sleep.create({ ...req.body, userId:req.user.id })); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Cardio ────────────────────────────────────────────────────────────────────
app.get("/api/cardio", auth, async (req, res) => {
  try { res.json(await Cardio.find({ userId:req.user.id }).sort({ createdAt:-1 }).limit(30)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/cardio", auth, async (req, res) => {
  try { res.json(await Cardio.create({ ...req.body, userId:req.user.id })); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Measurements ──────────────────────────────────────────────────────────────
app.get("/api/measurements", auth, async (req, res) => {
  try { res.json(await Measurement.find({ userId:req.user.id }).sort({ createdAt:-1 }).limit(20)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/measurements", auth, async (req, res) => {
  try { res.json(await Measurement.create({ ...req.body, userId:req.user.id })); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Supplements ───────────────────────────────────────────────────────────────
app.get("/api/supplements", auth, async (req, res) => {
  try {
    const d = await Supplement.findOne({ userId:req.user.id });
    res.json(d || { list:[], logs:{} });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/supplements", auth, async (req, res) => {
  try {
    const d = await Supplement.findOneAndUpdate(
      { userId:req.user.id },
      { ...req.body, userId:req.user.id },
      { upsert:true, new:true }
    );
    res.json(d);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── PRs ───────────────────────────────────────────────────────────────────────
app.get("/api/prs", auth, async (req, res) => {
  try {
    const d = await PR.findOne({ userId:req.user.id });
    res.json(d ? d.records : {});
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/prs", auth, async (req, res) => {
  try {
    const d = await PR.findOne({ userId:req.user.id });
    const records = { ...(d ? d.records : {}), [req.body.exercise]:req.body.weight };
    await PR.findOneAndUpdate({ userId:req.user.id }, { records, userId:req.user.id }, { upsert:true, new:true });
    res.json(records);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Recovery ──────────────────────────────────────────────────────────────────
app.get("/api/recovery", auth, async (req, res) => {
  try { res.json(await Recovery.find({ userId:req.user.id }).sort({ createdAt:-1 }).limit(20)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});
app.post("/api/recovery", auth, async (req, res) => {
  try { res.json(await Recovery.create({ ...req.body, userId:req.user.id })); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 FitAI API running on port ${PORT}`));
