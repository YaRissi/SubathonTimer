var hoursSpan;
var minutesSpan;
var secondsSpan;
var deadline;
var timeinterval;
var deadline;

var pathArray = window.location.pathname.split('/')[2];
fetch('/api/deadline/'+pathArray)
        .then(response => response.text())
        .then(data => {
            changeDeadline(new Date(data));
        });


setInterval(function() {
    fetch('/api/deadline/'+pathArray)
        .then(response => response.text())
        .then(data => {
            changeDeadline(new Date(data));
        });
    }, 4000);

function getTimeRemaining(endtime) {
    var t = endtime - Date.parse(new Date());
    var seconds = Math.floor((t / 1000) % 60);
    var minutes = Math.floor((t / 1000 / 60) % 60);
    var hours = Math.floor(t / (1000 * 60 * 60));
    return {
        'total': t,
        'hours': hours,
        'minutes': minutes,
        'seconds': seconds
    };
}

var timeLeft;

function initializeClock(id) {
    var clock = document.getElementById(id);
    hoursSpan = clock.querySelector('.hours');
    minutesSpan = clock.querySelector('.minutes');
    secondsSpan = clock.querySelector('.seconds');
}

function updateClock() {
    timeLeft = getTimeRemaining(deadline);
    hoursSpan.innerHTML = timeLeft.hours + ':';
    minutesSpan.innerHTML = ('0' + timeLeft.minutes).slice(-2) + ':';
    secondsSpan.innerHTML = ('0' + timeLeft.seconds).slice(-2);

    if (timeLeft.total <= 0) {
        clearInterval(timeinterval);
    }
}

function changeDeadline(newdeadline) {
    deadline = newdeadline;
    clearInterval(timeinterval);
    timeinterval = setInterval(updateClock, 100);
}

initializeClock('clockdiv');

timeinterval = setInterval(updateClock, 100);