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

let db;
db = open({
  filename: './shopkeep.db',
  driver: sqlite3.Database
});

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));
app.set("view engine", "ejs");

app.get("/", (req, res) => res.render("Login.ejs"));
app.get("/login", (req, res) => res.render("Login.ejs"));
app.get("/register", (req, res) => res.render("Register.ejs"));

app.get("/AddProduct", async (req, res) => {
  let array = await (await db).all("SELECT * FROM product");
  res.render("AddProduct.ejs", { array });
});

app.get("/index", async (req, res) => {
  let array = await (await db).all("SELECT * FROM product");
  let itemMapping = {};
  array.forEach(item => itemMapping[item.code] = item.name);
  res.render("index", { array, itemMapping: JSON.stringify(itemMapping) });
});

app.post("/register", async (req, res) => {
  let username = req.body.username;
  let password = req.body.password;
  const hashedPassword = await bcrypt.hash(password, 10);
  (await db).run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword]);
  res.render("Login.ejs");
});

app.post("/login", async (req, res) => {
  const user = req.body.username;
  const password = req.body.password;
  const row = await (await db).get("SELECT * FROM users WHERE username = ?", [user]);
  if (row) {
    const isMatch = await bcrypt.compare(password, row.password);
    if (isMatch) {
      req.session.user = row.username;
      res.redirect("/index");
    } else res.send("password not matched");
  } else res.send("user not found");
});

app.post("/addproduct", async (req, res) => {
  let code = req.body.code;
  let name = req.body.name;
  (await db).run("INSERT INTO product (code, name) VALUES (?, ?)", [code, name]);
  res.redirect("/AddProduct");
});

app.get("/deleteproduct", async (req, res) => {
  const code = req.query.code;
  try {
    await (await db).run("DELETE FROM product WHERE code = ?", [code]);
    res.sendStatus(200);
  } catch (err) {
    console.error("Deletion failed:", err);
    res.sendStatus(500);
  }
});

// NEW: Generate Bill Number API
app.get("/generate-bill-number", async (req, res) => {
  const dbConn = await db;
  const year = new Date().getFullYear();
  let row = await dbConn.get("SELECT current_no FROM bill_tracker WHERE year = ?", [year]);
  let nextNumber = 1;
  if (row) {
    nextNumber = row.current_no + 1;
    await dbConn.run("UPDATE bill_tracker SET current_no = ? WHERE year = ?", [nextNumber, year]);
  } else {
    await dbConn.run("INSERT INTO bill_tracker (year, current_no) VALUES (?, ?)", [year, nextNumber]);
  }
  const formatted = `${year}-${String(nextNumber).padStart(4, '0')}`;
  res.json({ billNumber: formatted });
});
app.post("/submitBill", async (req, res) => {
    try {
        let billdetails = req.body;
        console.log("Raw form data:", billdetails);

        // Parse the tableData string to JSON array
        const tableData = JSON.parse(req.body.tableData);

        console.log("Parsed Table Data:");
        tableData.forEach(item => {
            console.log(item.code, item.name, item.rate, item.quantity, item.discount);
        });

        res.redirect("/index");
    } catch (err) {
        console.error("Error in /submitBill:", err);
        res.status(500).send("Internal Server Error");
    }
}); 


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});


// 2. DATABASE SETUP SQL (run once in DB)
// CREATE TABLE bill_tracker (year INTEGER PRIMARY KEY, current_no INTEGER);


// 3. FRONTEND UPDATE IN index.ejs (ONLY CHANGED PARTS SHOWN)

// Inside the bill number input:
// <input type="text" id="billNumberField" value="" readonly>

// Print Button:
// <button class="button" onclick="handlePrint()">Print</button>

// Add at bottom of index.ejs inside <script>
async function handlePrint() {
    try {
        const res = await fetch("/generate-bill-number");
        const data = await res.json();
        document.getElementById("billNumberField").value = data.billNumber;
        window.print();
    } catch (err) {
        alert("Failed to generate bill number");
        console.error(err);
    }
}
