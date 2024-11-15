import express from "express";
import bodyParser from "body-parser";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt"
import session from "express-session"; // Import express-session

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let db;
db=open({
    filename: './shopkeep.db', // Corrected typo
    driver: sqlite3.Database,
  });
const app = express();
const port = 3000;
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
// Set up session management
app.use(session({
    secret: 'your-secret-key', // Change this to a strong secret key
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));
app.set("view engine", "ejs"); // Add this line to ensure Express knows to use EJS as the view engine


app.get("/", (req, res) => {
    res.render("Login.ejs"); 
});
app.get("/login", (req, res) => {
    res.render("Login.ejs");
});

app.get("/register", (req, res) => {
    res.render("Register.ejs");
});

app.get("/AddProduct", (req, res) => {
    res.render("AddProduct.ejs");
})
app.get("/index", (req, res) => {
    res.render("index");
})
app.post("/register",async (req,res)=>{
    let username=req.body.username;
    let password=req.body.password;
    const hashedPassword = await bcrypt.hash(password, 10);
    (await db).run("Insert into users (username,password) values(?,?)",[username,hashedPassword]);
    res.render("Login.ejs");
})
app.post("/login", async (req, res) => {
    const user = req.body.username;
    const password = req.body.password;
    req.session.user = user; // Store user in session
   
    const row = await (await db).get("SELECT * FROM users WHERE username = ?", [user]);
    console.log(row);
    if(row){
    const isMatch = await bcrypt.compare(password, row.password);
    if (isMatch) {
        // Passwords match, log in the user
        req.session.user = row.username; // Store the username in the session
        res.render("index.ejs");
    }else
    {
        res.send("password not matched")
    }
}
else{
    res.send("user  found");
}
});
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
