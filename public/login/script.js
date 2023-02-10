fetch('/api/link')
        .then(response => response.text())
        .then(data => {
            document.getElementById('timerlink').innerText = data;
        });


