const letters = [
  { element: document.getElementById('letterA'), x: 50, y: 50, dx: 0.5, dy: 0.5 },
  { element: document.getElementById('letterB'), x: 100, y: 100, dx: -0.5, dy: 0.5 },
  { element: document.getElementById('letterC'), x: 150, y: 150, dx: 0.5, dy: -0.5 },
  { element: document.getElementById('letterD'), x: 200, y: 70, dx: -0.5, dy: -0.5 },
];

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

  requestAnimationFrame(animate);
}

// Start the animation
animate();
