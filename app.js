const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bodyParser = require("body-parser");
const tmi = require("tmi.js");
const axios = require("axios");

const newConnection = new Map();

const client = new tmi.Client();

var jsonParser = bodyParser.json();

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/config.json"))
);

const streamlabstoken = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/streamlabs.json"))
);

const twitchtoken = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/twitchtoken.json"))
);

const users = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/users.json"))
);

const channeltoid = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/usertoid.json"))
);

const idtouser = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/IDToUser.json"))
);

const deadline = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/deadline.json"))
);

const maxdeadline = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/maxdeadline.json"))
);

const settings = JSON.parse(
  fs.readFileSync(path.join(__dirname, "settings/timesettings.json"))
);

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(
  session({
    secret: crypto.randomBytes(4).toString("base64"),
    resave: true,
    saveUninitialized: true,
    cookie: {
      secure: false,
      maxAge: 30 * 60 * 1000,
    },
    rolling: true,
  })
);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/website/login/login.html"));
});

app.get("/auth/twitch", async (req, res) => {
  console.log(req.query);
  if (req.session.token) {
    // probably logged in
    // and will suffice for this example

    console.log(`The server has a token: ${req.session.token.access_token}`);

    // validate and return the token details
    let validateResp = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: {
        Authorization: `Bearer ${req.session.token.access_token}`,
        Accept: "application/json",
      },
    });
    if (validateResp.status != 200) {
      req.session.error = "Token is invalid!";
      console.log("Token is invalid!");
      req.session.destroy();
      res.redirect("/");
      return;
    }
    let validateData = await validateResp.json();
    console.log("Ok", validateData);

    channeltoid[validateData.login] = validateData.user_id;
    writechanneltoid();

    res.redirect("/user");

    return;
  }

  let { code, error, error_description, scope, state } = req.query;
  if (code) {
    // do the oAuth dance and exchange the token for a user token
    // first validate the state is valid
    console.log("Query: " + req.query);
    state = decodeURIComponent(state);
    console.log("State2: " + state);
    console.log("Session State: " + req.session.state);

    if (decodeURIComponent(req.session.state) != state) {
      req.session.error = "State does not match. Please try again!";
      console.log("State does not match. Please try again!");
      res.redirect("/");
      return;
    }
    // done with the state params
    delete req.session.state;

    // start the oAuth dance
    let tokenResp = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: new URLSearchParams([
        ["client_id", config.client_id],
        ["client_secret", config.client_secret],
        ["code", code],
        ["grant_type", "authorization_code"],
        ["redirect_uri", config.redirect_uri],
      ]),
    });

    if (tokenResp.status != 200) {
      req.session.error = "An Error occured: " + (await tokenResp.text());
      console.log(req.session.error);
      res.redirect("/");
      return;
    }

    // oAuth dance success!
    req.session.token = await tokenResp.json();

    // we'll go collect the user this token is for
    let userResp = await fetch("https://api.twitch.tv/helix/users", {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Client-ID": config.client_id,
        Authorization: `Bearer ${req.session.token.access_token}`,
      },
    });

    if (userResp.status != 200) {
      req.session.error = "An Error occured: " + (await tokenResp.text());
      console.log(req.session.error);
      res.redirect("/");
      return;
    }

    let userData = await userResp.json();
    // malformed...
    if (!userData.hasOwnProperty("data")) {
      req.session.warning =
        "We got a Token but failed to get your Twitch profile from Helix";
      console.log(req.session.warning);
      res.redirect("/");
      return;
    }
    // not one user returned
    if (userData.data.length != 1) {
      req.session.warning =
        "We got a Token but failed to get your Twitch profile from Helix";
      console.log(req.session.warning);
      res.redirect("/");
      return;
    }
    req.session.user = userData.data[0];

    console.log("User: " + req.session.user.login);

    login = req.session.user.login;
    if (users[login] == undefined) {
      users[login] = makeid(20);
      idtouser[users[login]] = login;
      writeIDtoUser();
      writeUsers();
    }

    twitchtoken[login] = req.session.token.access_token;
    writetwitchtoken();
    req.session.token.user_id = users[login];

    timeDeadline = new Date();
    timeDeadline.setHours(timeDeadline.getHours() + 12);
    deadline[login] = timeDeadline.toISOString();
    writeDeadline();

    timeMaxDeadline = new Date(timeDeadline);
    timeMaxDeadline.setHours(timeMaxDeadline.getHours() + 9);
    maxdeadline[login] = timeMaxDeadline.toISOString();

    writeMaxDeadline();

    res.redirect("/auth/twitch");

    return;
  }

  var auth_error = "";
  if (error) {
    auth_error = "oAuth Error " + error_description;
  }

  req.session.state = crypto.randomBytes(16).toString("base64");

  if (req.session.state.includes("+")) {
    req.session.state = req.session.state.replace("+", "%2B");
  }

  var url =
    "https://id.twitch.tv/oauth2/authorize" +
    "?client_id=" +
    config.client_id +
    "&redirect_uri=" +
    config.redirect_uri +
    "&response_type=code" +
    "&force_verify=" +
    false +
    "&state=" +
    req.session.state +
    "&scope=bits:read+channel:read:subscriptions+chat:read+chat:edit";

  console.log("Redirecting to: " + url);
  res.redirect(url);
});

app.route("/logout/").get((req, res) => {
  console.log("Incoming logout request");
  // as well as dumoing the session lets revoke the token
  fetch(
    "https://id.twitch.tv/oauth2/revoke" +
      "?client_id=" +
      config.client_id +
      "&token=" +
      req.session.token.access_token,
    {
      method: "post",
    }
  )
    .then((resp) => {
      console.log("KeyRevoke OK", resp.status);
    })
    .catch((err) => {
      console.error("KeyRevoke Fail", err);
    });

  // and dump
  req.session.destroy();
  res.redirect("/");
});

function writeDeadline() {
  fs.writeFile("settings/deadline.json", JSON.stringify(deadline), (err) => {
    if (err) {
      console.log(err);
    }
  });
}

function writeMaxDeadline() {
  fs.writeFile(
    "settings/maxdeadline.json",
    JSON.stringify(maxdeadline),
    (err) => {
      if (err) {
        console.log(err);
      }
    }
  );
}

function writeUsers() {
  fs.writeFile("settings/users.json", JSON.stringify(users), (err) => {
    if (err) {
      console.log(err);
    }
  });
}
function writeUstreamlabsToken() {
  fs.writeFile(
    "settings/streamlabs.json",
    JSON.stringify(streamlabstoken),
    (err) => {
      if (err) {
        console.log(err);
      }
    }
  );
}
function writetwitchtoken() {
  fs.writeFile(
    "settings/twitchtoken.json",
    JSON.stringify(twitchtoken),
    (err) => {
      if (err) {
        console.log(err);
      }
    }
  );
}

function writechanneltoid() {
  fs.writeFile("settings/usertoid.json", JSON.stringify(channeltoid), (err) => {
    if (err) {
      console.log(err);
    }
  });
}

function writeIDtoUser() {
  fs.writeFile("settings/IDToUser.json", JSON.stringify(idtouser), (err) => {
    if (err) {
      console.log(err);
    }
  });
}

function writeSettings() {
  fs.writeFile(
    "settings/timesettings.json",
    JSON.stringify(settings),
    (err) => {
      if (err) {
        console.log(err);
      }
    }
  );
}

function makeid(length) {
  var result = "";
  var characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

const STREAMLABS_API_BASE = "https://www.streamlabs.com/api/v1.0";

app.get("/auth/streamlabs", (req, res) => {
  let code = req.query.code;
  if (code == undefined) {
    let authorize_url = `${STREAMLABS_API_BASE}/authorize?`;

    let params = {
      client_id: "KoX5DKTM8ASisZm9zeBtBiAzW1wkf2NIEoaFr73S",
      redirect_uri: "https://subathontimer-production.up.railway.app/auth/streamlabs",
      response_type: "code",
      scope: "donations.read+legacy.token+socket.token",
    };

    // not encoding params
    authorize_url += Object.keys(params)
      .map((k) => `${k}=${params[k]}`)
      .join("&");

    res.redirect(authorize_url);
  } else {
    axios
      .post(`${STREAMLABS_API_BASE}/token?`, {
        grant_type: "authorization_code",
        client_id: "KoX5DKTM8ASisZm9zeBtBiAzW1wkf2NIEoaFr73S",
        client_secret: "NUeS5PlojFq4tVl7nET3KvSNQkhfPjBBE5mIiT72",
        redirect_uri: "https://subathontimer-production.up.railway.app/auth/streamlabs",
        code: code,
      })
      .then((response) => {
        login = req.session.user.login;
        streamlabstoken[login] = response.data.access_token;
        writeUstreamlabsToken();
        console.log(response.data.refresh_token);
      })
      .catch((error) => {
        console.log(error);
      });

    res.redirect("/user");
  }
});

app.get("/api/streamlabs/:id", (req, res) => {
  id = req.params.id;
  if (streamlabstoken[idtouser[id]] == undefined) {
    res.send("error");
  } else {
    (token = streamlabstoken[idtouser[id]]), res.send(token);
  }
});

app.get("/api/twitch/:id", (req, res) => {
  id = req.params.id;
  if (twitchtoken[idtouser[id]] == undefined) {
    res.json("error");
  } else {
    data = {
      token: twitchtoken[idtouser[id]],
      channel: channeltoid[idtouser[id]],
    };
    res.json(data);
  }
});

app.get("/newuid", (req, res) => {
  login = req.session.user.login;
  users[login] = makeid(20);
  idtouser[users[login]] = login;
  writeIDtoUser();
  writeUsers();
  res.redirect("/user");
});

app.get("/user", (req, res) => {
  //if (req.session.token) {
  res.sendFile(path.join(__dirname, "/website/user/index.html"));
  // } else {
  //  res.redirect("/");
  // }
});

app.get("/api/deadline/:id", (req, res) => {
  id = req.params.id;
  res.send(deadline[idtouser[id]]);
});

app.get("/api/link", (req, res) => {
  login = req.session.user.login;
  res.send("https://subathontimer-production.up.railway.app/timer/" + users[login]);
});

app.post("/savesettings", jsonParser, (req, res) => {
  if (req.session.token) {
    login = req.session.user.login;
    data = JSON.stringify(req.body);
    settings[login] = req.body;
    writeSettings();
    res.send({ success: "Updated Successfully", status: 200 });
  } else {
    res.send({ error: "Not logged in", status: 401 });
  }
});

app.post("/addtimer", jsonParser, (req, res) => {
  if (req.session.token) {
    data = req.body;
    login = req.session.user.login;
    hours = parseInt(data["hours"]);
    minutes = parseInt(data["minutes"]);
    seconds = parseInt(data["seconds"]);
    deadlineDate = new Date(deadline[login]);
    deadlineDate.setSeconds(deadlineDate.getSeconds() + seconds);
    deadlineDate.setMinutes(deadlineDate.getMinutes() + minutes);
    deadlineDate.setHours(deadlineDate.getHours() + hours);
    deadline[login] = deadlineDate.toISOString();
    if (new Date(deadline[login]) > new Date(maxdeadline[login])) {
      deadline[login] = maxdeadline[login];
    }
    writeDeadline();
    res.send({ success: "Updated Successfully", status: 200 });
  } else {
    res.send({ error: "Not logged in", status: 401 });
  }
});

app.post("/settimer", jsonParser, (req, res) => {
  if (req.session.token) {
    data = req.body;
    login = req.session.user.login;

    date = new Date();
    starthours = parseInt(data["hours"]);
    startminutes = parseInt(data["minutes"]);
    startseconds = parseInt(data["seconds"]);
    date.setSeconds(date.getSeconds() + startseconds);
    date.setMinutes(date.getMinutes() + startminutes);
    date.setHours(date.getHours() + starthours);
    deadline[login] = date.toISOString();
    deadlineTime = new Date(deadline[login]);
    writeDeadline();

    maxDate = new Date(deadlineTime);
    maxhours = parseInt(data["maxhours"]);
    maxminutes = parseInt(data["maxminutes"]);
    maxseconds = parseInt(data["maxseconds"]);
    maxDate.setSeconds(deadlineTime.getSeconds() + maxseconds);
    maxDate.setMinutes(deadlineTime.getMinutes() + maxminutes);
    maxDate.setHours(deadlineTime.getHours() + maxhours);
    maxdeadline[login] = maxDate.toISOString();
    writeMaxDeadline();

    res.send({
      success: "Updated Successfully",
      status: 200,
      newtime: deadlineTime.getTime(),
    });
  } else {
    res.send({ error: "Not logged in", status: 401 });
  }
});

app.get("/timer/:id", jsonParser, (req, res) => {
  res.sendFile(path.join(__dirname, "/website/timer/timer.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server started on port'+PORT+'!');
});

app.post("/api/dono/:id", jsonParser, (req, res) => {
  id = req.params.id;
  login = idtouser[id];
  amount = parseInt(req.body["amount"]);
  addtimerDono(amount, login);
});

app.post("/api/subs/:id", jsonParser, (req, res) => {
  id = req.params.id;
  login = idtouser[id];
  amount = parseInt(req.params.amount);
  addtimerSubs(amount, login);
});

app.post("/api/bits/:id", jsonParser, (req, res) => {
  id = req.params.id;
  login = idtouser[id];
  amount = parseInt(req.params.amount);
  addtimerBits(amount, login);
});

function addtimerDono(amount, login) {
  twohundredfifty = Math.floor(amount / 250);
  hundred = Math.floor((amount - twohundredfifty * 250) / 100);
  fifty = Math.floor((amount - twohundredfifty * 250 - hundred * 100) / 50);
  ten = Math.floor(
    (amount - twohundredfifty * 250 - hundred * 100 - fifty * 50) / 10
  );
  five = Math.floor(
    (amount - twohundredfifty * 250 - hundred * 100 - fifty * 50 - ten * 10) / 5
  );
  rest =
    amount -
    twohundredfifty * 250 -
    hundred * 100 -
    fifty * 50 -
    ten * 10 -
    five * 5;
  addtime = 
    twohundredfifty * settings[login]["donoTwoHundredFifty"] +
    hundred * settings[login]["donoHundred"] +
    fifty * settings[login]["donoFifty"] +
    ten * settings[login]["donoTen"] +
    five * settings[login]["donoFive"] +
    rest * settings[login]["donoPerEuro"];
  date = new Date(deadline[login]);
  date.setMinutes(date.getMinutes() + addtime);
  deadline[login] = date.toISOString();
  writeDeadline();
}

function addtimerSubs(numbOfSubs, login) {
  hunderdSubs = Math.floor(numbOfSubs / 100);
  fiftySubs = Math.floor((numbOfSubs - hunderdSubs * 100) / 50);
  twentySubs = Math.floor(
    (numbOfSubs - hunderdSubs * 100 - fiftySubs * 50) / 20
  );
  tenSubs = Math.floor(
    (numbOfSubs - hunderdSubs * 100 - fiftySubs * 50 - twentySubs * 20) / 10
  );
  fiveSubs = Math.floor(
    (numbOfSubs -
      hunderdSubs * 100 -
      fiftySubs * 50 -
      twentySubs * 20 -
      tenSubs * 10) /
      5
  );
  rest =
    numbOfSubs -
    hunderdSubs * 100 -
    fiftySubs * 50 -
    twentySubs * 20 -
    tenSubs * 10 -
    fiveSubs * 5;

  //addtime forall
  addtime =
    hunderdSubs * settings[login]["hunredSubs"] +
    fiftySubs * settings[login]["fiftySubs"] +
    twentySubs * settings[login]["twentySubs"] +
    tenSubs * settings[login]["tenSubs"] +
    fiveSubs * settings[login]["fiveSubs"] +
    rest * settings[login]["perSub"];
  date = new Date(deadline[login]);
  date.setMinutes(date.getMinutes() + addtime);
  deadline[login] = date.toISOString();
  writeDeadline();
}

function addtimerBits(numbOfBits, login) {
  twentyfiveThousandBits = Math.floor(numbOfBits / 25000);
  tenThousandBits = Math.floor(
    (numbOfBits - twentyfiveThousandBits * 25000) / 10000
  );
  fiveThousandBits = Math.floor(
    (numbOfBits - twentyfiveThousandBits * 25000 - tenThousandBits * 10000) /
      5000
  );
  thousandfivehunderdBits = Math.floor(
    (numbOfBits -
      twentyfiveThousandBits * 25000 -
      tenThousandBits * 10000 -
      fiveThousandBits * 5000) /
      1500
  );
  thousandBits = Math.floor(
    (numbOfBits -
      twentyfiveThousandBits * 25000 -
      tenThousandBits * 10000 -
      fiveThousandBits * 5000 -
      thousandfivehunderdBits * 1500) /
      1000
  );
  fivehunderdBits = Math.floor(
    (numbOfBits -
      twentyfiveThousandBits * 25000 -
      tenThousandBits * 10000 -
      fiveThousandBits * 5000 -
      thousandfivehunderdBits * 1500 -
      thousandBits * 1000) /
      500
  );
  rest =
    numbOfBits -
    twentyfiveThousandBits * 25000 -
    tenThousandBits * 10000 -
    fiveThousandBits * 5000 -
    thousandfivehunderdBits * 1500 -
    thousandBits * 1000 -
    fivehunderdBits * 500;
  addtime =
    twentyfiveThousandBits * settings[login]["twentyfivethousandBits"] +
    tenThousandBits * settings[login]["tenthousandBits"] +
    fiveThousandBits * settings[login]["fivethousandBits"] +
    thousandfivehunderdBits * 0 +
    thousandBits * settings[login]["thousandBits"] +
    fivehunderdBits * settings[login]["fivehunderdBits"] +
    rest * settings[login]["preHundredsBits"];

  date = new Date(deadline[login]);
  date.setMinutes(date.getMinutes() + addtime);
  deadline[login] = date.toISOString();
  writeDeadline();
}
