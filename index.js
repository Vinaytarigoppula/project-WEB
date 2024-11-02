import express from "express";
import bodyParser from "body-parser";

const app = express();
const port = 3000;


app.use(express.static("public"));


app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.render("Register.ejs");
  //Step 1 - Make the get route work and render the index.ejs file.
});
app.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });