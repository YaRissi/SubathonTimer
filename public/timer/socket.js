var twitch = new WebSocket("wss://pubsub-edge.twitch.tv");
var URLid = window.location.pathname.split("/")[2];
var streamlabs;
var pong;
var id = "false";
var pongtimeout;
var nonce = createnonce(16);
var slhttp = new XMLHttpRequest();
var streamlabstoken = "false";
var atoken = "false";
var ping = {
  type: "PING",
};

fetch("/api/twitch/" + URLid)
  .then((response) => response.json())
  .then((data) => {
    atoken = data["token"];
    id = data["channel"];
  });

const options = { method: "GET", headers: { accept: "application/json" } };

fetch("/api/streamlabs/" + URLid)
  .then((response) => response.text())
  .then((data) => {
    streamlabstoken = data;
    streamlabstokencheck();
  });

streamlabsocket("");

function twitchping() {
  setTimeout(function () {
    twitch.send(JSON.stringify(ping));
    console.log('Sending PING to Twitch at: ' + new Date().toUTCString());
    pongtimeout = setTimeout(function () {
      console.log(
        "Timed out, reconnecting: 2 sec at: " + new Date().toUTCString()
      );
      twitchreconnect(2000);
    }, 11000);
  }, 180000 + Math.floor(Math.random() * 30000));
}

function twitchreconnect(wait) {
  var max_wait = 128000;
  let time;
  if (wait < max_wait) {
    time = wait * 2;
  } else {
    time = wait;
  }
  twitch.close();
  twitch = new WebSocket("wss://pubsub-edge.twitch.tv");
  pongtimeout = setTimeout(function () {
    console.log("Timed out, reconnecting: " + time / 1000 + " sec");
    twitchreconnect(time);
  }, wait);
}

function createnonce(length) {
  var text = "";
  var possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

twitch.addEventListener("open", function (event) {
  while (atoken == "false" || id == "false") {
    console.log("Waiting for atoken");
  }
  console.log("start");
  var msg = {
    type: "LISTEN",
    nonce: nonce,
    data: {
      topics: [
        "channel-bits-events-v1." + id,
        "channel-subscribe-events-v1." + id,
      ],
      auth_token: atoken,
    },
  };
  twitch.send(JSON.stringify(msg));
  if (pongtimeout) {
    clearTimeout(pongtimeout);
  }
  twitchping();
});

twitch.addEventListener("message", function (event) {
  var msg = JSON.parse(event.data);
  switch (msg.type) {
    case "RESPONSE":
      if (msg.nonce != nonce) {
        console.log("nonce mismatch: " + msg.nonce + " != " + nonce);
        twitch.close();
        twitch = new WebSocket("wss://pubsub-edge.twitch.tv");
      } else {
        console.log("nonce match: " + msg.nonce + " = " + nonce);
        console.log("Connected to Twitch socket");
        console.log("Error: " + msg.error);
      }
      break;
    case "MESSAGE":
      console.log("Received MESSAGE from Twitch at: " + new Date().toUTCString());
      var data = JSON.parse(msg.data.message);
      switch (msg.data.topic) {
        case "channel-bits-events-v1." + id:
          console.log("bits used: " + data.data.bits_used);
          socket.emit("bits", {
            id: data.data.channel_id,
            bits: data.data.bits_used,
          });
          break;
        case "channel-subscribe-events-v1." + id:
          console.log(
            "sub months: " +
              data["streak_months"] +
              "/" +
              data["cumulative_months"] +
              " for plan: " +
              data.sub_plan
          );
          console.log(data);
          socket.emit("subs", {
            id: data.channel_id,
            months: data["streak_months"],
            plan: data.sub_plan,
            context: data.context,
            cummonths: data["cumulative_months"],
          });
          break;
      }
      break;
    case "PONG":
      clearTimeout(pongtimeout);
      //console.log('Received PONG from Twitch at: ' + new Date().toUTCString());
      twitchping();
      break;
    case "RECONNECT":
      console.log("Got RECONNECT request at: " + new Date().toUTCString());
      twitchreconnect(2000);
      break;
  }
});

function streamlabsocket(token) {
  streamlabs = io(`https://sockets.streamlabs.com?token=${token}`, {
    transports: ["websocket"],
  });
  console.log("Connected to Streamlabs socket");
  streamlabs.on("event", (eventData) => {
    if (!eventData.for && eventData.type === "donation") {
      fetch("/api/dono/"+URLid, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: eventData.message[0].amount}),
      });
      console.log(eventData.message);
    }
  });
}

function streamlabstokencheck() {
  if (streamlabstoken != "false") {
    fetch(
      "https://streamlabs.com/api/v1.0/socket/token?access_token=" +
        streamlabstoken,
      options
    )
      .then((response) => response.json())
      .then((response) => streamlabsocket(response.socket_token))
      .catch((err) => console.error(err));
  }
}

window.onbeforeunload = function () {
  twitch.onclose = function () {};
  twitch.close();
  streamlabs.disconnect();
};
