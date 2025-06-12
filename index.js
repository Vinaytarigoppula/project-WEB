// 1. SERVER FILE (app.js)

import express from "express";
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

// Open SQLite database
const db = open({
  filename: "./shopkeep.db",
  driver: sqlite3.Database,
});

// ------------------------------------------------
// Middleware (order matters)
// ------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // true if HTTPS in production
  })
);

app.set("view engine", "ejs");

// ------------------------------------------------
// Auth middleware
// ------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.session.userid) return res.redirect('/login');
  next();
}

// ------------------------------------------------
// Public pages
// ------------------------------------------------
app.get('/', (req, res) => res.render('Login.ejs'));
app.get('/login', (req, res) => res.render('Login.ejs'));
app.get('/register', (req, res) => res.render('Register.ejs'));

// ------------------------------------------------
// Auth routes
// ------------------------------------------------
app.post('/register', async (req, res) => {
  const dbConn = await db;
  const { username, password } = req.body;
  if (!username || !password) return res.send('All fields required');

  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await dbConn.run(
    'INSERT INTO users (username, password) VALUES (?, ?)',
    [username, hashedPassword]
  );
  // Auto-login after register
  req.session.userid = result.lastID;
  req.session.user = username;
  res.redirect('/Profile');
});

app.post('/login', async (req, res) => {
  const dbConn = await db;
  const { username, password } = req.body;
  const row = await dbConn.get('SELECT * FROM users WHERE username = ?', [username]);

  if (row && await bcrypt.compare(password, row.password)) {
    req.session.userid = row.userId;  // or row.id depending on schema
    req.session.user = username;
    res.redirect('/index');
  } else {
    res.send('Invalid username or password');
  }
});

// ------------------------------------------------
// Profile routes
// ------------------------------------------------
app.get('/Profile', requireLogin, async (req, res) => {
  const dbConn = await db;
  const userId = req.session.userid;
  console.log('Session.userId:', userId);const userRow = await dbConn.get(
  'SELECT username FROM users WHERE userId = ?',
  [userId]
);
const username = userRow ? userRow.username : '';

  const profileData = await dbConn.get(
    'SELECT * FROM shop_data WHERE user_id = ? LIMIT 1',
    [userId]
  );

  res.render('Profile', {
    username,
    profile: profileData || {},
    readonly: !!profileData,
  });
});

app.post('/shopData', requireLogin, async (req, res) => {
  const { shopName, shopAddress, gstin, phone } = req.body;
  const dbConn = await db;
  const userId = req.session.userid;

  if (!shopName || !shopAddress || !gstin || !phone) {
    return res.status(400).send('All fields are required.');
  }

  const existing = await dbConn.get(
    'SELECT 1 FROM shop_data WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (existing) {
    return res.status(403).send('Profile already filled. You cannot edit it again.');
  }

  await dbConn.run(
    'INSERT INTO shop_data (shop_name, shop_address, gstin, phone, user_id) VALUES (?, ?, ?, ?, ?)',
    [shopName, shopAddress, gstin, phone, userId]
  );
  res.redirect('/index');
});

// ------------------------------------------------
// Add / list products
// ------------------------------------------------
app.get('/AddProduct', requireLogin, async (req, res) => {
  const dbConn = await db;
  const array = await dbConn.all('SELECT * FROM product');
  res.render('AddProduct.ejs', { array });
});
app.post('/addproduct', requireLogin, async (req, res) => {
  const dbConn = await db;
  const { code, name } = req.body;
  await dbConn.run('INSERT INTO product (code, name) VALUES (?, ?)', [code, name]);
  res.redirect('/AddProduct');
});
app.get('/deleteproduct', requireLogin, async (req, res) => {
  const dbConn = await db;
  await dbConn.run('DELETE FROM product WHERE code = ?', [req.query.code]);
  res.sendStatus(200);
});

// ------------------------------------------------
// INDEX: generate bill–no once per session & render form
// ------------------------------------------------
app.get('/index', requireLogin, async (req, res) => {
  const dbConn = await db;
  if (!req.session.billNumber) {
    const year = new Date().getFullYear();
    const row = await dbConn.get(
      'SELECT current_no FROM bill_tracker WHERE year = ?', [year]
    );
    let nextNumber = row ? row.current_no + 1 : 1;
    if (row) {
      await dbConn.run('UPDATE bill_tracker SET current_no = ? WHERE year = ?', [nextNumber, year]);
    } else {
      await dbConn.run('INSERT INTO bill_tracker (year, current_no) VALUES (?, ?)', [year, nextNumber]);
    }
    req.session.billNumber = String(nextNumber).padStart(4, '0');
  }
  const products = await dbConn.all('SELECT * FROM product');
  const itemMapping = Object.fromEntries(products.map(p => [p.code, p.name]));
  res.render('index', {
    array: products,
    itemMapping: JSON.stringify(itemMapping),
    billNumber: req.session.billNumber,
  });
});

// ------------------------------------------------
// Submit bill
// ------------------------------------------------
app.post('/submitBill', requireLogin, async (req, res) => {
  const dbConn = await db;
  const { tableData, date, amount, discount, netamount, saletype } = req.body;
  const billno = req.session.billNumber;
  const parsedTable = JSON.parse(tableData);
  const isoDate = new Date(date).toISOString().split('T')[0];

  const stmt = await dbConn.prepare(
    'INSERT INTO billing (billno, date, code, name, rate, quantity, item_discount, amount, total_discount, netamount, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const item of parsedTable) {
    await stmt.run(
      billno, isoDate, item.code, item.name,
      parseFloat(item.rate), parseInt(item.quantity),
      parseFloat(item.discount), parseFloat(amount),
      parseFloat(discount), parseFloat(netamount), saletype
    );
  }
  await stmt.finalize();
  delete req.session.billNumber;
  res.render('Receipt');
});

// ------------------------------------------------
// History / Summary
// ------------------------------------------------
app.get('/History', requireLogin, (req, res) => {
  res.render('History', { bills: [], selectedStart: '', selectedEnd: '' });
});
app.post('/billSummaryform', requireLogin, async (req, res) => {
  const dbConn = await db;
  const bills = await dbConn.all(
    `SELECT DISTINCT billno, date, netamount, type
     FROM billing
     WHERE DATE(date) BETWEEN DATE(?) AND DATE(?)
     ORDER BY DATE(date) ASC`,
    [req.body.start, req.body.end]
  );
  res.render('History', {
    bills,
    selectedStart: req.body.start,
    selectedEnd: req.body.end,
  });
});


// ------------------------------------------------
// Start server
// ------------------------------------------------
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
