// 1. SERVER FILE (app.js)

import express from "express";
import bodyParser from "body-parser";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import session from "express-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// open SQLite database
const db = open({
  filename: "./shopkeep.db",
  driver: sqlite3.Database,
});

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);
app.set("view engine", "ejs");

// ————————————————————————————————————————————————
// Public pages
// ————————————————————————————————————————————————

app.get("/", (req, res) => res.render("Login.ejs"));
app.get("/login", (req, res) => res.render("Login.ejs"));
app.get("/register", (req, res) => res.render("Register.ejs"));

// ————————————————————————————————————————————————
// Add / list products
// ————————————————————————————————————————————————

app.get("/AddProduct", async (req, res) => {
  const dbConn = await db;
  const array = await dbConn.all("SELECT * FROM product");
  res.render("AddProduct.ejs", { array });
});

// ————————————————————————————————————————————————
// INDEX: generate bill–no once per session & render form
// ————————————————————————————————————————————————

app.get("/index", async (req, res) => {
  const dbConn = await db;

  // Generate and store billNumber in session if not already set
  if (!req.session.billNumber) {
    const year = new Date().getFullYear();
    const row = await dbConn.get(
      "SELECT current_no FROM bill_tracker WHERE year = ?",
      [year]
    );

    let nextNumber = 1;
    if (row) {
      nextNumber = row.current_no + 1;
      await dbConn.run(
        "UPDATE bill_tracker SET current_no = ? WHERE year = ?",
        [nextNumber, year]
      );
    } else {
      await dbConn.run(
        "INSERT INTO bill_tracker (year, current_no) VALUES (?, ?)",
        [year, nextNumber]
      );
    }

    req.session.billNumber = `${year}-${String(nextNumber).padStart(4, "0")}`;
  }

  // Fetch products and mapping
  const array = await dbConn.all("SELECT * FROM product");
  const itemMapping = {};
  array.forEach((item) => (itemMapping[item.code] = item.name));

  // Render index.ejs with billNumber
  res.render("index", {
    array,
    itemMapping: JSON.stringify(itemMapping),
    billNumber: req.session.billNumber,
  });
});

// ————————————————————————————————————————————————
// Auth routes
// ————————————————————————————————————————————————

app.post("/register", async (req, res) => {
  const dbConn = await db;
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  await dbConn.run(
    "INSERT INTO users (username, password) VALUES (?, ?)",
    [username, hashedPassword]
  );
  res.render("Login.ejs");
});

app.post("/login", async (req, res) => {
  const dbConn = await db;
  const { username, password } = req.body;
  const row = await dbConn.get("SELECT * FROM users WHERE username = ?", [
    username,
  ]);

  if (row && (await bcrypt.compare(password, row.password))) {
    req.session.user = row.username;
    res.redirect("/index");
  } else {
    res.send("Invalid username or password");
  }
});

// ————————————————————————————————————————————————
// Product management
// ————————————————————————————————————————————————

app.post("/addproduct", async (req, res) => {
  const dbConn = await db;
  const { code, name } = req.body;
  await dbConn.run("INSERT INTO product (code, name) VALUES (?, ?)", [
    code,
    name,
  ]);
  res.redirect("/AddProduct");
});

app.get("/deleteproduct", async (req, res) => {
  const dbConn = await db;
  try {
    await dbConn.run("DELETE FROM product WHERE code = ?", [req.query.code]);
    res.sendStatus(200);
  } catch (err) {
    console.error("Deletion failed:", err);
    res.sendStatus(500);
  }
});

// ————————————————————————————————————————————————
// Submit bill — use session-stored billNumber, then clear it
// ————————————————————————————————————————————————
// Submit bill — use session-stored billNumber, then clear it
app.post("/submitBill", async (req, res) => {
  try {
    const dbConn = await db;
    const billdetails = req.body;
    console.log("Raw form data:", billdetails);

    const tableData = JSON.parse(billdetails.tableData);
    const billno = req.session.billNumber;
    const rawDate = new Date(billdetails.date);
    const date = rawDate.toISOString().split("T")[0]; // Fix date format
    const totalAmount = parseFloat(billdetails.amount);
    const totalDiscount = parseFloat(billdetails.discount);
    const netAmount = parseFloat(billdetails.netamount);
    const saletype=billdetails.saletype;

    const insertStmt = await dbConn.prepare(`
      INSERT INTO billing (
        billno, date, code, name, rate, quantity, item_discount, amount, total_discount, netamount,type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of tableData) {
      const { code, name, rate, quantity, discount } = item;
      await insertStmt.run(
        billno,
        date,
        code,
        name,
        parseFloat(rate),
        parseInt(quantity),
        parseFloat(discount),
        totalAmount,
        totalDiscount,
        netAmount,
        saletype
      );
    }
    await insertStmt.finalize();

    delete req.session.billNumber;
    res.redirect("/index");
  } catch (err) {
    console.error("Error in /submitBill:", err);
    res.status(500).send("Internal Server Error");
  }
});



app.get("/History", async (req, res) => {
  res.render("History", {
    bills: [],
    selectedStart: "",
    selectedEnd: "",
  });
});


app.post("/billSummaryform", async (req, res) => {
  try {
    const dbConn = await db;
    const { start, end } = req.body;

    const query = `SELECT DISTINCT billno, date, netamount, type
                  FROM billing
                  WHERE DATE(date) BETWEEN DATE(?) AND DATE(?)
                  ORDER BY DATE(date) ASC
    `;
    const params = [start, end];

    const bills = await dbConn.all(query, params);
    
    console.log("Fetched bills:");
    bills.forEach(b => console.log(b));

    res.render("History", {
      bills,
      selectedStart: start,
      selectedEnd: end,
    });
  } catch (err) {
    console.error("Error fetching bill summary:", err);
    res.status(500).send("Internal Server Error");
  }
});


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
