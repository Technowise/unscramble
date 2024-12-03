/*
const letters = [
  { element: document.getElementById('letterA'), x: 50, y: 50, dx: 0.5, dy: 0.5 },
  { element: document.getElementById('letterB'), x: 100, y: 100, dx: -0.5, dy: 0.5 },
  { element: document.getElementById('letterC'), x: 150, y: 150, dx: 0.5, dy: -0.5 },
  { element: document.getElementById('letterD'), x: 200, y: 70, dx: -0.5, dy: -0.5 },
];
*/

var letters = [];
var animationRequest = null;

const box = document.querySelector('.box');
const boxWidth = box.offsetWidth;
const boxHeight = box.offsetHeight;

function animate() {
  letters.forEach(letter => {
    letter.x += letter.dx;
    letter.y += letter.dy;

    // Check for collision with walls
    if (letter.x <= 0 || letter.x >= boxWidth - letter.element.offsetWidth) {
      letter.dx *= -1;
    }
    if (letter.y <= 0 || letter.y >= boxHeight - letter.element.offsetHeight) {
      letter.dy *= -1;
    }

    // Update position
    letter.element.style.transform = `translate(${letter.x}px, ${letter.y}px)`;
  });

  animationRequest = requestAnimationFrame(animate);
}

// Start the animation
//animate();

/*
window.addEventListener('message', (ev) => {
  if (ev.type === 'devvit-message') {
    alert(ev.data); 
    console.log('Received message from Devvit in webview', JSON.stringify(ev.data) );
  }
  alert(ev.data);
}); */


window.onmessage = (ev) => {
  console.log("Got something now...");
  lettersData = ev.data.data.message.letters;

  if( lettersData.length > 0 ) {

    var boxElement = document.getElementsByClassName('box')[0];
    boxElement.innerHTML = '';
    letters= [];
    cancelAnimationFrame(animationRequest);

    for(var i=0; i< lettersData.length; i++ ) {
      var iDiv = document.createElement('div');
      iDiv.innerHTML = lettersData[i];
      iDiv.id = 'letter'+lettersData[i];
      iDiv.className = 'letter';
      boxElement.appendChild(iDiv);
      letters.push({ element: iDiv, x: Math.floor(Math.random() * 300) + 1, y: Math.floor(Math.random() * 190) + 1  , dx: 0.5, dy: 0.5 })
    }

    animate();
  }

  /*
  const log = document.querySelector('#log');
  const msg = JSON.stringify(ev.data);
  const pre = document.createElement('pre');
  pre.innerText = msg;
  log.appendChild(pre);
  */
}