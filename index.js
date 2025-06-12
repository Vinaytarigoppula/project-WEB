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
// Middleware
// ------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
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
// Routes
// ------------------------------------------------
app.get('/', (req, res) => res.render('Login.ejs'));
app.get('/login', (req, res) => res.render('Login.ejs'));
app.get('/register', (req, res) => res.render('Register.ejs'));

// Register
app.post('/register', async (req, res) => {
  const dbConn = await db;
  const { username, password } = req.body;
  if (!username || !password) return res.send('All fields required');
  const hashed = await bcrypt.hash(password, 10);
  const result = await dbConn.run(
    'INSERT INTO users (username,password) VALUES (?,?)',
    [username, hashed]
  );
  req.session.userid = result.lastID;
  res.redirect('/Profile');
});

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const dbConn = await db;
  const row = await dbConn.get(
    'SELECT * FROM users WHERE username = ?', [username]
  );
  if (row && await bcrypt.compare(password, row.password)) {
    req.session.userid = row.userId;
    res.redirect('/index');
  } else res.send('Invalid credentials');
});

// Profile
app.get('/Profile', requireLogin, async (req, res) => {
  const dbConn = await db;
  const userId = req.session.userid;
  const k=await dbConn.get('select username from users where userId=?',[userId] );
  const username=k.username;
  const shop = await dbConn.get(
    'SELECT * FROM shop_data WHERE user_id=?', [userId]
  );
  res.render('Profile', {username, profile: shop || {}, readonly: !!shop });
});
app.post('/shopData', requireLogin, async (req, res) => {
  const { shopName, shopAddress, gstin, phone } = req.body;
  const dbConn = await db;
  const userId = req.session.userid;
  const exists = await dbConn.get(
    'SELECT 1 FROM shop_data WHERE user_id=?', [userId]
  );
  if (exists) return res.send('Profile exists');
  await dbConn.run(
    'INSERT INTO shop_data (shop_name,shop_address,gstin,phone,user_id) VALUES (?,?,?,?,?)',
    [shopName,shopAddress,gstin,phone,userId]
  );
  res.redirect('/index');
});

// Billing page
app.get('/index', requireLogin, async (req, res) => {
  const dbConn = await db;
  if (!req.session.billNumber) {
    const year = new Date().getFullYear();
    const row = await dbConn.get(
      'SELECT current_no FROM bill_tracker WHERE year=?', [year]
    );
    const next = row ? row.current_no+1 : 1;
    if (row)
      await dbConn.run('UPDATE bill_tracker SET current_no=? WHERE year=?',[next,year]);
    else
      await dbConn.run('INSERT INTO bill_tracker(year,current_no)VALUES(?,?)',[year,next]);
    req.session.billNumber = String(next).padStart(4,'0');
  }
  const products = await dbConn.all('SELECT * FROM product');
  res.render('index', {
    billNumber: req.session.billNumber,
    itemMapping: JSON.stringify(Object.fromEntries(products.map(p=>[p.code,p.name])))
  });
});

// Submit Bill
app.post('/submitBill', requireLogin, async (req, res) => {
  const dbConn = await db;
  const userId = req.session.userid;
  const { tableData, date, amount, discount, netamount, saletype } = req.body;
  const items = JSON.parse(tableData);
  const isoDate = new Date(date).toISOString().split('T')[0];
  const stmt = await dbConn.prepare(
    `INSERT INTO billing(
      billno,date,code,name,rate,quantity,item_discount,amount,total_discount,netamount,type,user_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (let it of items) {
    await stmt.run(
      req.session.billNumber, isoDate,
      it.code, it.name, parseFloat(it.rate), parseInt(it.quantity),
      parseFloat(it.discount), parseFloat(amount),
      parseFloat(discount), parseFloat(netamount), saletype, userId
    );
  }
  await stmt.finalize();
  res.redirect('/Receipt');
});

// Receipt
app.get('/Receipt', requireLogin, async (req, res) => {
  const dbConn = await db;
  const userId = req.session.userid;
  const shop = await dbConn.get('SELECT * FROM shop_data WHERE user_id=?',[userId]);
  const billItems = await dbConn.all('SELECT * FROM billing WHERE billno=?',[req.session.billNumber]);
  res.render('Receipt',{ shopdata: shop, items: billItems });
});

app.listen(port, ()=>console.log(`Server running on http://localhost:${port}`));